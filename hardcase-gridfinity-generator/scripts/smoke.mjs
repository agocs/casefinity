// Node smoke test: builds every registered model at default parameters with
// the real OCCT kernel and sanity-checks dimensions. Uses Node's native
// TypeScript type-stripping to import the same source the site uses.
//
// The suite runs as a POOL OF CHILD PROCESSES, one per UNIT (see UNITS below),
// for two reasons in this order of importance:
//
//  1. `replicad-opencascadejs`'s replicad_single.wasm declares a hard-coded
//     maximum memory of 32768 pages = 2 GiB, PER PROCESS, compiled into the
//     module's memory section and not configurable at runtime. Three
//     split-perimeter builds in one process abort with an emscripten abort
//     (exit code 7) around 2034 MiB — which is what this file used to have to
//     manage with hand-written shape disposal and --expose-gc. Giving each
//     heavy build its own process gives it its own fresh 2 GiB, so nobody
//     adding a check has to budget against a heap shared with the whole suite.
//  2. Wall clock. The suite is dominated by ~6 perimeter-scale builds (70–85 s
//     each; the bins are 1–5 s) and used to run them one after another on one
//     core. No unit holds more than one perimeter build, so the critical path
//     is one build rather than six. Kernel init is only ~270 ms per process,
//     so this granularity is nearly free.
//
// Each child's output is captured and replayed as one block when it finishes —
// interleaving them live would be unreadable. Everything a unit prints goes to
// stdout (including FAIL lines) so that replay keeps its original order; a
// child's stderr is reserved for crashes and is appended separately.
//
// Usage:
//   node scripts/smoke.mjs             # the whole suite, in parallel
//   node scripts/smoke.mjs <unit>      # one unit, in this process
//   SMOKE_JOBS=2 node scripts/smoke.mjs   # cap the pool (default 6)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  // dovetails hollowed to one wall thickness. Opening the folds at their narrow
  // end removed a further 2579 (846711 -> 844132): the void runs the profile's
  // whole length, so it slits each end web on the dovetail centreline instead
  // of stopping at it. That is what the ground truth does -- its rail's web
  // carries a ~1.5 mm slot there, which an earlier reading of this model missed
  // by integrating material across the whole border and never looking for a gap.
  "perimeter-square-corners": { x: 350, y: 250, z: 110, volume: 844132 },
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

// Which models each unit builds at default parameters. One perimeter-scale
// model per unit; the cheap ones (bins, solid-block) share one, since a process
// per 1-second model is pure churn. Every registered model must appear exactly
// once — asserted by modelCoverage() in the `bins` unit, so that registering a
// model without assigning it to a unit fails the suite instead of silently
// leaving it untested.
const MODEL_UNITS = {
  "perimeter-square-corners": ["perimeter-square-corners"],
  perimeter: ["perimeter"],
  "smooth-perimeter": ["smooth-perimeter"],
  "perimeter-template": ["perimeter-template"],
  bins: ["bin-no-lid", "bin-with-lid", "bin-double-sided", "solid-block"],
};

// Not nproc: the ceiling is memory, not cores (6 x 2 GiB worst case against the
// ~27 GB free on a 12-core dev box), and there is nothing to gain past the
// number of heavy units anyway. Measured high-water mark is ~630 MiB per unit,
// so the real footprint is far under that bound.
const DEFAULT_JOBS = 6;

// ---------------------------------------------------------------------------
// Child-side state and helpers.
let failures = 0;
let replicad;
let models;
let modelById;
let defaultValues;
let moduleCenters;

const check = (ok, msg) => {
  // Deliberately stdout, not stderr: the parent replays one captured stream per
  // unit and two pipes would not preserve their relative order.
  console.log(ok ? `  OK: ${msg}` : `  FAIL: ${msg}`);
  if (!ok) failures++;
};

/** Mesh-measured [min, max] over all shapes. OCCT's shape.boundingBox
 * over-estimates for BSpline surfaces — a lofted/filleted solid reports its
 * control-point extent, not the tight box — so it's unreliable for the
 * perimeter-template slices. Mesh the geometry that actually gets exported. */
function meshBounds(shapes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const shape of shapes) {
    const { vertices } = shape.mesh({ tolerance: 0.05, angularTolerance: 15 });
    for (let i = 0; i < vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], vertices[i + k]);
        max[k] = Math.max(max[k], vertices[i + k]);
      }
  }
  return [min, max];
}

/** A rectangular box tool spanning [z0, z1], with its 2-D intermediates freed.
 * replicad's `Drawing` has no delete() — only the Blueprint under it does — and
 * translate() returns a fresh Drawing over freshly transformed curves, while
 * sketchOnPlane copies the curves into edges rather than consuming them. So
 * each probe tool otherwise strands a Curve2D per side, twice over. (The Sketch
 * needs no such care: extrude() already deletes it.) */
function boxTool(width, depth, cx, cy, z0, z1) {
  const rect = replicad.drawRectangle(width, depth);
  const placed = cx || cy ? rect.translate(cx, cy) : rect;
  const solid = placed.sketchOnPlane("XY", z0).extrude(z1 - z0);
  placed.innerShape?.delete?.();
  if (placed !== rect) rect.innerShape?.delete?.();
  return solid;
}

/** Volume of `shape` inside `tool` (the caller owns `tool`). OCCT booleans
 * throw on empty intersections, which here means "no material".
 *
 * Neither operand is cloned first: BRepAlgoAPI builds a new shape and leaves
 * both inputs alone, so a defensive clone of a perimeter piece only buys a
 * second copy of it in a heap with a hard 2 GiB ceiling. */
function volumeIn(shape, tool) {
  let piece;
  try {
    piece = shape.intersect(tool);
  } catch {
    return 0;
  }
  const volume = replicad.measureVolume(piece);
  piece.delete?.();
  return volume;
}

function build(id, overrides) {
  const model = modelById(id);
  const p = { ...defaultValues(model), ...overrides };
  const result = model.build(p);
  return Array.isArray(result) ? result : [result];
}

// ---------------------------------------------------------------------------
// Units.

/** Bounding box (always at the shipped defaults) and volume for each model the
 * unit owns. */
function checkModels(unitId) {
  for (const id of MODEL_UNITS[unitId]) {
    const started = Date.now();
    const shapes = build(id);
    const [min, max] = meshBounds(shapes);
    const dims = max.map((v, i) => v - min[i]);
    console.log(
      `${id}: ${shapes.length} solid(s), ` +
        `bbox ${dims.map((d) => d.toFixed(2)).join(" x ")} mm ` +
        `(${Date.now() - started} ms)`,
    );

    const want = expected[id];
    if (!want) continue;
    const deltas = [dims[0] - want.x, dims[1] - want.y, dims[2] - want.z];
    const boxOk = deltas.every((d) => Math.abs(d) <= 0.1);
    check(
      boxOk,
      boxOk
        ? "matches ground-truth bounding box"
        : `expected ${want.x} x ${want.y} x ${want.z}, ` +
            `deltas ${deltas.map((d) => d.toFixed(3)).join(", ")}`,
    );
    if (!want.volume) continue;
    // Rebuild with the pinned params when the expected volume is measured
    // against the ground truth at values the defaults deviate from.
    const volumeShapes = want.params ? build(id, want.params) : shapes;
    const volume = volumeShapes.reduce((sum, s) => sum + replicad.measureVolume(s), 0);
    const relative = Math.abs(volume - want.volume) / want.volume;
    const at = want.params
      ? ` at ${Object.entries(want.params).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : "";
    const volumeOk = relative <= VOLUME_TOLERANCE;
    check(
      volumeOk,
      volumeOk
        ? `volume${at} ${volume.toFixed(0)} within ` +
            `${(VOLUME_TOLERANCE * 100).toFixed(1)}% of ground truth`
        : `volume${at} ${volume.toFixed(0)} vs expected ${want.volume} ` +
            `(${(relative * 100).toFixed(2)}% off)`,
    );
  }
}

/** Every registered model must be assigned to exactly one unit, or splitting
 * the suite by unit would quietly stop testing it. */
function modelCoverage() {
  const assigned = Object.values(MODEL_UNITS).flat();
  const registered = models.map((m) => m.id);
  const missing = registered.filter((id) => !assigned.includes(id));
  const unknown = assigned.filter((id) => !registered.includes(id));
  const duplicated = assigned.filter((id, i) => assigned.indexOf(id) !== i);
  const problems = [
    missing.length ? `unassigned: ${missing.join(", ")}` : "",
    unknown.length ? `not registered: ${unknown.join(", ")}` : "",
    duplicated.length ? `in two units: ${duplicated.join(", ")}` : "",
  ].filter(Boolean);
  check(
    problems.length === 0,
    problems.length
      ? `MODEL_UNITS is out of sync with src/models/index.ts — ${problems.join("; ")}`
      : `all ${registered.length} registered models are assigned to a unit`,
  );
}

// The perimeter's full-height dovetail joints (perimeter.ts) and the geometry
// derived from one split build. Every seam is closed by a bulkhead filling the
// U-channel and the dovetail runs through it as a vertical prism, so the pieces
// lock in both in-plane axes from the floor to the rim. Self-derived
// expectations (the ported joint is at the shipped 3 mm wall, not the ground
// truth's 1.2 mm), but the failure this guards against is concrete: before the
// bulkheads existed the tang was built by fusing its 2-D footprint into a
// piece's region and intersecting a HOLLOW frame, so it only appeared where the
// channel happened to have material in the tang band. Measured at these
// defaults it decayed from 302 mm3 per 10 mm of height at the floor to exactly
// ZERO above z=90 -- the joint was missing over the top fifth of the frame,
// which is why the model briefly needed screw bosses. So:
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
function dovetailJoints() {
  console.log("perimeter full-height dovetail joints:");
  const { measureVolume } = replicad;
  const model = modelById("perimeter");
  const p = defaultValues(model);
  const started = Date.now();
  const pieces = model.build(p);
  const volume = pieces.reduce((sum, s) => sum + measureVolume(s), 0);
  console.log(`  ${pieces.length} piece(s), volume ${volume.toFixed(0)} mm3 (${Date.now() - started} ms)`);

  check(pieces.length === 4, `4 pieces (got ${pieces.length})`);

  const [lo, hi] = meshBounds(pieces);
  const dims = hi.map((v, i) => v - lo[i]);
  const wantBox = [350, 250, 110];
  check(
    dims.every((d, i) => Math.abs(d - wantBox[i]) <= 0.1),
    `bbox unchanged by the bulkheads (${dims.map((d) => d.toFixed(2)).join(" x ")})`,
  );

  // The +Y corner joint, derived the way the model derives it: the seam is the
  // cavity-length boundary, the dovetail band is centred on the long border.
  const { splitX, yc } = dovetailFrame(p);
  const band = (x0, x1, z0, z1) => boxTool(x1 - x0, 20, (x0 + x1) / 2, yc, z0, z1);
  const meets = (tool) => {
    let v = 0;
    for (const piece of pieces) v += volumeIn(piece, tool);
    tool.delete?.();
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
    for (let j = i + 1; j < pieces.length; j++) overlap += volumeIn(pieces[i], pieces[j]);
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
    const tool = boxTool(0.5, 40, x - 0.25, yc, 50, 60);
    const piece = rail.intersect(tool);
    const { vertices } = piece.mesh({ tolerance: 0.01, angularTolerance: 5 });
    let maxY = -Infinity;
    for (let i = 1; i < vertices.length; i += 3) maxY = Math.max(maxY, vertices[i]);
    piece.delete?.();
    tool.delete?.();
    return maxY - yc;
  };
  // Socket half-width at x: the cap's nearest material above the band centre.
  // The sliver STARTS at x and the socket widens outward, so minY reads at x.
  const socketHalfWidthAt = (x) => {
    const tool = boxTool(0.5, 20, x + 0.25, yc + 10, 50, 60);
    const piece = cap.intersect(tool);
    const { vertices } = piece.mesh({ tolerance: 0.01, angularTolerance: 5 });
    let minY = Infinity;
    for (let i = 1; i < vertices.length; i += 3) minY = Math.min(minY, vertices[i]);
    piece.delete?.();
    tool.delete?.();
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

  checkFoldSection(pieces, p, p.wallThick);
}

/** The other half of the fold check, at a thin wall — its own unit because it
 * needs its own split-perimeter build (~70 s), and a unit holds at most one. */
function dovetailFold() {
  console.log("folded dovetail tang, thin wall:");
  const model = modelById("perimeter");
  const p = { ...defaultValues(model), wallThick: 1.2 };
  const started = Date.now();
  const pieces = model.build(p);
  console.log(`  ${pieces.length} piece(s) at wallThick=${p.wallThick} (${Date.now() - started} ms)`);
  checkFoldSection(pieces, p, p.wallThick);
}

/** Seam plane and dovetail-band centreline of the +Y corner joint, derived the
 * way perimeter.ts derives them. */
function dovetailFrame(p) {
  const sideBoarder =
    p.overallLength - p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const frontBoarder =
    p.overallWidth - p.gridSpacing * (Math.floor(p.overallWidth / p.gridSpacing) - p.frontBoarderBinAdd);
  return {
    splitX: (p.overallLength - sideBoarder) / 2,
    yc: ((p.overallWidth - frontBoarder) / 2 + p.overallWidth / 2) / 2,
  };
}

// The fold. The tang is a wallThick shell, not a solid prism, so its section
// must DEPEND on wallThick. Before the fold it was identical at 1.2 and 3.0 --
// 12.47 / 13.30 / 14.12 / 14.95 mm2 per mm of x at x = 143..146, in both cases
// exactly the nominal trapezoid width of the day -- because the tang footprint
// was materialised solid and wallThick entered only the socket's collar.
//
// Section taken over x in [splitX+1, splitX+4], 10 mm of height at mid-frame,
// where the tang is ~0.8 mm clear of the tapered outer wall. A SOLID prism over
// that window measures 10*(3*W + 15*tan A) = 386.6 mm3 at today's profile --
// the number both wall thicknesses would collapse back onto if the fold stopped
// cutting a core. The pins below are self-derived (measured off the port at the
// shipped joint parameters); like the volume table they move when the joint's
// geometry legitimately moves.
//
// One pin per unit, rather than one relative comparison inside one unit,
// because each value needs its own split-perimeter build (~80 s) -- pinning
// them separately is what lets the two builds run concurrently, each in its own
// 2 GiB heap.
const FOLD_SECTION = { 3: 338.6, 1.2: 106.6 };
function checkFoldSection(pieces, p, wallThick) {
  const { splitX, yc } = dovetailFrame(p);
  const rail = pieces.find((s) => s.boundingBox.bounds[0][1] > 0);
  const tool = boxTool(3, 40, splitX + 2.5, yc, 50, 60);
  const section = volumeIn(rail, tool);
  tool.delete?.();
  const want = FOLD_SECTION[wallThick];
  const solidPrism =
    10 * (3 * p.dovetailWidth + 15 * Math.tan((p.dovetailAngle * Math.PI) / 180));
  check(
    Math.abs(section - want) / want < 0.05,
    `tang folds to wallThick (section ${section.toFixed(1)} mm3 at wallThick=${wallThick}, ` +
      `want ~${want}; a solid prism would be ${solidPrism.toFixed(1)}, which is what ` +
      `every wallThick read before the fold)`,
  );
}

// Grid-bump draft (registration.ts). Neither bbox nor volume can see it: the
// draft is taken about the wall's normal, so the ribs still reach exactly as
// far, and the material it shaves off every rib it very nearly puts back by
// narrowing every socket. Measure the rib's width directly instead — in a thin
// slab near its root and another near its tip — and check the taper is the
// 2*depth*tan(draft) the angle implies.
function gridBumpDraft() {
  console.log("grid bump draft:");
  const model = modelById("bin-no-lid");
  const p = defaultValues(model);
  const [bin] = build("bin-no-lid");
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const face = -w / 2; // the -X wall's outer face; only ribs lie beyond it
  const [z0, z1] = [5, 100]; // clear of the floor and the pull tab
  // Mean rib width over the slab at depth [d0, d1] out from the face. Both
  // slabs stay strictly inside the rib's span so no probe face lands coplanar
  // with the bin's own. Divided by the rib count: the slab spans all of them.
  const widthAtDepth = (d0, d1) => {
    const slab = boxTool(
      d1 - d0,
      (p.lengthModules + 1) * p.gridSpacing,
      face - (d0 + d1) / 2,
      0,
      z0,
      z1,
    );
    const v = volumeIn(bin, slab);
    slab.delete?.();
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

// Bin-with-lid retention features (bin-with-lid.ts). Bounding box and total
// volume cannot see these: the lid can be a whole 0.3 mm too low, or its lock
// machined away, and the totals still match. Every expected value below was
// measured off "Hardcase_Gridfinity_Bin with Lid.step" (see the model's doc
// comment); the constants are the recovered Fusion parameters LID_LOCK_LENGTH
// = 8 and LID_PULL_FRONT_OFFSET = 3, spelled out here so these assertions
// describe the ground truth rather than whatever the port currently builds.
function lidRetention() {
  console.log("bin-with-lid retention features:");
  const { measureVolume } = replicad;
  const model = modelById("bin-with-lid");
  const p = defaultValues(model);
  const started = Date.now();
  const [body, lid] = model.build(p);
  console.log(`  built body + lid (${Date.now() - started} ms)`);

  // A big slab covering [a, b] along the given axis; the planes' normals point
  // along +axis. Frees its blueprint, as boxTool does.
  const slab = (axis, a, b) => {
    const rect = replicad.drawRectangle(2000, 2000);
    const solid = rect.sketchOnPlane({ x: "YZ", y: "ZX", z: "XY" }[axis], a).extrude(b - a);
    rect.innerShape?.delete?.();
    return solid;
  };
  // Volume of `shape` clipped to the given [axis, from, to] ranges. OCCT
  // booleans throw on empty intersections, which here means "no material".
  const vol = (shape, ...ranges) => {
    let s = shape;
    let owned = false; // whether `s` is ours to delete, or the caller's shape
    for (const [axis, a, b] of ranges) {
      const tool = slab(axis, a, b);
      let next = null;
      try {
        next = s.intersect(tool);
      } catch {
        /* no material in this range */
      }
      tool.delete?.();
      if (owned) s.delete?.();
      if (!next) return 0;
      s = next;
      owned = true;
    }
    const v = measureVolume(s);
    if (owned) s.delete?.();
    return v;
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
  const [lo, hi] = meshBounds([lid]);
  check(Math.abs(hi[2] - h) <= 0.05, `lid top flush with the rim (z ${hi[2].toFixed(2)}, want ${h})`);
  // Underside sits LID_THICK below that; only the lock bead reaches lower, by
  // exactly the swell (LID_CLEAR + LID_LOCK_OFFSET).
  const wantBottom = h - p.lidThick - (p.lidClear + p.lidLockOffset);
  check(Math.abs(lo[2] - wantBottom) <= 0.05, `lock bead reaches z ${lo[2].toFixed(2)} (want ${wantBottom.toFixed(2)})`);

  // 2. THE LOCK: the ground truth deliberately interferes with the body over
  //    the last LID_LOCK_LENGTH, and nowhere else. Cutting the whole lid out of
  //    the body erases this and the lid is retained by nothing.
  const interference = volumeIn(lid, body);
  check(interference > 2.5, `lid locks into the body (${interference.toFixed(2)} mm3 of interference, GT 4.71)`);
  const lidInBody = lid.intersect(body);
  const beyondLock = vol(lidInBody, ["y", lockEnd + 0.5, 100]);
  lidInBody.delete?.();
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

// Heaviest first: the parent's pool takes units in this order, so every
// perimeter-scale build starts in the first wave and the cheap `bins` unit is
// the one that waits if the pool is smaller than the unit count.
const UNITS = {
  "perimeter-square-corners": () => checkModels("perimeter-square-corners"),
  dovetail: dovetailJoints,
  "dovetail-fold": dovetailFold,
  perimeter: () => checkModels("perimeter"),
  "smooth-perimeter": () => checkModels("smooth-perimeter"),
  "perimeter-template": () => checkModels("perimeter-template"),
  bins: () => {
    checkModels("bins");
    gridBumpDraft();
    lidRetention();
    modelCoverage();
  },
};

// ---------------------------------------------------------------------------
// Parent: run every unit in a child process, at most SMOKE_JOBS at a time.
async function runPool() {
  const { spawn } = await import("node:child_process");
  const self = fileURLToPath(import.meta.url);
  const ids = Object.keys(UNITS);
  const jobs = Math.max(1, Math.min(Number(process.env.SMOKE_JOBS) || DEFAULT_JOBS, ids.length));
  console.log(`running ${ids.length} units, ${jobs} at a time: ${ids.join(", ")}\n`);

  const spawnUnit = (id) =>
    new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, [self, id], { stdio: ["ignore", "pipe", "pipe"] });
      const out = [];
      const err = [];
      const finish = (code, extra = "") =>
        resolve({
          id,
          code,
          seconds: (Date.now() - started) / 1000,
          out: Buffer.concat(out).toString(),
          err: Buffer.concat(err).toString() + extra,
        });
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", (c) => err.push(c));
      child.on("error", (e) => finish(1, `could not run the unit: ${e.message}\n`));
      child.on("close", (code) => finish(code));
    });

  const queue = [...ids];
  const results = [];
  const started = Date.now();
  const worker = async () => {
    while (queue.length) {
      const result = await spawnUnit(queue.shift());
      results.push(result);
      process.stdout.write(
        `===== ${result.id}: ${result.code === 0 ? "PASS" : "FAIL"} ` +
          `(${result.seconds.toFixed(1)}s) =====\n${result.out}` +
          (result.err ? `--- stderr ---\n${result.err}` : "") +
          "\n",
      );
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  const failed = results.filter((r) => r.code !== 0);
  console.log("===== summary =====");
  for (const id of ids) {
    const r = results.find((x) => x.id === id);
    console.log(`  ${r.code === 0 ? "PASS" : "FAIL"} ${id.padEnd(26)} ${r.seconds.toFixed(1).padStart(6)}s`);
  }
  console.log(
    `${results.length - failed.length}/${results.length} units passed in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s wall clock ` +
      `(${results.reduce((s, r) => s + r.seconds, 0).toFixed(1)}s of work)`,
  );
  process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Child: load the kernel and run one unit.
async function runUnit(id) {
  console.log(`[${id}] loading OCCT kernel…`);
  // occt-utils shims the CommonJS globals the emscripten ES module still
  // expects in Node, then loads the kernel into replicad.
  ({ replicad } = await import("./occt-utils.mjs"));
  // The bundled font, for the lid text engraving.
  await replicad.loadFont(
    readFileSync(fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url))).buffer,
    "LiberationSans",
  );
  ({ models, modelById, defaultValues } = await import("../src/models/index.ts"));
  ({ moduleCenters } = await import("../src/models/registration.ts"));

  const started = Date.now();
  await UNITS[id]();
  const rss = process.memoryUsage().rss / 1024 ** 2;
  console.log(
    `[${id}] ${failures ? `${failures} FAILURE(S)` : "all checks passed"} in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s, ${rss.toFixed(0)} MiB RSS ` +
      `(the OCCT heap only grows, so that is the high-water mark against its 2048 MiB cap)`,
  );
  process.exit(failures ? 1 : 0);
}

const unit = process.argv[2];
if (!unit) {
  await runPool();
} else if (UNITS[unit]) {
  await runUnit(unit);
} else {
  console.log(`unknown unit "${unit}"; expected one of: ${Object.keys(UNITS).join(", ")}`);
  process.exit(2);
}
