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
  // The full-height dovetail joints then added 89845 (757147 -> 846992): four
  // seam bulkheads plus their dovetail prisms. Less than the 112136 the same
  // change costs the rounded-corner perimeter, because a square cavity corner
  // reaches further out at the corner seams, leaving a narrower channel there
  // for the bulkhead to fill.
  // The honest flank angle then ADDED 3265 (846992 -> 850257), which is two
  // effects with opposite signs. The tang's neck narrows from 11.65 mm to
  // dovetailWidth, taking material off; but the seam collar is now offset
  // PERPENDICULAR to the flank rather than across the band, so a socket flank
  // is a true wallThick thick where it used to vary along the flank -- the old
  // collar wasn't even parallel to the old socket (slopes 0.283 vs 0.401), so
  // the old effective thickness ran from about 2.6 mm near the seam plane down
  // to about 2.0 mm at the tip. Four seams' worth of thicker flanks outweighs
  // four narrower necks.
  // Folding the tangs then removed 3546 (850257 -> 846711): four seam
  // dovetails hollowed to one wall thickness.
  "perimeter-square-corners": { x: 350, y: 250, z: 110, volume: 846711 },
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
// The full-height dovetail joints (perimeter.ts). Every seam is closed by a
// bulkhead filling the U-channel and the dovetail runs through it as a vertical
// prism, so the pieces lock in both in-plane axes from the floor to the rim.
// Self-derived expectations (the ported joint is at the shipped 3 mm wall, not
// the ground truth's 1.2 mm), but the failure this guards against is concrete:
// before the bulkheads existed the tang was built by fusing its 2-D footprint
// into a piece's region and intersecting a HOLLOW frame, so it only appeared
// where the channel happened to have material in the tang band. Measured at
// these defaults it decayed from 302 mm3 per 10 mm of height at the floor to
// exactly ZERO above z=90 -- the joint was missing over the top fifth of the
// frame, which is why the model briefly needed screw bosses. So:
//   - the split still yields 4 pieces;
//   - the bbox is untouched: the bulkhead lives inside the channel, so it may
//     not push the envelope past the case;
//   - the tang band carries material at the RIM, not just near the floor, and
//     on BOTH sides of the seam plane (a tang with no socket, or a socket with
//     no tang, is not a joint);
//   - no two pieces overlap. The socket is the tang grown by dovetailClear, so
//     any interference means that clearance was lost and the parts will not
//     assemble.
//   - the profile is what the parameters say: flank angle = dovetailAngle,
//     width at the seam plane = dovetailWidth, socket gap = dovetailClear
//     measured perpendicular to the flank.
console.log("perimeter full-height dovetail joints:");
{
  const { drawRectangle } = await import("replicad");
  const { modelById } = await import("../src/models/index.ts");
  const model = modelById("perimeter");
  const p = defaultValues(model);
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
    `bbox unchanged by the bulkheads (${dims.map((d) => d.toFixed(2)).join(" x ")})`,
  );

  // The +Y corner joint, derived the way the model derives it: the seam is the
  // cavity-length boundary, the dovetail band is centred on the long border.
  const sideBoarder =
    p.overallLength - p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const frontBoarder =
    p.overallWidth - p.gridSpacing * (Math.floor(p.overallWidth / p.gridSpacing) - p.frontBoarderBinAdd);
  const splitX = (p.overallLength - sideBoarder) / 2;
  const yc = ((p.overallWidth - frontBoarder) / 2 + p.overallWidth / 2) / 2;
  const band = (x0, x1, z0, z1) =>
    drawRectangle(x1 - x0, 20).translate((x0 + x1) / 2, yc).sketchOnPlane("XY", z0).extrude(z1 - z0);
  const meets = (tool) => {
    let v = 0;
    for (const piece of pieces) {
      try { v += measureVolume(piece.clone().intersect(tool.clone())); } catch { /* no overlap */ }
    }
    return v;
  };
  // A 10 mm slab of the tang band at the rim. The old floor-level-only joint
  // scored 0 here; the bulkhead plus the tang prism fill most of the band.
  const atRim = meets(band(splitX - 3, splitX + 8, p.overallHeight - 10, p.overallHeight));
  check(atRim > 1500, `joint material in the tang band at the rim (${atRim.toFixed(0)} mm3, was 0 before)`);
  // ...and it is a JOINT: material on both sides of the seam plane, mid height.
  const railSide = meets(band(splitX - 3, splitX, 50, 60));
  const capSide = meets(band(splitX, splitX + 8, 50, 60));
  check(railSide > 300, `tang-side material at the seam (${railSide.toFixed(0)} mm3)`);
  check(capSide > 700, `socket-side material at the seam (${capSide.toFixed(0)} mm3)`);

  let overlap = 0;
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      try { overlap += measureVolume(pieces[i].clone().intersect(pieces[j].clone())); } catch { /* disjoint */ }
    }
  check(overlap < 0.01, `no interference between pieces (${overlap.toFixed(3)} mm3)`);

  // --- Profile geometry. Two properties the parameters claim and the old
  // trapezoid did not deliver: the flank makes exactly `dovetailAngle` with
  // the seam axis, and `dovetailWidth` is the tang's width AT THE SEAM PLANE.
  // The old profile ran from pos-2 to pos+depth but flared by only
  // depth*tan(A) across that whole run, so at the defaults the flank came out
  // at 22.4 deg (tan 0.4126) where the parameter said 30, and the neck
  // measured 11.65 mm where it said 10. The TIP half-width was and stays
  // w/2 + depth*tan(A) -- which is why no bounding box moves.
  //
  // Measured on the RAIL piece: past the seam plane a rail carries nothing but
  // its tang, so the outermost y of a thin x-sliver IS the flank. Taken over
  // 10 mm of height at mid-frame, where the tang is ~0.8 mm clear of the
  // tapered outer wall, so nothing clips it.
  const rail = pieces.find((s) => s.boundingBox.bounds[0][1] > 0); // the +Y long rail
  const cap = pieces.find((s) => s.boundingBox.bounds[1][0] > p.overallLength / 2 - 1); // +X end cap

  // Tang half-width at x. The sliver ENDS at x and maxY picks its far edge, so
  // the reading is the flank exactly at x.
  const tangHalfWidthAt = (x) => {
    const tool = drawRectangle(0.5, 40).translate(x - 0.25, yc).sketchOnPlane("XY", 50).extrude(10);
    const { vertices } = rail.clone().intersect(tool).mesh({ tolerance: 0.01, angularTolerance: 5 });
    let maxY = -Infinity;
    for (let i = 1; i < vertices.length; i += 3) maxY = Math.max(maxY, vertices[i]);
    return maxY - yc;
  };
  // Socket half-width at x: the cap's nearest material above the band centre.
  // The sliver STARTS at x and the socket widens outward, so minY reads at x.
  const socketHalfWidthAt = (x) => {
    const tool = drawRectangle(0.5, 20).translate(x + 0.25, yc + 10).sketchOnPlane("XY", 50).extrude(10);
    const { vertices } = cap.clone().intersect(tool).mesh({ tolerance: 0.01, angularTolerance: 5 });
    let minY = Infinity;
    for (let i = 1; i < vertices.length; i += 3) minY = Math.min(minY, vertices[i]);
    return minY - yc;
  };

  const hw2 = tangHalfWidthAt(splitX + 2);
  const hw4 = tangHalfWidthAt(splitX + 4);
  const slope = (hw4 - hw2) / 2;
  const neck = 2 * (hw2 - 2 * slope);
  const wantSlope = Math.tan((p.dovetailAngle * Math.PI) / 180);
  check(
    Math.abs(slope - wantSlope) < 0.01,
    `flank angle equals dovetailAngle (tan ${slope.toFixed(4)} vs ${wantSlope.toFixed(4)}; was 0.4126)`,
  );
  check(
    Math.abs(neck - p.dovetailWidth) < 0.05,
    `tang is dovetailWidth at the seam plane (${neck.toFixed(3)} vs ${p.dovetailWidth}; was 11.650)`,
  );
  // The tip must NOT move: it is what fixes the tang's reach and the bbox.
  const wantTip = p.dovetailWidth + 2 * p.dovetailDepth * wantSlope;
  const tipWidth = 2 * tangHalfWidthAt(splitX + p.dovetailDepth);
  check(
    Math.abs(tipWidth - wantTip) < 0.05,
    `tang tip width unchanged (${tipWidth.toFixed(3)} vs ${wantTip.toFixed(3)})`,
  );
  // dovetailClear is a PERPENDICULAR gap: the socket is the tang offset normal
  // to each face, so the flank gap is c*sec(A). The old profile widened the
  // socket across the band AND stretched its flank over a longer run, which
  // left 0.154 mm where 0.2 was nominally asked for.
  const gap = socketHalfWidthAt(splitX + 2) - hw2;
  const wantGap = p.dovetailClear / Math.cos((p.dovetailAngle * Math.PI) / 180);
  check(
    Math.abs(gap - wantGap) < 0.02,
    `dovetailClear is a perpendicular gap (${gap.toFixed(3)} vs ${wantGap.toFixed(3)}; was 0.154)`,
  );

  // --- The fold. The tang is a wallThick shell, not a solid prism, so its
  // section area must DEPEND on wallThick. Before this it was identical at 1.2
  // and 3.0 -- 12.47 / 13.30 / 14.12 / 14.95 mm2 per mm of x at x = 143..146,
  // in both cases exactly the nominal trapezoid width -- because the tang
  // footprint was materialised solid and wallThick entered only the socket's
  // collar. Section taken over x in [splitX+1, splitX+4], 10 mm of height at
  // mid-frame. One extra build (~58 s); the 3.0 case reuses `pieces`.
  //
  // This block adds two full perimeter builds on top of the six the smoke
  // suite already runs before it (perimeter, smooth-perimeter,
  // perimeter-square-corners, plus this block's own `pieces`), and the OCCT
  // WASM heap is hard-capped at 2 GiB (compiled into replicad_single.wasm's
  // memory section, not runtime-configurable) — see scaling-test.mjs's own
  // "heap is small; leaks abort later builds" comment for the same ceiling
  // hit before. `built`, the tool solid, the clone and the intersection
  // result are all deleted as soon as they are measured so this block doesn't
  // add to the pile; `globalThis.gc?.()` after each heavy build forces the
  // FinalizationRegistry to run promptly, since V8 can't otherwise sense WASM
  // heap pressure from the small JS wrapper objects (matches scaling-test.mjs).
  //
  // A single `globalThis.gc?.()` marks the abandoned wrappers unreachable but
  // V8 doesn't guarantee the FinalizationRegistry callbacks that actually free
  // the WASM side run within that same synchronous call — they're scheduled
  // as a task, so a build immediately following a bare gc() can still start
  // before the previous one's memory is actually released. Yielding once
  // (setImmediate) lets that task run, then a second gc() sweeps whatever the
  // first pass turned up.
  const yieldTick = () => new Promise((resolve) => setImmediate(resolve));
  const sectionOf = async (built, x0, dx) => {
    const r = built.find((s) => s.boundingBox.bounds[0][1] > 0);
    const tool = drawRectangle(dx, 40).translate(x0 + dx / 2, yc).sketchOnPlane("XY", 50).extrude(10);
    const clone = r.clone();
    const piece = clone.intersect(tool);
    const volume = measureVolume(piece);
    piece.delete();
    clone.delete();
    tool.delete();
    built.forEach((s) => s.delete());
    globalThis.gc?.();
    await yieldTick();
    globalThis.gc?.();
    return volume;
  };
  const thick = await sectionOf(pieces, splitX + 1, 3);
  const thin = await sectionOf(model.build({ ...p, wallThick: 1.2 }), splitX + 1, 3);
  check(
    thin < thick * 0.5,
    `tang folds to wallThick (section ${thin.toFixed(0)} mm3 at 1.2 vs ${thick.toFixed(0)} at 3.0; ` +
      `both were 387 before)`,
  );

  // Degeneracy (spec REQ-4): once wallThick*secA exceeds the tang's half-width
  // there is no core left to remove, and the tang must come out solid with no
  // branch in the caller and no throw. At wallThick 4.5 the eroded half-width
  // 5 - 4.5*secA is negative. Measured over [splitX+1, splitX+2] only --
  // further out, a wall that thick clips the tang. This one passes before the
  // change too: it guards the new branch, it does not drive it.
  const stout = await sectionOf(model.build({ ...p, wallThick: 4.5 }), splitX + 1, 1);
  const wantStout = 10 * (p.dovetailWidth + 2 * 1.5 * wantSlope); // solid, 1 mm of x, 10 mm high
  check(
    Math.abs(stout - wantStout) / wantStout < 0.05,
    `tang stays solid where the fold degenerates (${stout.toFixed(0)} vs ${wantStout.toFixed(0)} mm3)`,
  );
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
