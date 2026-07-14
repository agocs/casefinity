// Interrogate a STEP file with the OCCT kernel: per-solid volume, bbox,
// face count, and quantized vertex-coordinate histograms (useful to find
// rib positions, wall thicknesses and feature offsets when porting).
//
// Usage: node scripts/analyze-step.mjs <file.step> [axis-detail: x|y|z]
import { importStepSolids, replicad } from "./occt-utils.mjs";

const { measureVolume, measureArea } = replicad;

const [file, detailAxis] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/analyze-step.mjs <file.step> [x|y|z]");
  process.exit(2);
}

const solids = await importStepSolids(file);

console.log(`${file}: ${solids.length} solid(s)`);
for (const [index, solid] of solids.entries()) {
  const [lo, hi] = solid.boundingBox.bounds;
  const dims = hi.map((v, i) => v - lo[i]);
  console.log(`\nsolid ${index}:`);
  console.log(`  bbox   ${dims.map((d) => d.toFixed(3)).join(" x ")}`);
  console.log(`  origin ${lo.map((v) => v.toFixed(3)).join(", ")}`);
  console.log(`  volume ${measureVolume(solid).toFixed(0)} mm^3`);
  console.log(`  area   ${measureArea(solid).toFixed(0)} mm^2`);
  console.log(`  faces  ${solid.faces.length}`);

  const mesh = solid.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const axes = { x: 0, y: 1, z: 2 };
  for (const [axis, offset] of Object.entries(axes)) {
    const counts = new Map();
    for (let i = offset; i < mesh.vertices.length; i += 3) {
      const value = Math.round(mesh.vertices[i] * 100) / 100;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const popular = [...counts.entries()]
      .filter(([, n]) => n >= 4)
      .sort((a, b) => a[0] - b[0])
      .map(([v, n]) => (axis === detailAxis ? `${v}(${n})` : v));
    console.log(`  ${axis} planes: ${popular.join(" ")}`);
  }
}
