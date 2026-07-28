import type { CadWorkerApi } from "./worker.ts";
import type { ParamValues } from "./models";

/** Face + edge meshes for a single shape, as the worker returns them. */
export type ShapeMeshes = Awaited<ReturnType<CadWorkerApi["mesh"]>>[number];

export type ExportKind = "stl" | "step" | "3mf";

/**
 * The subset of the worker this session drives. Declared structurally rather
 * than as comlink's `Remote<CadWorkerApi>` so the module stays free of both
 * comlink and browser types, and so a test can pass a plain object.
 */
export interface CadApi {
  mesh(modelId: string, values: ParamValues): Promise<ShapeMeshes[]>;
  exportSTL(modelId: string, values: ParamValues): Promise<Blob>;
  exportSTEP(modelId: string, values: ParamValues): Promise<Blob>;
  export3MF(modelId: string, values: ParamValues): Promise<Blob>;
}

/** A live worker plus the means to kill it. */
export interface WorkerHandle {
  api: CadApi;
  terminate(): void;
}

/** Rejection reason for a job superseded by a newer one. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

interface Job {
  kind: "build" | "export";
  reject: (reason: unknown) => void;
}

interface Deferred {
  modelId: string;
  values: ParamValues;
  resolve: (meshes: ShapeMeshes[]) => void;
  reject: (reason: unknown) => void;
}

const EXPORT_METHOD = {
  stl: "exportSTL",
  step: "exportSTEP",
  "3mf": "export3MF",
} as const;

/**
 * Serializes work on a single CAD worker so that a newer build preempts an
 * older one instead of queueing behind it.
 *
 * Builds run 1-53 s (the perimeter models dominate) while spawning a worker
 * costs a few hundred ms, so throwing away a superseded build is cheap. There
 * is no cooperative cancellation point inside `model.build()` — it is a chain
 * of opaque OCCT boolean operations — so `terminate()` is the only lever.
 */
export class CadSession {
  #spawn: () => WorkerHandle;
  #handle: WorkerHandle;
  #job: Job | null = null;
  #deferred: Deferred | null = null;
  #wasBusy = false;

  /** Fires only on real edge transitions, never mid-preemption. */
  onBusyChange?: (busy: boolean) => void;

  constructor(spawn: () => WorkerHandle) {
    this.#spawn = spawn;
    this.#handle = spawn();
  }

  get busy(): boolean {
    return this.#job !== null || this.#deferred !== null;
  }

  get exporting(): boolean {
    return this.#job?.kind === "export";
  }

  build(modelId: string, values: ParamValues): Promise<ShapeMeshes[]> {
    if (this.exporting) return this.#defer(modelId, values);
    if (this.#job) this.#kill();
    return this.#run("build", (api) => api.mesh(modelId, values));
  }

  /**
   * An export is a deliberate click that produces a file, so it is never
   * cancelled. A rebuild requested mid-export waits here instead — at most one,
   * newest wins, so the worker queue never grows.
   */
  #defer(modelId: string, values: ParamValues): Promise<ShapeMeshes[]> {
    this.#deferred?.reject(new Cancelled());
    this.#deferred = null;
    return new Promise<ShapeMeshes[]>((resolve, reject) => {
      this.#deferred = { modelId, values, resolve, reject };
      this.#sync();
    });
  }

  /** An explicit click outranks a speculative rebuild, so kill one if running. */
  exportModel(
    kind: ExportKind,
    modelId: string,
    values: ParamValues,
  ): Promise<Blob> {
    if (this.#job) this.#kill();
    return this.#run("export", (api) => api[EXPORT_METHOD[kind]](modelId, values));
  }

  /** Release the parked build, if any, now that the worker is free. */
  #drain(): void {
    const next = this.#deferred;
    this.#deferred = null;
    if (next) {
      this.build(next.modelId, next.values).then(next.resolve, next.reject);
    }
    this.#sync();
  }

  /**
   * Stop whatever the worker is doing and replace it. Terminating leaves
   * comlink's in-flight promise permanently unsettled, so the job is rejected
   * here — otherwise the caller's `catch`/`finally` would never run.
   *
   * Deliberately does not call `#sync()`: the caller redispatches immediately,
   * so busy stays true and the UI must not blink.
   */
  #kill(): void {
    const job = this.#job;
    this.#job = null;
    this.#handle.terminate();
    this.#handle = this.#spawn();
    job?.reject(new Cancelled());
  }

  #run<T>(kind: Job["kind"], call: (api: CadApi) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = { kind, reject };
      this.#job = job;
      this.#sync();
      call(this.#handle.api).then(
        (value) => {
          // A terminated worker never settles, but guard anyway in case it
          // resolves in the same tick it is killed.
          if (this.#job !== job) return;
          this.#job = null;
          resolve(value);
          this.#drain();
        },
        (error) => {
          if (this.#job !== job) return;
          this.#job = null;
          reject(error);
          this.#drain();
        },
      );
    });
  }

  #sync(): void {
    const busy = this.busy;
    if (busy === this.#wasBusy) return;
    this.#wasBusy = busy;
    this.onBusyChange?.(busy);
  }
}
