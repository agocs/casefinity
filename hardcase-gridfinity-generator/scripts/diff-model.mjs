// Boolean-diff a ported model against its ground-truth STEP.
// The STEP files are exported Y-up; they are rotated to the ports' Z-up frame.
// Reports volumes, then localizes discrepancies: port-not-truth (excess) and
// truth-not-port (missing), each with bbox and a slab profile along Z.
//
// Usage: node scripts/diff-model.mjs <modelId> <truth.step>
import { importStepSolids, replicad, slabVolume } from "./occt-utils.mjs";

const { measureVolume } = replicad;
const [modelId, truthFile] = process.argv.slice(2);
const { modelById, defaultValues } = await import("../src/models/index.ts");

const model = modelById(modelId);
const built = model.build(defaultValues(model));
const port = Array.isArray(built) ? built.reduce((a, b) => a.fuse(b)) : built;

const truthSolids = await importStepSolids(truthFile);
const truth = truthSolids
  .map((s) => s.rotate(90, [0, 0, 0], [1, 0, 0])) // Y-up -> Z-up
  .reduce((a, b) => a.fuse(b));

function describe(label, shape) {
  const [lo, hi] = shape.boundingBox.bounds;
  console.log(
    `${label}: vol ${measureVolume(shape).toFixed(1)} mm^3, ` +
      `bbox [${lo.map((v) => v.toFixed(2))}] .. [${hi.map((v) => v.toFixed(2))}]`,
  );
}

describe("port ", port);
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

const zMax = Math.max(port.boundingBox.bounds[1][2], truth.boundingBox.bounds[1][2]);

const excess = port.clone().cut(truth.clone());
describe("excess (port minus truth)", excess);
slabProfile("excess", excess, zMax);

const missing = truth.clone().cut(port.clone());
describe("missing (truth minus port)", missing);
slabProfile("missing", missing, zMax);
