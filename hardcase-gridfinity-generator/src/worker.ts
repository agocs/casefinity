import initOpenCascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC } from "replicad";
import type { Shape3D } from "replicad";
import { expose } from "comlink";
import { modelById, defaultValues } from "./models";
import type { ParamValues } from "./models";

let ready: Promise<void> | undefined;

function init(): Promise<void> {
  ready ??= initOpenCascade({ locateFile: () => opencascadeWasm }).then((oc) => {
    setOC(oc as Parameters<typeof setOC>[0]);
  });
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
};

export type CadWorkerApi = typeof api;

expose(api);
