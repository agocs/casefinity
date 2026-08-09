import initOpenCascade from "replicad-opencascadejs/src/replicad_single.js";
import opencascadeWasm from "replicad-opencascadejs/src/replicad_single.wasm?url";
import { setOC, loadFont } from "replicad";
import type { Shape3D } from "replicad";
import { expose } from "comlink";
import type { ParamValues } from "./models";
import { buildParts, stepBlob, stlBlob, threeMfBlob } from "./exports.ts";

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

const api = {
  async ready(): Promise<boolean> {
    await init();
    return true;
  },

  /** Build the model and return serializable face + edge meshes per shape. */
  async mesh(modelId: string, params: ParamValues) {
    await init();
    return buildParts(modelId, params).map(({ shape }) => ({
      faces: shape.mesh({ tolerance: 0.05, angularTolerance: 30 }),
      edges: shape.meshEdges(),
    }));
  },

  async exportSTL(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    return stlBlob(buildParts(modelId, params));
  },

  async exportSTEP(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    return stepBlob(buildParts(modelId, params));
  },

  async export3MF(modelId: string, params: ParamValues): Promise<Blob> {
    await init();
    const bytes = threeMfBlob(buildParts(modelId, params), modelId);
    return new Blob([bytes], { type: "model/3mf" });
  },
};

export type CadWorkerApi = typeof api;

expose(api);
