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
  // No STEP ground truth (a new corner treatment, not in the original Fusion
  // 360 designs) — bbox matches the base perimeter (only the cavity corner
  // changes); volume is self-derived (a square cavity corner removes less
  // material than the rounded arc, so it's slightly higher than perimeter's).
  "perimeter-square-corners": { x: 350, y: 250, z: 110, volume: 727573 },
  "bin-no-lid": { x: 46.3, y: 46.3, z: 115, volume: 28618 },
  "bin-with-lid": { x: 46.3, y: 46.3, z: 115, volume: 33579 }, // body + lid incl. +X rail, rounded top edge, TOP engraving (GT total 33723)
  // volume = GT total (body 68178 + two lids 9596 + 9577); smoke sums all shapes.
  "bin-double-sided": { x: 61.3, y: 61.3, z: 115, volume: 87351 },
  "perimeter-template": { x: 350, y: 250, z: 110 },
  // No STEP ground truth — a filled Bin (no lid). bbox matches the bin;
  // volume is self-derived (bin footprint solid + ribs - sockets/pull slot).
  "solid-block": { x: 46.3, y: 46.3, z: 115, volume: 220848 },
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

// ---------------------------------------------------------------------------
// Screw bosses at the split seams (perimeter.ts). Off by default, so the loop
// above never exercises them: build the perimeter once with bosses:1 and check
// the invariants that matter. Self-derived expected volume (no ground truth —
// the bosses are not in the original Fusion 360 designs).
//   - the split still yields 4 pieces, one clean solid each (a pad fused across
//     a seam, or a bore left half-cut, shows up as debris or a second solid);
//   - the bbox is untouched: a pad may not stand above the rim or outside the
//     case wall, or the frame stops fitting the case;
//   - total volume = boss-off 719856 + 8 pads (4 seams x 2 halves): 4 clearance
//     halves at 455.0 and 4 pilot halves at 473.1 mm3, the difference being the
//     narrower pilot bore;
//   - both holes are actually open: a probe cylinder just inside the pilot
//     diameter, run through BOTH pads of one joint, must meet no material, while
//     one just outside it must meet material on the pilot side (i.e. the pilot
//     hole really is the smaller of the two).
console.log("perimeter with screw bosses:");
{
  const { drawCircle } = await import("replicad");
  const { modelById } = await import("../src/models/index.ts");
  const model = modelById("perimeter");
  const p = { ...defaultValues(model), bosses: 1 };
  const started = Date.now();
  const pieces = model.build(p);
  const volume = pieces.reduce((sum, s) => sum + measureVolume(s), 0);
  console.log(`  ${pieces.length} piece(s), volume ${volume.toFixed(0)} mm3 (${Date.now() - started} ms)`);

  const check = (ok, msg) => {
    if (ok) console.log(`  OK: ${msg}`);
    else { console.error(`  FAIL: ${msg}`); failed = true; }
  };
  check(pieces.length === 4, `4 pieces (got ${pieces.length})`);

  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const shape of pieces) {
    const { vertices } = shape.mesh({ tolerance: 0.05, angularTolerance: 15 });
    for (let i = 0; i < vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], vertices[i + k]);
        hi[k] = Math.max(hi[k], vertices[i + k]);
      }
  }
  const dims = hi.map((v, i) => v - lo[i]);
  const wantBox = [350, 250, 110];
  check(
    dims.every((d, i) => Math.abs(d - wantBox[i]) <= 0.1),
    `bbox unchanged by the bosses (${dims.map((d) => d.toFixed(2)).join(" x ")})`,
  );

  const wantVolume = 723568;
  const relative = Math.abs(volume - wantVolume) / wantVolume;
  check(relative <= VOLUME_TOLERANCE, `volume within ${(VOLUME_TOLERANCE * 100).toFixed(1)}% of ${wantVolume}`);

  // Corner joint on the +Y long wall at x = +splitX, derived the same way the
  // model does: cavity length / 2, and the wall's inner face at the rim.
  const sideBoarder =
    p.overallLength - p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const splitX = (p.overallLength - sideBoarder) / 2;
  const pad = p.bossScrewDia + 0.1 + 2 * p.bossWall; // M3 clearance dia + walls
  // At the rim there is no taper shrink and no bottom-fillet inset, so the outer
  // wall's inner face is just the half-width less clearance and wall thickness.
  const wallFace = p.overallWidth / 2 - p.clearance - p.wallThick;
  const yAxis = wallFace + Math.min(0.4, p.wallThick / 2) - pad / 2;
  const zAxis = p.overallHeight - pad / 2;
  const pilotR = (p.bossHoleFactor * p.bossScrewDia) / 2;
  const probe = (r, x0, len) =>
    drawCircle(r).translate(yAxis, zAxis).sketchOnPlane("YZ", x0).extrude(len);
  const meets = (tool) => {
    let v = 0;
    for (const piece of pieces) {
      try { v += measureVolume(piece.clone().intersect(tool.clone())); } catch { /* no overlap */ }
    }
    return v;
  };
  const through = meets(probe(pilotR - 0.05, splitX - p.bossLen, 2 * p.bossLen));
  const around = meets(probe(pilotR + 0.15, splitX, p.bossLen));
  check(through < 0.01, `pilot+clearance holes open right through the joint (${through.toFixed(3)} mm3 of material)`);
  check(around > 1, `material immediately outside the pilot hole (${around.toFixed(2)} mm3)`);
}

process.exit(failed ? 1 : 0);
