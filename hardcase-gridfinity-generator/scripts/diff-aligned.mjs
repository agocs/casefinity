// Like diff-model.mjs, but recenters both port and truth to their XY bbox
// centers before differencing (Z is kept, bottom at z=0). Needed for models
// whose ground truth lands in the +X/+Y quadrant after the Y-up->Z-up
// rotation (e.g. the perimeter), while ports are modeled centered on XY.
//
// Usage: node scripts/diff-aligned.mjs <modelId> <truth.step>
import { importStepSolids, replicad, slabVolume } from "./occt-utils.mjs";

const { measureVolume } = replicad;
const [modelId, truthFile] = process.argv.slice(2);
const { modelById, defaultValues } = await import("../src/models/index.ts");

const model = modelById(modelId);
const built = model.build(defaultValues(model));
const port = Array.isArray(built) ? built.reduce((a, b) => a.fuse(b)) : built;

const truthSolids = await importStepSolids(truthFile);
const truthRaw = truthSolids
  .map((s) => s.rotate(90, [0, 0, 0], [1, 0, 0])) // Y-up -> Z-up
  .reduce((a, b) => a.fuse(b));

/** Translate a shape so its bbox is centered on XY (Z left as-is). */
function centerXY(shape) {
  const [lo, hi] = shape.boundingBox.bounds;
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  return shape.translate(-cx, -cy, 0);
}

const truth = centerXY(truthRaw);
const portC = centerXY(port);

function describe(label, shape) {
  const [lo, hi] = shape.boundingBox.bounds;
  console.log(
    `${label}: vol ${measureVolume(shape).toFixed(1)} mm^3, ` +
      `bbox [${lo.map((v) => v.toFixed(2))}] .. [${hi.map((v) => v.toFixed(2))}]`,
  );
}

describe("port ", portC);
describe("truth", truth);

function slabProfile(label, shape, zMax) {
  const rows = [];
  for (let z = 0; z < zMax; z += 5) {
    const volume = slabVolume(shape, "z", z, z + 5);
    if (volume > 0.5) rows.push(`    z ${z}..${z + 5}: ${volume.toFixed(1)}`);
  }
  console.log(`  ${label} slab profile:`);
  console.log(rows.length ? rows.join("\n") : "    (nothing above 0.5 mm^3)");
}

const zMax = Math.max(portC.boundingBox.bounds[1][2], truth.boundingBox.bounds[1][2]);

const excess = portC.clone().cut(truth.clone());
describe("excess (port minus truth)", excess);
slabProfile("excess", excess, zMax);

const missing = truth.clone().cut(portC.clone());
describe("missing (truth minus port)", missing);
slabProfile("missing", missing, zMax);
