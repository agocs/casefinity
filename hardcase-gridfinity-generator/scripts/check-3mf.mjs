// Verifies the .3mf export end-to-end with the real OCCT kernel: builds a few
// models, generates the 3MF package, unzips it, checks the OPC structure and
// per-object/item counts, and confirms each part's mesh is watertight AND
// wound outward (3MF has no per-facet normals — orientation is winding-only)
// by comparing the mesh's signed volume to the exact solid volume.
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
globalThis.require = require;
globalThis.__dirname = dirname(
  require.resolve("replicad-opencascadejs/src/replicad_single.js"),
);

const { default: initOpenCascade } = await import(
  "replicad-opencascadejs/src/replicad_single.js"
);
const { setOC, measureVolume, loadFont } = await import("replicad");
const { unzipSync, strFromU8 } = await import("fflate");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

setOC(await initOpenCascade());
const fontBuf = readFileSync(
  fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url)),
).buffer;
await loadFont(fontBuf, "LiberationSans");

const { modelById, defaultValues } = await import("../src/models/index.ts");
const { build3mf, partNames } = await import("../src/three-mf.ts");

// signed volume of a closed triangle mesh; sign follows winding (outward CCW > 0)
function meshSignedVolume({ vertices, triangles }) {
  let vol = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3, b = triangles[i + 1] * 3, c = triangles[i + 2] * 3;
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

const cases = ["perimeter", "bin-no-lid", "bin-with-lid", "bin-double-sided", "solid-block"];
let failed = false;
const fail = (m) => { console.error("  FAIL: " + m); failed = true; };

for (const id of cases) {
  const model = modelById(id);
  const result = model.build(defaultValues(model));
  const shapes = Array.isArray(result) ? result : [result];
  const names = partNames(id, shapes.length);
  const parts = shapes.map((s, i) => ({ name: names[i], mesh: s.mesh({ tolerance: 0.01, angularTolerance: 30 }) }));
  const bytes = build3mf(parts, id);

  const files = unzipSync(bytes);
  const paths = Object.keys(files);
  console.log(`${id}: ${shapes.length} part(s), ${bytes.length} bytes, entries: ${paths.join(", ")}`);

  for (const req of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]) {
    if (!paths.includes(req)) fail(`missing package part ${req}`);
  }
  const xml = strFromU8(files["3D/3dmodel.model"]);
  const objectCount = (xml.match(/<object /g) || []).length;
  const itemCount = (xml.match(/<item /g) || []).length;
  if (objectCount !== shapes.length) fail(`expected ${shapes.length} objects, found ${objectCount}`);
  if (itemCount !== shapes.length) fail(`expected ${shapes.length} build items, found ${itemCount}`);
  if (!xml.includes('unit="millimeter"')) fail("model unit is not millimeter");
  for (const n of names) if (!xml.includes(`name="${n}"`)) fail(`object name "${n}" missing`);

  // watertight + outward-wound: signed mesh volume ≈ +exact solid volume
  shapes.forEach((shape, i) => {
    const exact = measureVolume(shape);
    const mesh = meshSignedVolume(parts[i].mesh);
    const rel = Math.abs(mesh - exact) / exact;
    const maxIdx = Math.max(...parts[i].mesh.triangles);
    if (maxIdx * 3 + 2 >= parts[i].mesh.vertices.length) fail(`${names[i]}: triangle index out of range`);
    if (mesh <= 0) fail(`${names[i]}: mesh signed volume ${mesh.toFixed(0)} <= 0 (inverted winding)`);
    else if (rel > 0.01) fail(`${names[i]}: mesh volume ${mesh.toFixed(0)} vs exact ${exact.toFixed(0)} (${(rel * 100).toFixed(2)}% — not watertight?)`);
    else console.log(`  OK ${names[i]}: mesh vol ${mesh.toFixed(0)} ≈ exact ${exact.toFixed(0)} (${(rel * 100).toFixed(3)}%)`);
  });
}

process.exit(failed ? 1 : 0);
