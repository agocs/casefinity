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
//
// A `params` entry overrides the defaults for the VOLUME check only (the bbox
// is always measured at the shipped defaults). It exists so a ground-truth
// volume can stay a ground-truth volume where a default deliberately deviates:
// registration.ts ships a 3 mm grid bump and a 2 deg bump draft for
// printability, the originals used 1.2 mm and no draft. Volumes marked
// self-derived carry no such pin — they track whatever the shipped defaults
// produce.
//
// The draft override matters less than it looks but is kept honest anyway: it
// narrows every rib and widens every socket by the same ~0.10 mm, so the two
// nearly cancel in a bin's total (bin-no-lid moves 28618 -> 28620). Volume is
// simply the wrong instrument for it — see the dedicated draft check below.
const expected = {
  perimeter: { x: 350, y: 250, z: 110 },
  "smooth-perimeter": { x: 350, y: 250, z: 110 },
  // No STEP ground truth (a new corner treatment, not in the original Fusion
  // 360 designs) — bbox matches the base perimeter (only the cavity corner
  // changes); volume is self-derived (a square cavity corner removes less
  // material than the rounded arc, so it's slightly higher than perimeter's).
  // 727573 at the original 1.2 mm grid bump; +29574 at the shipped defaults,
  // almost all of it the 3 mm grid bump widening the cavity-wall ribs, their
  // backing bosses and the dividers. The 2 deg draft accounts for +34 of it:
  // it takes material off every rib and puts slightly more back by narrowing
  // every groove, and this model has more grooves than ribs in play.
  "perimeter-square-corners": { x: 350, y: 250, z: 110, volume: 757147 },
  "bin-no-lid": { x: 46.3, y: 46.3, z: 115, volume: 28618, params: { ribWidth: 1.2, draftAngle: 0 } },
  // body + lid: plate flush with the rim, both rail beads, the lock swell, the
  // +X rail ledge, the finger scoop, the socket notches and the TOP engraving.
  // GT total 33722, i.e. 0.09% — the residual is the engraving (a different
  // font from the original) plus the pull slot's draft.
  "bin-with-lid": { x: 46.3, y: 46.3, z: 115, volume: 33754, params: { ribWidth: 1.2, draftAngle: 0 } },
  // volume = GT total (body 68178 + two lids 9596 + 9577); smoke sums all shapes.
  "bin-double-sided": { x: 61.3, y: 61.3, z: 115, volume: 87351, params: { ribWidth: 1.2, draftAngle: 0 } },
  "perimeter-template": { x: 350, y: 250, z: 110 },
  // No STEP ground truth — a filled Bin (no lid). bbox matches the bin;
  // volume is self-derived (bin footprint solid + ribs - sockets/pull slot).
  "solid-block": { x: 46.3, y: 46.3, z: 115, volume: 220843 },
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
      // Rebuild with the pinned params when the expected volume is measured
      // against the ground truth at values the defaults deviate from.
      let volumeShapes = shapes;
      if (want.params) {
        const pinned = model.build({ ...defaultValues(model), ...want.params });
        volumeShapes = Array.isArray(pinned) ? pinned : [pinned];
      }
      const volume = volumeShapes.reduce((sum, s) => sum + measureVolume(s), 0);
      const relative = Math.abs(volume - want.volume) / want.volume;
      const at = want.params
        ? ` at ${Object.entries(want.params).map(([k, v]) => `${k}=${v}`).join(", ")}`
        : "";
      if (relative > VOLUME_TOLERANCE) {
        console.error(
          `  FAIL: volume${at} ${volume.toFixed(0)} vs expected ${want.volume} ` +
            `(${(relative * 100).toFixed(2)}% off)`,
        );
        failed = true;
      } else {
        console.log(
          `  OK: volume${at} ${volume.toFixed(0)} within ` +
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
//   - total volume = boss-off + 8 pads (4 seams x 2 halves): 4 clearance halves
//     at ~455.0 and 4 pilot halves at ~473.1 mm3, the difference being the
//     narrower pilot bore, less 4 x 1.35 mm3 for the clearance-mouth chamfers.
//     (Boss-off was 719856 at the original 1.2 mm grid bump; the pads
//     themselves derive from the screw size, not the bump.)
//   - both holes are actually open: a probe cylinder just inside the pilot
//     diameter, run through BOTH pads of one joint, must meet no material, while
//     one just outside it must meet material on the pilot side (i.e. the pilot
//     hole really is the smaller of the two).
//   - the 45 deg lead-in chamfer is on the clearance hole's outer mouth and
//     ONLY there. It is the marker for which end takes the screw, so a chamfer
//     that migrated to the pilot end, or appeared on both, would mislead
//     someone assembling the frame — a probe at the chamfered radius must find
//     the clearance mouth open and the pilot mouth solid.
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

  const wantVolume = 753137;
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

  // The lead-in chamfer. `around` above located the pilot half at x > splitX, so
  // the clearance half runs [splitX - bossLen, splitX] and its outer mouth is at
  // x = splitX - bossLen. Probe at a radius the chamfer has opened but the plain
  // bore has not: empty in the chamfer's own span, solid just past it.
  const clearR = (p.bossScrewDia + 0.1) / 2; // M3 max major dia
  const ch = Math.min(0.5, p.bossWall - 0.2);
  const mouth = splitX - p.bossLen;
  const ring = clearR + ch - 0.1;
  const inChamfer = meets(probe(ring, mouth, 0.1));
  const pastChamfer = meets(probe(ring, mouth + ch + 0.1, 0.5));
  check(inChamfer < 0.01,
    `clearance mouth chamfered to r>=${ring.toFixed(2)} (${inChamfer.toFixed(3)} mm3 of material in the chamfer)`);
  check(pastChamfer > 1.5,
    `chamfer runs out after ${ch} mm, bore back to r=${clearR.toFixed(2)} (${pastChamfer.toFixed(2)} mm3)`);
  // ...and the pilot end is NOT chamfered, so the two ends stay tellable apart.
  const pilotMouth = meets(probe(ring, splitX + p.bossLen - 0.6, 0.5));
  check(pilotMouth > 1.5, `pilot mouth left sharp (${pilotMouth.toFixed(2)} mm3 of material at the same radius)`);
}

// ---------------------------------------------------------------------------
// Grid-bump draft (registration.ts). Neither bbox nor volume can see it: the
// draft is taken about the wall's normal, so the ribs still reach exactly as
// far, and the material it shaves off every rib it very nearly puts back by
// narrowing every socket. Measure the rib's width directly instead — in a thin
// slab near its root and another near its tip — and check the taper is the
// 2*depth*tan(draft) the angle implies.
console.log("grid bump draft:");
{
  const { drawRectangle } = await import("replicad");
  const { modelById } = await import("../src/models/index.ts");
  const model = modelById("bin-no-lid");
  const p = defaultValues(model);
  const bin = model.build(p);
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const face = -w / 2; // the -X wall's outer face; only ribs lie beyond it
  const [z0, z1] = [5, 100]; // clear of the floor and the pull tab
  const check = (ok, msg) => {
    if (ok) console.log(`  OK: ${msg}`);
    else { console.error(`  FAIL: ${msg}`); failed = true; }
  };
  // Mean rib width over the slab at depth [d0, d1] out from the face. Both
  // slabs stay strictly inside the rib's span so no probe face lands coplanar
  // with the bin's own. Divided by the rib count: the slab spans all of them.
  const widthAtDepth = (d0, d1) => {
    const slab = drawRectangle(d1 - d0, (p.lengthModules + 1) * p.gridSpacing)
      .translate(face - (d0 + d1) / 2, 0)
      .sketchOnPlane("XY", z0)
      .extrude(z1 - z0);
    const v = measureVolume(bin.clone().intersect(slab));
    return v / ((d1 - d0) * (z1 - z0) * p.lengthModules);
  };
  const k = Math.tan((p.draftAngle * Math.PI) / 180);
  const want = (d0, d1) => p.ribWidth - 2 * ((d0 + d1) / 2) * k;
  const root = widthAtDepth(0.1, 0.2);
  const tip = widthAtDepth(p.wallBump - 0.2, p.wallBump - 0.1);
  check(Math.abs(root - want(0.1, 0.2)) < 0.01,
    `rib is ${root.toFixed(3)} mm wide near its root (want ${want(0.1, 0.2).toFixed(3)})`);
  check(Math.abs(tip - want(p.wallBump - 0.2, p.wallBump - 0.1)) < 0.01,
    `rib narrows to ${tip.toFixed(3)} mm near its tip ` +
      `(want ${want(p.wallBump - 0.2, p.wallBump - 0.1).toFixed(3)} at ${p.draftAngle} deg draft)`);
}

// ---------------------------------------------------------------------------
// Bin-with-lid retention features (bin-with-lid.ts). Bounding box and total
// volume cannot see these: the lid can be a whole 0.3 mm too low, or its lock
// machined away, and the totals still match. Every expected value below was
// measured off "Hardcase_Gridfinity_Bin with Lid.step" (see the model's doc
// comment); the constants are the recovered Fusion parameters LID_LOCK_LENGTH
// = 8 and LID_PULL_FRONT_OFFSET = 3, spelled out here so these assertions
// describe the ground truth rather than whatever the port currently builds.
console.log("bin-with-lid retention features:");
{
  const { drawRectangle } = await import("replicad");
  const { modelById } = await import("../src/models/index.ts");
  const { moduleCenters } = await import("../src/models/registration.ts");
  const model = modelById("bin-with-lid");
  const p = defaultValues(model);
  const started = Date.now();
  const [body, lid] = model.build(p);
  console.log(`  built body + lid (${Date.now() - started} ms)`);

  const check = (ok, msg) => {
    if (ok) console.log(`  OK: ${msg}`);
    else { console.error(`  FAIL: ${msg}`); failed = true; }
  };

  const slab = (axis, a, b) =>
    drawRectangle(2000, 2000)
      .sketchOnPlane({ x: "YZ", y: "ZX", z: "XY" }[axis], a)
      .extrude(b - a);
  // Volume of `shape` clipped to the given [axis, from, to] ranges. OCCT
  // booleans throw on empty intersections, which here means "no material".
  const vol = (shape, ...ranges) => {
    try {
      let s = shape.clone();
      for (const [axis, a, b] of ranges) s = s.intersect(slab(axis, a, b));
      return measureVolume(s);
    } catch { return 0; }
  };

  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const d = p.lengthModules * p.gridSpacing - 2 * p.clear;
  const h = p.overallHeight;
  const yEntry = -d / 2 + p.clear; // the lid's open (entry) edge
  const lockLength = 8; // LID_LOCK_LENGTH
  const frontOffset = 3; // LID_PULL_FRONT_OFFSET
  const lockEnd = yEntry + lockLength;

  // 1. The lid's top face is flush with the bin rim. LID_LOCK_OFFSET is the
  //    radial swell of the lock bead, not a vertical drop of the whole lid.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  const { vertices } = lid.mesh({ tolerance: 0.05, angularTolerance: 15 });
  for (let i = 0; i < vertices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], vertices[i + k]);
      hi[k] = Math.max(hi[k], vertices[i + k]);
    }
  check(Math.abs(hi[2] - h) <= 0.05, `lid top flush with the rim (z ${hi[2].toFixed(2)}, want ${h})`);
  // Underside sits LID_THICK below that; only the lock bead reaches lower, by
  // exactly the swell (LID_CLEAR + LID_LOCK_OFFSET).
  const wantBottom = h - p.lidThick - (p.lidClear + p.lidLockOffset);
  check(Math.abs(lo[2] - wantBottom) <= 0.05, `lock bead reaches z ${lo[2].toFixed(2)} (want ${wantBottom.toFixed(2)})`);

  // 2. THE LOCK: the ground truth deliberately interferes with the body over
  //    the last LID_LOCK_LENGTH, and nowhere else. Cutting the whole lid out of
  //    the body erases this and the lid is retained by nothing.
  let interference = 0;
  try { interference = measureVolume(lid.clone().intersect(body.clone())); } catch { /* none */ }
  check(interference > 2.5, `lid locks into the body (${interference.toFixed(2)} mm3 of interference, GT 4.71)`);
  const beyondLock = vol(lid.clone().intersect(body.clone()), ["y", lockEnd + 0.5, 100]);
  check(beyondLock < 0.05, `no interference past the lock zone (${beyondLock.toFixed(3)} mm3) — the lid must still slide`);

  // 3. The entry edge is notched at each width-module centre so the -Y wall's
  //    interlock sockets stay open with the lid installed.
  const notchDepth = p.wallThick + p.clear;
  for (const c of moduleCenters(p.widthModules, p.gridSpacing)) {
    const inNotch = vol(lid, ["x", c - 0.4, c + 0.4], ["y", yEntry, yEntry + notchDepth - 0.1]);
    check(inNotch < 0.05, `socket notch open at x=${c} (${inNotch.toFixed(3)} mm3 of lid in the way)`);
  }
  const between = vol(lid, ["x", 5, 6], ["y", yEntry, yEntry + notchDepth - 0.1]);
  check(between > 2, `lid still solid between the notches (${between.toFixed(2)} mm3)`);

  // 4. The finger pull is a scoop behind a full-height lip, not a chamfer down
  //    to the entry edge: the first LID_PULL_FRONT_OFFSET mm stay at rim height
  //    so a fingernail catches, then the top drops away.
  const lip = vol(lid, ["z", h - 0.2, h + 1], ["y", yEntry, yEntry + frontOffset - 0.5]);
  const scoop = vol(lid, ["z", h - 0.2, h + 1], ["y", yEntry + frontOffset + 0.5, yEntry + frontOffset + 1.5]);
  check(lip > 12, `full-height finger lip at the entry edge (${lip.toFixed(2)} mm3, GT ~15)`);
  check(scoop < 1.5, `top scooped away behind the lip (${scoop.toFixed(2)} mm3, want ~0.4)`);

  // 5. The wall must keep a real retention lip over the bead groove. The groove
  //    is a shallow scallop around the rail bead, not a slot the full height of
  //    the lid: above plate underside + bead diameter the wall is untouched.
  //    Sampled between module centres, clear of the exterior ribs.
  const xWallInner = -(w / 2 - p.wallThick);
  const grooveTop = h - p.lidThick + 1.5; // plate underside + bead diameter
  const lipWall = vol(body, ["x", -100, xWallInner], ["z", grooveTop + 0.1, h - 0.1], ["y", 5, 6]);
  const wantLipWall = p.wallThick * (h - 0.1 - grooveTop - 0.1);
  check(
    lipWall > 0.95 * wantLipWall,
    `-X wall full thickness above the groove (${lipWall.toFixed(2)} of ${wantLipWall.toFixed(2)} mm3)`,
  );

  // 6. On +X the bead runs against a ledge that has to be continuous. Without
  //    it the lid is only held at the three socket bosses. Sampled between
  //    module centres, where the bosses alone would leave nothing.
  const xLedge = w / 2 - p.wallThick - p.wallBump;
  const ledge = vol(body, ["x", xLedge, w / 2 - p.wallThick], ["z", grooveTop + 0.1, h - 0.1], ["y", 5, 6]);
  const wantLedge = p.wallBump * (h - 0.1 - grooveTop - 0.1);
  check(
    ledge > 0.95 * wantLedge,
    `+X rail ledge continuous between module centres (${ledge.toFixed(2)} of ${wantLedge.toFixed(2)} mm3)`,
  );
}

process.exit(failed ? 1 : 0);
