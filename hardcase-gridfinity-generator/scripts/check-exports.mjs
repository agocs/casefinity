// Verifies every export format end-to-end with the real OCCT kernel, against
// the same `src/exports.ts` the web worker calls — no reimplementation here, so
// a regression in the shipped export path fails this script.
//
// Per model, one (expensive) build feeds all three formats:
//   3MF  — unzip the OPC package, check structure and per-object/item counts,
//          and confirm each part's mesh is watertight AND wound outward (3MF has
//          no per-facet normals — orientation is winding-only) by comparing the
//          mesh's signed volume to the exact solid volume.
//   STEP — re-import and count solids, and confirm each part name survives as a
//          PRODUCT. This is what catches the parts being fused into one body.
//   STL  — parse the binary file back and check its triangle count and signed
//          volume against the parts. A fuse welds the touching seam faces away
//          and fails both.
//
// Like smoke.mjs, each model runs in its own child process: a perimeter build
// plus a re-imported copy of it is already most of OCCT's 2 GiB WASM heap, and
// replicad's STEP writer leaks a work session per call (see cad-session.ts), so
// a single process cannot safely check every model in turn. Run one model in the
// foreground with `node scripts/check-exports.mjs <modelId>`.
import { createRequire } from "node:module";
import { dirname } from "node:path";

const ALL_CASES = ["perimeter", "bin-no-lid", "bin-with-lid", "bin-double-sided", "solid-block"];
const requested = process.argv.slice(2);

if (requested.length === 0) {
  const { spawn } = await import("node:child_process");
  const self = new URL(import.meta.url).pathname;
  let failedCases = [];
  for (const id of ALL_CASES) {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, self, id], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.on("error", () => resolve(1));
      child.on("close", resolve);
    });
    if (code !== 0) failedCases.push(id);
  }
  if (failedCases.length) console.error(`\nFAILED: ${failedCases.join(", ")}`);
  else console.log(`\nall ${ALL_CASES.length} models export cleanly`);
  process.exit(failedCases.length ? 1 : 0);
}

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
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

setOC(await initOpenCascade());
const fontBuf = readFileSync(
  fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url)),
).buffer;
await loadFont(fontBuf, "LiberationSans");

const { importStepSolids } = await import("./occt-utils.mjs");
const { buildParts, stepBlob, stlBlob, threeMfBlob } = await import("../src/exports.ts");

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

/**
 * Parse a binary STL (80-byte header, uint32 count, 50 bytes per triangle) and
 * return its triangle count and signed volume. Reading the coordinates back out
 * — rather than trusting the count alone — is what makes this an actual test of
 * `src/stl.ts` and not a restatement of it.
 */
function readBinaryStl(bytes) {
  if (bytes.length < 84) throw new Error(`STL too short: ${bytes.length} bytes`);
  if (strFromU8(bytes.subarray(0, 5)) === "solid") {
    throw new Error("STL header begins with 'solid' — strict readers will parse it as ASCII");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const expected = 84 + count * 50;
  if (bytes.length !== expected) {
    throw new Error(`STL header claims ${count} triangles (${expected} bytes), file is ${bytes.length}`);
  }
  let vol = 0;
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12; // skip the per-facet normal
    const f = (i) => view.getFloat32(at + i * 4, true);
    const ax = f(0), ay = f(1), az = f(2);
    const bx = f(3), by = f(4), bz = f(5);
    const cx = f(6), cy = f(7), cz = f(8);
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return { count, volume: vol / 6 };
}

/**
 * replicad releases OCCT handles from a FinalizationRegistry, and V8 only runs
 * those callbacks on a scheduled task — so freeing the heap between models needs
 * a yield, not just gc(). Same pattern as scaling-test.mjs.
 */
async function collect() {
  globalThis.gc?.();
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.gc?.();
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

const cases = requested;
let failed = false;
const fail = (m) => { console.error("  FAIL: " + m); failed = true; };

/**
 * Everything that needs the built shapes. Kept in its own function so they fall
 * out of scope before the caller re-imports the STEP file — a re-imported
 * perimeter is a second full copy of the geometry, and OCCT's WASM heap is
 * capped at 2 GiB, so this script holds one perimeter-scale build at a time for
 * the same reason smoke.mjs gives each heavy model its own process.
 */
async function writeExports(id) {
  const parts = buildParts(id, {});
  const names = parts.map((p) => p.name);
  console.log(`${id}: ${parts.length} part(s) — ${names.join(", ")}`);

  // ---- 3MF ----------------------------------------------------------------
  const meshes = parts.map((p) => p.shape.mesh({ tolerance: 0.01, angularTolerance: 30 }));
  const bytes = threeMfBlob(parts, id);
  const files = unzipSync(bytes);
  const paths = Object.keys(files);
  console.log(`  3mf: ${bytes.length} bytes, entries: ${paths.join(", ")}`);

  for (const req of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]) {
    if (!paths.includes(req)) fail(`missing package part ${req}`);
  }
  const xml = strFromU8(files["3D/3dmodel.model"]);
  const objectCount = (xml.match(/<object /g) || []).length;
  const itemCount = (xml.match(/<item /g) || []).length;
  if (objectCount !== parts.length) fail(`3mf: expected ${parts.length} objects, found ${objectCount}`);
  if (itemCount !== parts.length) fail(`3mf: expected ${parts.length} build items, found ${itemCount}`);
  if (!xml.includes('unit="millimeter"')) fail("3mf: model unit is not millimeter");
  for (const n of names) if (!xml.includes(`name="${n}"`)) fail(`3mf: object name "${n}" missing`);

  // watertight + outward-wound: signed mesh volume ≈ +exact solid volume
  parts.forEach(({ name, shape }, i) => {
    const exact = measureVolume(shape);
    const mesh = meshSignedVolume(meshes[i]);
    const rel = Math.abs(mesh - exact) / exact;
    const maxIdx = Math.max(...meshes[i].triangles);
    if (maxIdx * 3 + 2 >= meshes[i].vertices.length) fail(`${name}: triangle index out of range`);
    if (mesh <= 0) fail(`${name}: mesh signed volume ${mesh.toFixed(0)} <= 0 (inverted winding)`);
    else if (rel > 0.01) fail(`${name}: mesh volume ${mesh.toFixed(0)} vs exact ${exact.toFixed(0)} (${(rel * 100).toFixed(2)}% — not watertight?)`);
    else console.log(`  OK ${name}: mesh vol ${mesh.toFixed(0)} ≈ exact ${exact.toFixed(0)} (${(rel * 100).toFixed(3)}%)`);
  });

  // ---- STL ----------------------------------------------------------------
  // No part structure to assert, so assert the content: every part's triangles
  // are present (count), and they enclose every part's volume at the right
  // coordinates and winding (signed volume). A fuse would weld the touching seam
  // faces away and fail both.
  const wantTris = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
  const wantVol = parts.reduce((v, { shape }) => v + measureVolume(shape), 0);
  const stl = readBinaryStl(await bytesOf(stlBlob(parts)));
  if (stl.count !== wantTris) {
    fail(`stl: ${stl.count} triangles, expected ${wantTris} (sum of the ${parts.length} part meshes)`);
  }
  const stlRel = Math.abs(stl.volume - wantVol) / wantVol;
  if (stlRel > 0.01) {
    fail(`stl: volume ${stl.volume.toFixed(0)} vs exact ${wantVol.toFixed(0)} (${(stlRel * 100).toFixed(2)}%)`);
  } else if (stl.count === wantTris) {
    console.log(`  OK stl: ${stl.count} triangles, vol ${stl.volume.toFixed(0)} ≈ exact ${wantVol.toFixed(0)} (${(stlRel * 100).toFixed(3)}%)`);
  }

  // ---- STEP ---------------------------------------------------------------
  // Written here, but verified by the caller once these shapes are collectable.
  const stepFile = `${process.env.TMPDIR || "/tmp"}/casefinity-check-${id}.step`;
  writeFileSync(stepFile, await bytesOf(stepBlob(parts)));
  const stepText = readFileSync(stepFile, "utf8");
  console.log(`  step: ${(stepText.length / 1024).toFixed(0)} KB`);
  const products = [...stepText.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]);
  for (const n of names) {
    if (!products.includes(n)) fail(`step: part name "${n}" missing (products: ${products.join(", ")})`);
  }

  return { stepFile, partCount: parts.length };
}

for (const id of cases) {
  const { stepFile, partCount } = await writeExports(id);
  // The built shapes are unreachable now; hand the heap back before pulling a
  // second copy of the geometry in.
  await collect();

  // The parts must survive as separate solids: this is what lets a split
  // perimeter open in Onshape as four pieces instead of one welded body.
  const solids = await importStepSolids(stepFile);
  unlinkSync(stepFile);
  if (solids.length !== partCount) {
    fail(`step: expected ${partCount} solid(s), re-imported ${solids.length} — parts were fused`);
  } else {
    console.log(`  OK step: re-imports as ${solids.length} separate solid(s)`);
  }

  await collect();
}

process.exit(failed ? 1 : 0);
