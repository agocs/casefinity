import initOpenCascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC, loadFont } from "replicad";
import type { Shape3D } from "replicad";
import { expose } from "comlink";
import { modelById, defaultValues } from "./models";
import type { ParamValues } from "./models";
import { build3mf, partNames } from "./three-mf";

let ready: Promise<void> | undefined;

function init(): Promise<void> {
  ready ??= (async () => {
    const oc = await initOpenCascade({ locateFile: () => opencascadeWasm });
    setOC(oc as Parameters<typeof setOC>[0]);
    // Load the bundled font for lid text engraving
    const fontResp = await fetch("/LiberationSans-Regular.ttf");
    const fontBuf = await fontResp.arrayBuffer();
    await loadFont(fontBuf, "LiberationSans");
  })();
  return ready;
}

function buildShapes(modelId: string, params: ParamValues): Shape3D[] {
  const model = modelById(modelId);
  const values = { ...defaultValues(model), ...params };
  const result = model.build(values);
  return Array.isArray(result) ? result : [result];
}

function fused(modelId: string, params: ParamValues): Shape3D {
  const shapes = buildShapes(modelId, params);
  return shapes.reduce((a, b) => a.fuse(b));
}

const api = {
  async ready(): Promise<boolean> {
    await init();
    return true;
  },

  /** Build the model and return serializable face + edge meshes per shape. */
  async mesh(modelId: string, params: ParamValues) {
    await init();
    return buildShapes(modelId, params).map((shape) => ({
      faces: shape.mesh({ tolerance: 0.05, angularTolerance: 30 }),
      edges: shape.meshEdges(),
    }));
  },

  async exportSTL(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    return fused(modelId, params).blobSTL({ tolerance: 0.01 });
  },

  async exportSTEP(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    return fused(modelId, params).blobSTEP();
  },

  /**
   * Export .3mf with each build shape as its own object, so multi-part models
   * (perimeter pieces, bin body + lids) import as individually separable parts.
   */
  async export3MF(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    const shapes = buildShapes(modelId, params);
    const names = partNames(modelId, shapes.length);
    const parts = shapes.map((shape, i) => ({
      name: names[i],
      mesh: shape.mesh({ tolerance: 0.01, angularTolerance: 30 }),
    }));
    const bytes = build3mf(parts, modelId);
    return new Blob([bytes], { type: "model/3mf" });
  },
};

export type CadWorkerApi = typeof api;

expose(api);
