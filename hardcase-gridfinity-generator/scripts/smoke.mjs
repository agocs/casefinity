// Node smoke test: builds every registered model at default parameters with
// the real OCCT kernel and sanity-checks dimensions. Uses Node's native
// TypeScript type-stripping to import the same source the site uses.
import { createRequire } from "node:module";
import { dirname } from "node:path";

// The emscripten build is an ES module that still references the CommonJS
// globals __dirname and require when it detects Node; provide them globally
// so it can locate and read its .wasm file.
const require = createRequire(import.meta.url);
globalThis.require = require;
globalThis.__dirname = dirname(
  require.resolve("replicad-opencascadejs/src/replicad_single.js"),
);

const { default: initOpenCascade } = await import(
  "replicad-opencascadejs/src/replicad_single.js"
);
const { setOC, measureVolume, loadFont } = await import("replicad");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

console.log("loading OCCT kernel…");
setOC(await initOpenCascade());

// Load the bundled font for lid text engraving (smoke tests need it)
const fontBuf = readFileSync(
  fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url)),
).buffer;
await loadFont(fontBuf, "LiberationSans");

const { models, defaultValues } = await import("../src/models/index.ts");

// Expected bounding boxes and volumes at default parameters, from the
// APS-converted STEP ground truth (see ../ground-truth/ and diff-model.mjs).
const expected = {
  perimeter: { x: 350, y: 250, z: 110 },
  "smooth-perimeter": { x: 350, y: 250, z: 110 },
  "bin-no-lid": { x: 46.3, y: 46.3, z: 115, volume: 28618 },
  "bin-with-lid": { x: 46.3, y: 46.3, z: 115, volume: 33644 },
  // volume = GT total (body 68178 + two lids 9596 + 9577); smoke sums all shapes.
  "bin-double-sided": { x: 61.3, y: 61.3, z: 115, volume: 87351 },
  "perimeter-template": { x: 350, y: 250, z: 110 },
};
const VOLUME_TOLERANCE = 0.005; // 0.5%

let failed = false;
for (const model of models) {
  const started = Date.now();
  const result = model.build(defaultValues(model));
  const shapes = Array.isArray(result) ? result : [result];

  // Measure the bounding box from the mesh (the geometry that actually gets
  // exported/rendered). OCCT's shape.boundingBox over-estimates for BSpline
  // surfaces — a lofted/filleted solid reports its control-point extent, not
  // the tight box — so it's unreliable for the perimeter-template slices.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const shape of shapes) {
    const { vertices } = shape.mesh({ tolerance: 0.05, angularTolerance: 15 });
    for (let i = 0; i < vertices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], vertices[i + k]);
        max[k] = Math.max(max[k], vertices[i + k]);
      }
    }
  }
  const dims = max.map((v, i) => v - min[i]);
  console.log(
    `${model.id}: ${shapes.length} solid(s), ` +
      `bbox ${dims.map((d) => d.toFixed(2)).join(" x ")} mm ` +
      `(${Date.now() - started} ms)`,
  );

  const want = expected[model.id];
  if (want) {
    const deltas = [dims[0] - want.x, dims[1] - want.y, dims[2] - want.z];
    if (deltas.some((d) => Math.abs(d) > 0.1)) {
      console.error(
        `  FAIL: expected ${want.x} x ${want.y} x ${want.z}, ` +
          `deltas ${deltas.map((d) => d.toFixed(3)).join(", ")}`,
      );
      failed = true;
    } else {
      console.log("  OK: matches ground-truth bounding box");
    }
    if (want.volume) {
      const volume = shapes.reduce((sum, s) => sum + measureVolume(s), 0);
      const relative = Math.abs(volume - want.volume) / want.volume;
      if (relative > VOLUME_TOLERANCE) {
        console.error(
          `  FAIL: volume ${volume.toFixed(0)} vs expected ${want.volume} ` +
            `(${(relative * 100).toFixed(2)}% off)`,
        );
        failed = true;
      } else {
        console.log(
          `  OK: volume ${volume.toFixed(0)} within ` +
            `${(VOLUME_TOLERANCE * 100).toFixed(1)}% of ground truth`,
        );
      }
    }
  }
}

process.exit(failed ? 1 : 0);
