// Slice a STEP solid into slabs along an axis and report per-slab volume and
// section bounds — localizes where a port diverges from ground truth.
// Usage: node scripts/probe-step.mjs <file.step> <axis: x|y|z> <from> <to> <step>
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.require = require;
globalThis.__dirname = dirname(
  require.resolve("replicad-opencascadejs/src/replicad_single.js"),
);

const { default: initOpenCascade } = await import(
  "replicad-opencascadejs/src/replicad_single.js"
);
const { setOC, importSTEP, measureVolume, drawRectangle } = await import("replicad");
setOC(await initOpenCascade());

const [file, axis = "y", fromArg = "0", toArg = "115", stepArg = "5"] =
  process.argv.slice(2);
const [from, to, step] = [fromArg, toArg, stepArg].map(Number);

const blob = new Blob([readFileSync(file)]);
const solid = await importSTEP(blob);

// slab(a, b): a big box covering [a, b] along the chosen axis
// plane names chosen so the normal (right-hand rule) points along +axis
const planes = { x: "YZ", y: "ZX", z: "XY" };
function slab(a, b) {
  const sketch = drawRectangle(1000, 1000).sketchOnPlane(planes[axis], a);
  return sketch.extrude(b - a);
}

console.log(`${file} — slabs along ${axis}`);
for (let a = from; a < to; a += step) {
  const b = Math.min(a + step, to);
  const section = solid.clone().intersect(slab(a, b));
  const volume = measureVolume(section);
  if (volume < 1e-6) {
    console.log(`${a.toFixed(2)}..${b.toFixed(2)}: empty`);
    continue;
  }
  const [lo, hi] = section.boundingBox.bounds;
  const dims = hi.map((v, i) => v - lo[i]);
  console.log(
    `${a.toFixed(2)}..${b.toFixed(2)}: vol ${volume.toFixed(1).padStart(9)}  ` +
      `section ${dims.map((d) => d.toFixed(2)).join(" x ")}`,
  );
}
