# Preemptive Build Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a newly dispatched build cancel the in-flight one instead of queueing behind it, and disable the export buttons while any job is running.

**Architecture:** A new `src/cad-session.ts` owns the web worker and a small concurrency state machine. Because OCCT builds are synchronous WASM with no cooperative cancellation point, the only way to stop one is `worker.terminate()` — so the session terminates the worker, respawns a fresh one, and redispatches. `src/main.ts` loses its `buildToken` bookkeeping and becomes pure DOM wiring.

**Tech Stack:** TypeScript (strict), Vite, comlink, replicad/OCCT WASM, Node's native type-stripping for tests.

**Spec:** `docs/superpowers/specs/2026-07-28-build-cancellation-design.md`

## Global Constraints

- All paths below are relative to `hardcase-gridfinity-generator/`.
- Work happens on the existing branch `build-cancellation` (already created off `main`).
- `tsconfig.json` has `strict: true` and `isolatedModules: true` — type-only imports **must** use `import type`, or the build breaks.
- `tsconfig.json` `include` is `["src"]`, so `scripts/*.mjs` is **not** type-checked. Test files are plain JS with duck-typed fakes.
- `src/cad-session.ts` must contain **no browser globals** (`Worker`, `document`, `window`). The worker is supplied through an injected spawn function. This is what lets Node import it in the test.
- Intra-`src` imports of `.ts` files use explicit `.ts` extensions (`allowImportingTsExtensions` is on).
- Node is at `/usr/bin/node` (v22). If `node` is not on PATH, try `/home/linuxbrew/.linuxbrew/bin/node`.
- Do not change model geometry. `npm run smoke` must stay green and its expected values untouched.
- Do **not** touch `REBUILD_DEBOUNCE_MS` or `scheduleRebuild()`. The 2 s debounce stays: preemption makes an over-eager dispatch *correctable*, not free — partial work is still discarded and a respawn is still paid. Leaving `scheduleRebuild()` alone also keeps exports enabled during the debounce window, which is intended (they read `currentValues`, so they export exactly what was just typed).

---

### Task 1: `CadSession` — the concurrency state machine

**Files:**
- Create: `src/cad-session.ts`
- Create: `scripts/session-test.mjs`
- Modify: `package.json` (add the `test:session` script)

**Interfaces:**
- Consumes: `CadWorkerApi` (type only) from `src/worker.ts`; `ParamValues` (type only) from `src/models`.
- Produces, for Task 2:
  - `class CadSession` with `constructor(spawn: () => WorkerHandle)`
  - `session.build(modelId: string, values: ParamValues): Promise<ShapeMeshes[]>`
  - `session.exportModel(kind: ExportKind, modelId: string, values: ParamValues): Promise<Blob>`
  - `session.busy: boolean` (getter), `session.exporting: boolean` (getter)
  - `session.onBusyChange?: (busy: boolean) => void` (assignable property)
  - `class Cancelled extends Error`
  - `type ExportKind = "stl" | "step" | "3mf"`
  - `interface WorkerHandle { api: CadApi; terminate(): void }`
  - `interface CadApi` — `mesh` / `exportSTL` / `exportSTEP` / `export3MF`

#### Cycle A — build preemption

- [ ] **Step 1: Write the failing test**

Create `scripts/session-test.mjs`:

```js
// Unit test for the CadSession concurrency state machine. Uses a fake worker
// handle with manually-settled promises, so it never loads OCCT and runs in
// about a second. Node strips the types from cad-session.ts on import; its
// `import type` lines are erased, so ./worker.ts and ./models are never
// actually resolved here.
import assert from "node:assert/strict";

const { CadSession, Cancelled } = await import("../src/cad-session.ts");

/**
 * A spawn function plus the list of workers it has handed out. Each fake
 * records the calls made to it and lets the test settle them by hand, so the
 * test controls exactly when a "build" finishes.
 */
function makeSpawn() {
  const spawned = [];
  const spawn = () => {
    const calls = [];
    const record = (method) => (modelId, values) => {
      let settle;
      const promise = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      calls.push({ method, modelId, values, ...settle });
      return promise;
    };
    const handle = {
      terminated: false,
      calls,
      api: {
        mesh: record("mesh"),
        exportSTL: record("exportSTL"),
        exportSTEP: record("exportSTEP"),
        export3MF: record("export3MF"),
      },
      terminate: () => {
        handle.terminated = true;
      },
    };
    spawned.push(handle);
    return handle;
  };
  return { spawn, spawned };
}

const terminatedCount = (spawned) => spawned.filter((h) => h.terminated).length;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("build from idle dispatches without respawning", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const built = session.build("bin-no-lid", { n: 1 });

  assert.equal(spawned.length, 1, "must reuse the worker it started with");
  assert.equal(spawned[0].terminated, false);
  assert.equal(spawned[0].calls.length, 1);
  assert.equal(spawned[0].calls[0].method, "mesh");

  spawned[0].calls[0].resolve(["MESHES"]);
  assert.deepEqual(await built, ["MESHES"]);
});

test("a build during a build terminates the first and rejects it", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const first = session.build("perimeter", { n: 1 });
  const second = session.build("perimeter", { n: 2 });

  await assert.rejects(first, (e) => e instanceof Cancelled);
  assert.equal(spawned.length, 2, "must respawn after terminating");
  assert.equal(spawned[0].terminated, true);
  assert.equal(spawned[1].terminated, false);
  assert.equal(spawned[1].calls[0].values.n, 2, "the newest values must win");

  spawned[1].calls[0].resolve(["SECOND"]);
  assert.deepEqual(await second, ["SECOND"]);
});

test("three rapid builds terminate twice and never queue", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const a = session.build("perimeter", { n: 1 });
  const b = session.build("perimeter", { n: 2 });
  const c = session.build("perimeter", { n: 3 });

  await assert.rejects(a, (e) => e instanceof Cancelled);
  await assert.rejects(b, (e) => e instanceof Cancelled);
  assert.equal(terminatedCount(spawned), 2);
  assert.equal(spawned.length, 3);
  for (const handle of spawned) {
    assert.equal(handle.calls.length, 1, "a worker must never receive a second job");
  }

  spawned[2].calls[0].resolve(["THIRD"]);
  assert.deepEqual(await c, ["THIRD"]);
});

test("onBusyChange does not flicker across a preemption", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);
  const events = [];
  session.onBusyChange = (busy) => events.push(busy);

  const first = session.build("perimeter", { n: 1 });
  const second = session.build("perimeter", { n: 2 });
  await assert.rejects(first, (e) => e instanceof Cancelled);

  assert.deepEqual(events, [true], "must stay busy while redispatching");

  spawned[1].calls[0].resolve([]);
  await second;
  assert.deepEqual(events, [true, false]);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL - ${name}`);
    console.log(String(error?.message ?? error).replace(/^/gm, "       "));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` after the `"smoke"` line:

```json
    "test:session": "node scripts/session-test.mjs",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:session`
Expected: FAIL — `Cannot find module` / `ERR_MODULE_NOT_FOUND` for `../src/cad-session.ts`, because the module does not exist yet.

- [ ] **Step 4: Write the minimal implementation**

Create `src/cad-session.ts`:

```ts
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
  #wasBusy = false;

  /** Fires only on real edge transitions, never mid-preemption. */
  onBusyChange?: (busy: boolean) => void;

  constructor(spawn: () => WorkerHandle) {
    this.#spawn = spawn;
    this.#handle = spawn();
  }

  get busy(): boolean {
    return this.#job !== null;
  }

  get exporting(): boolean {
    return this.#job?.kind === "export";
  }

  build(modelId: string, values: ParamValues): Promise<ShapeMeshes[]> {
    if (this.#job) this.#kill();
    return this.#run("build", (api) => api.mesh(modelId, values));
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
          this.#sync();
        },
        (error) => {
          if (this.#job !== job) return;
          this.#job = null;
          reject(error);
          this.#sync();
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:session`
Expected output:

```
ok   - build from idle dispatches without respawning
ok   - a build during a build terminates the first and rejects it
ok   - three rapid builds terminate twice and never queue
ok   - onBusyChange does not flicker across a preemption

4/4 passed
```

- [ ] **Step 6: Commit**

```bash
git add src/cad-session.ts scripts/session-test.mjs package.json
git commit -m "Add CadSession with build preemption"
```

#### Cycle B — exports and the deferred slot

- [ ] **Step 7: Write the failing tests**

In `scripts/session-test.mjs`, insert these two tests immediately before the `let failed = 0;` line:

```js
test("a build during an export defers instead of killing the export", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("stl", "perimeter", { n: 1 });
  const built = session.build("perimeter", { n: 2 });

  assert.equal(spawned.length, 1, "an export must never be preempted");
  assert.equal(spawned[0].terminated, false);
  assert.equal(spawned[0].calls.length, 1, "the build must not be dispatched yet");
  assert.equal(session.exporting, true);

  spawned[0].calls[0].resolve("BLOB");
  assert.equal(await exported, "BLOB");

  assert.equal(spawned[0].calls.length, 2, "the deferred build runs once the export lands");
  assert.equal(spawned[0].calls[1].method, "mesh");
  spawned[0].calls[1].resolve(["DEFERRED"]);
  assert.deepEqual(await built, ["DEFERRED"]);
});

test("a second build during an export replaces the deferred one", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("step", "perimeter", { n: 1 });
  const first = session.build("perimeter", { n: 2 });
  const second = session.build("perimeter", { n: 3 });

  await assert.rejects(first, (e) => e instanceof Cancelled);
  assert.equal(spawned[0].calls.length, 1, "deferred builds must not accumulate");

  spawned[0].calls[0].resolve("BLOB");
  await exported;

  assert.equal(spawned[0].calls[1].values.n, 3, "the newest deferred build wins");
  spawned[0].calls[1].resolve(["SECOND"]);
  assert.deepEqual(await second, ["SECOND"]);
});
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npm run test:session`
Expected: the four Cycle A tests still pass; both new tests FAIL with `session.exportModel is not a function`.

- [ ] **Step 9: Extend the implementation**

In `src/cad-session.ts`, add this interface after the `Job` interface:

```ts
interface Deferred {
  modelId: string;
  values: ParamValues;
  resolve: (meshes: ShapeMeshes[]) => void;
  reject: (reason: unknown) => void;
}
```

Add this constant after the `Deferred` interface:

```ts
const EXPORT_METHOD = {
  stl: "exportSTL",
  step: "exportSTEP",
  "3mf": "export3MF",
} as const;
```

Add the deferred field next to `#job`:

```ts
  #deferred: Deferred | null = null;
```

Replace the `busy` getter so a parked build still counts as busy:

```ts
  get busy(): boolean {
    return this.#job !== null || this.#deferred !== null;
  }
```

Replace the `build` method:

```ts
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
```

Then, in `#run`, replace **both** `this.#sync();` calls inside the `.then(...)` settle callbacks with `this.#drain();`. Leave the `this.#sync();` immediately after `this.#job = job;` alone.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm run test:session`
Expected output:

```
ok   - build from idle dispatches without respawning
ok   - a build during a build terminates the first and rejects it
ok   - three rapid builds terminate twice and never queue
ok   - onBusyChange does not flicker across a preemption
ok   - a build during an export defers instead of killing the export
ok   - a second build during an export replaces the deferred one

6/6 passed
```

- [ ] **Step 11: Commit**

```bash
git add src/cad-session.ts scripts/session-test.mjs
git commit -m "Defer builds behind in-flight exports"
```

---

### Task 2: Wire `main.ts` to the session

**Files:**
- Modify: `src/main.ts:10-12` (worker construction), `:27-28` (token/timer state), `:39-55` (`rebuild`), `:83-100` (`exportModel`)

**Interfaces:**
- Consumes: `CadSession`, `Cancelled`, `ExportKind` from `src/cad-session.ts` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the module-scope worker with a session**

In `src/main.ts`, delete these lines (currently 10-12):

```ts
const worker = wrap<CadWorkerApi>(
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
) as Remote<CadWorkerApi>;
```

Change the import block at the top so it reads:

```ts
import "./style.css";
import { wrap } from "comlink";
import type { Remote } from "comlink";
import { models, modelById, defaultValues } from "./models";
import type { ParamValues } from "./models";
import type { CadWorkerApi } from "./worker";
import { Viewer } from "./viewer";
import { renderParamsForm } from "./params-form";
import { CadSession, Cancelled } from "./cad-session.ts";
import type { ExportKind, WorkerHandle } from "./cad-session.ts";
```

Then, immediately **after** the `const spinner = ...` line (currently line 23), insert:

```ts
/** Spawn a real OCCT worker. Called again each time a build is preempted. */
function spawnWorker(): WorkerHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    api: wrap<CadWorkerApi>(worker) as Remote<CadWorkerApi>,
    terminate: () => worker.terminate(),
  };
}

const session = new CadSession(spawnWorker);

// One sink for every piece of busy-state UI: the spinner and the export
// buttons. index.html already ships the idle state (no `active` class, no
// `disabled`), which is what the session assumes at construction.
session.onBusyChange = (busy) => {
  spinner.classList.toggle("active", busy);
  for (const b of exportButtons) b.disabled = busy;
};
```

- [ ] **Step 2: Delete the build token and simplify `rebuild`**

Delete the `let buildToken = 0;` line (currently line 27).

Replace the whole `rebuild` function (currently lines 39-55) with:

```ts
async function rebuild(): Promise<void> {
  setStatus(session.exporting ? "queued behind export…" : "building…");
  const started = performance.now();
  try {
    const meshes = await session.build(currentModelId, currentValues);
    viewer.update(meshes);
    setStatus(`built in ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    // A newer build has already taken over the status line and the spinner.
    if (error instanceof Cancelled) return;
    setStatus(`build failed: ${error instanceof Error ? error.message : error}`, true);
  }
}
```

- [ ] **Step 3: Simplify `exportModel`**

Replace the whole `exportModel` function (currently lines 83-100) with:

```ts
async function exportModel(kind: ExportKind): Promise<void> {
  setStatus(`exporting ${kind.toUpperCase()}…`);
  try {
    const blob = await session.exportModel(kind, currentModelId, currentValues);
    download(blob, `${currentModelId}.${kind}`);
    setStatus(`${kind.toUpperCase()} exported`);
  } catch (error) {
    setStatus(`export failed: ${error instanceof Error ? error.message : error}`, true);
  }
}
```

The manual `b.disabled` loops are gone on purpose — `onBusyChange` owns that now.

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean, then a successful Vite build writing `dist/`.

Two failures are plausible here, both with a known fix:

- `exportButtons` or `spinner` used before declaration → move the `spawnWorker`/`session`/`onBusyChange` block below **all** the `const` DOM lookups (it must sit after `const spinner`).
- `Remote<CadWorkerApi>` not assignable to `CadApi` → comlink's `Remote` should match structurally, but if it does not, narrow the cast in `spawnWorker` to `wrap<CadWorkerApi>(worker) as unknown as CadApi` and import `CadApi` as a type from `./cad-session.ts`. Do **not** loosen `CadApi` itself — its precise signatures are what make the fake in the test meaningful.

- [ ] **Step 5: Verify nothing still references the old token**

Run: `grep -n "buildToken\|worker\." src/main.ts`
Expected: no `buildToken` hits at all; `worker.` appears only inside `spawnWorker` (`worker.terminate()`).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "Drive builds and exports through CadSession"
```

---

### Task 3: Documentation and end-to-end verification

**Files:**
- Modify: `README.md` (commands list ~line 12-16, architecture bullets ~line 49-55)
- Modify: `../CLAUDE.md` (Commands section, Architecture section)

**Interfaces:**
- Consumes: the finished behavior from Tasks 1-2.
- Produces: nothing.

- [ ] **Step 1: Update the README commands list**

In `README.md`, add after the `npm run smoke` line:

```
npm run test:session # CadSession concurrency unit test (no OCCT, ~1 s)
```

- [ ] **Step 2: Update the README architecture bullets**

In `README.md`, replace the `- src/main.ts — UI wiring: model selector, debounced parameter form, export buttons.` bullet with:

```markdown
- `src/cad-session.ts` — owns the CAD worker and serializes work on it: a newer
  build terminates and respawns the worker rather than queueing behind the
  in-flight one (OCCT builds are synchronous WASM, so `terminate()` is the only
  way to stop one). Exports are never cancelled; a build requested mid-export
  waits in a single latest-wins slot. Takes an injected spawn function, so it
  holds no browser globals and is unit-tested in Node.
- `src/main.ts` — UI wiring: model selector, debounced parameter form,
  export buttons.
```

- [ ] **Step 3: Update CLAUDE.md**

In `../CLAUDE.md`, add to the Commands list after the `npm run smoke` bullet:

```markdown
- `npm run test:session` — unit-tests the `CadSession` build/export concurrency
  state machine with a fake worker (no OCCT; runs in ~1 s)
```

In the same file's Architecture section, insert before the `src/worker.ts` bullet:

```markdown
- `src/cad-session.ts` — worker lifecycle + build concurrency. A new build
  preempts the in-flight one by terminating and respawning the worker (OCCT
  builds are synchronous WASM with no cancellation point); exports are never
  preempted, and a build requested during one parks in a single latest-wins
  slot. The worker arrives via an injected spawn function, keeping the module
  browser-global-free and testable in Node.
```

- [ ] **Step 4: Run the full test suite**

Run: `npm run test:session && npm run build && npm run smoke`
Expected: 6/6 session tests pass; `tsc` clean and Vite build succeeds; smoke prints a pass line for all 8 models and exits 0. Smoke takes several minutes — the perimeter models alone are ~2 minutes.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, open the printed URL.

Check each of these:
1. Select **Perimeter**. Wait for the first build to finish (spinner stops, status shows `built in …`).
2. Edit a parameter, wait ~2 s for the build to start, then edit again. The status must return to `building…` and the *total* elapsed time must be roughly one build, not two — the first build stops rather than running to completion. (Before this change, the second result took two full builds to appear.)
3. While a build is running, confirm all three download buttons are greyed out, and that they re-enable when it finishes.
4. Click **Download STL** on Perimeter. While it runs, edit a parameter. The export must still complete and download a file; the status shows `queued behind export…`; the rebuild starts only after the download lands.
5. Switch models mid-build. The new model must appear without waiting out the old build.

- [ ] **Step 6: Commit**

```bash
git add README.md ../CLAUDE.md
git commit -m "Document the CadSession build pipeline"
```

---

## Done criteria

- `npm run test:session` — 6/6 pass
- `npm run build` — clean
- `npm run smoke` — all 8 models pass, expected values unchanged
- Manual checks in Task 3 Step 5 all hold
- `buildToken` no longer exists anywhere in `src/`
