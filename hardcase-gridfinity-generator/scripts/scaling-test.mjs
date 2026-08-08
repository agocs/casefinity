// Parametric scaling / invariant harness (the "C" test from the param-testing
// plan). It builds every model across a spread of parameter values and asserts
// invariants that must hold at ANY parameters — catching hardcoded constants
// and non-scaling logic WITHOUT a Fusion round-trip.
//
// The two highest-value invariants, by way of example:
//   - the double-sided central floor must track OVERALL_HT/2 (the first port
//     pinned it at z=53, which this would have caught at any non-110 height);
//   - every perimeter piece must be a single clean solid (the split once left
//     198 mm³ sliver debris).
//
// Bounding boxes are measured from the MESH (OCCT's boundingBox over-estimates
// lofted/BSpline solids — same reason smoke.mjs meshes).
//
// Usage: node scripts/scaling-test.mjs [modelId]   (default: all models)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oc, replicad, slabVolume, slab } from "./occt-utils.mjs";

const { measureVolume, loadFont } = replicad;
await loadFont(
  readFileSync(
    fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url)),
  ).buffer,
  "LiberationSans",
);
const { modelById, defaultValues } = await import("../src/models/index.ts");

// ---------- helpers ----------
function build(id, overrides) {
  const model = modelById(id);
  const p = { ...defaultValues(model), ...overrides };
  const result = model.build(p);
  return { shapes: Array.isArray(result) ? result : [result], p };
}

function meshBBox(shapes) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    let vertices;
    try {
      ({ vertices } = s.mesh({ tolerance: 0.1, angularTolerance: 20 }));
    } catch {
      continue; // degenerate/empty piece — skip; the solid-count check flags it
    }
    for (let i = 0; i < vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], vertices[i + k]);
        mx[k] = Math.max(mx[k], vertices[i + k]);
      }
  }
  return mn.map((v, i) => mx[i] - v);
}

function solidCount(shape) {
  if (shape.constructor.name !== "Compound") return 1;
  let n = 0;
  const ex = new oc.TopExp_Explorer_2(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (ex.More()) {
    n++;
    ex.Next();
  }
  ex.delete(); // free the OCCT explorer (heap is small; leaks abort later builds)
  return n;
}

/** z (centre) and volume of the fullest cross-section slab in [z0, z1]. */
function peakSlab(shape, z0, z1, step = 2) {
  let best = -1;
  let bz = z0;
  for (let z = z0; z < z1; z += step) {
    const v = slabVolume(shape, "z", z, z + step);
    if (v > best) {
      best = v;
      bz = z + step / 2;
    }
  }
  return { z: bz, v: best };
}

/** Total volume of all shapes inside an arbitrary zone solid. */
function zoneVolume(shapes, zone) {
  let v = 0;
  for (const s of shapes) {
    try {
      v += measureVolume(s.clone().intersect(zone.clone()));
    } catch {
      /* disjoint/degenerate intersection */
    }
  }
  return v;
}

/** Liner cavity opening (mm) — mirrors cavityDims in perimeter.ts: a function
 * of OVERALL, GRID_SPACING and BIN_ADD only; wall thickness must not appear. */
function perimeterCavity(p) {
  return {
    length: p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd),
    width: p.gridSpacing * (Math.floor(p.overallWidth / p.gridSpacing) - p.frontBoarderBinAdd),
  };
}

/** Grid-cell centres along a span, excluding those inside the rounded corners
 * (mirrors gridCenters + the corner filter in applyGridFeatures). */
function gridCentersIn(span, spacing, cornerMargin) {
  const n = Math.round(span / spacing);
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing).filter(
    (c) => Math.abs(c) <= span / 2 - cornerMargin,
  );
}

function centerColumnVolume(shapes, half, z0, z1) {
  const col = slab("x", -half, half)
    .clone()
    .intersect(slab("z", z0, z1))
    .intersect(slab("y", -half, half));
  let v = 0;
  for (const s of shapes) {
    try {
      v += measureVolume(s.clone().intersect(col.clone()));
    } catch {
      /* empty intersection */
    }
  }
  return v;
}

const approx = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- reusable checks (each: (shapes, p) => {ok, msg}) ----------
const shapeCount = (n) => (shapes) => ({
  ok: shapes.length === n,
  msg: `${shapes.length} shapes (want ${n})`,
});
const positiveVolumes = () => (shapes) => {
  const bad = shapes.filter((s) => measureVolume(s) <= 1).length;
  return { ok: bad === 0, msg: bad ? `${bad} near-zero-volume shape(s)` : "all volumes > 0" };
};
const bboxMatches = (want) => (shapes, p) => {
  const got = meshBBox(shapes);
  const w = want(p);
  const ok = [0, 1, 2].every((i) => approx(got[i], w[i], 0.4));
  return { ok, msg: `bbox ${got.map((v) => v.toFixed(1)).join("×")} want ${w.map((v) => v.toFixed(1)).join("×")}` };
};
const eachIsOneSolid = () => (shapes) => {
  const counts = shapes.map(solidCount);
  const bad = counts.filter((c) => c !== 1).length;
  return { ok: bad === 0, msg: `solid counts [${counts.join(",")}] (each must be 1)` };
};

// Expected perimeter piece count — mirrors the bed-fit maths in perimeter.ts
// splitPieces (2 long rails + 2 end caps, each subdivided to fit the bed).
// Kept in sync with the model by hand, like binFootprintBBox.
const perimeterPieceCount = (p) => {
  if (!p.split) return 1;
  const cavLen = p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const splitX = cavLen / 2;
  const depth = p.dovetailDepth;
  const active = p.bedWidth > 0 && p.bedDepth > 0;
  const usable = Math.max(p.bedWidth - 2 * p.bedMargin, p.bedDepth - 2 * p.bedMargin);
  const fit = (span, corner, interior) => {
    if (!active) return 1;
    for (let n = 1; n < 24; n++) if (span / n + (n === 1 ? corner : interior) <= usable) return n;
    return 24;
  };
  return 2 * fit(2 * splitX, 2 * depth, 2 * depth) + 2 * fit(p.overallWidth, 0, depth);
};
const pieceCountMatches = () => (shapes, p) => {
  const want = perimeterPieceCount(p);
  return { ok: shapes.length === want, msg: `${shapes.length} pieces (want ${want})` };
};
// Every printed piece must fit the usable bed (bed − 2·margin) in its best
// orientation. No-op when no bed is set. Uses each piece's own mesh footprint.
const fitsBed = () => (shapes, p) => {
  if (!(p.bedWidth > 0 && p.bedDepth > 0)) return { ok: true, msg: "no bed limit" };
  const [s, l] = [p.bedWidth - 2 * p.bedMargin, p.bedDepth - 2 * p.bedMargin].sort((a, b) => a - b);
  const bad = [];
  shapes.forEach((sh, i) => {
    const [a, b] = meshBBox([sh]).slice(0, 2).sort((x, y) => x - y); // footprint, sorted asc
    if (a > s + 0.5 || b > l + 0.5) bad.push(`#${i + 1} ${a.toFixed(0)}×${b.toFixed(0)}`);
  });
  return { ok: bad.length === 0, msg: bad.length ? `exceed ${s}×${l}: ${bad.join(", ")}` : `all ≤ ${s}×${l} usable` };
};
// The +X end cap's grid ribs protrude past the wall face into the cavity; a bug
// once sheared them off when the bed subdivided the cap (the slice clipped the
// cross-axis at the face). Assert proud-rib material survives just inside the wall.
const endCapRibsPresent = () => (shapes, p) => {
  if (!(p.gridBump > 0 && p.bedWidth > 0 && p.bedDepth > 0)) return { ok: true, msg: "n/a (no bed / smooth)" };
  const cavW = p.gridSpacing * (Math.floor(p.overallWidth / p.gridSpacing) - p.frontBoarderBinAdd);
  const splitX = (p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd)) / 2;
  const b = p.gridBump, h = p.overallHeight;
  const zone = slab("x", splitX - b + 0.3, splitX - 0.3) // thin shell just inside the +X wall, in the cavity
    .clone()
    .intersect(slab("y", -cavW / 2, cavW / 2))
    .intersect(slab("z", 5, h - 5));
  let v = 0;
  for (const s of shapes) {
    try { v += measureVolume(s.clone().intersect(zone.clone())); } catch { /* disjoint */ }
  }
  const want = 0.6 * Math.round(cavW / p.gridSpacing) * (b - 0.6) * p.ribWidth * (h - 10); // ≥60% of nominal
  return { ok: v > want, msg: `+X rib-zone volume ${v.toFixed(0)} mm³ (want > ${want.toFixed(0)}; ~0 ⇒ sheared)` };
};

// INV-2 + INV-7: the cavity opening must stay exactly N·P modules whatever the
// wall thickness — the inner wall thickens OUTWARD into the border. Two probes:
// (a) the cavity inset by the bump depth must be empty (nothing, wall included,
//     intrudes past the grid ribs), and
// (b) wall material must sit immediately outside the cavity boundary on a plain
//     stretch of wall (between grid features) — i.e. the inner face is AT N·P,
//     neither pushed in (a) nor pulled out (b).
const cavityModuleExact = () => (shapes, p) => {
  const { length, width } = perimeterCavity(p);
  const b = Math.max(p.gridBump, 0.5);
  const h = p.overallHeight;
  const r = p.wallCornerRadius;
  // Two cross-strips instead of one box: a sharp-cornered box would poke into
  // the cavity's rounded corners (legitimate wall material) and false-fail.
  const zSpan = slab("z", 1, h - 1);
  const stripX = slab("x", -(length / 2 - r), length / 2 - r)
    .clone()
    .intersect(slab("y", -(width / 2 - b - 0.2), width / 2 - b - 0.2))
    .intersect(zSpan.clone());
  const stripY = slab("x", -(length / 2 - b - 0.2), length / 2 - b - 0.2)
    .clone()
    .intersect(slab("y", -(width / 2 - r), width / 2 - r))
    .intersect(zSpan.clone());
  const vIn = zoneVolume(shapes, stripX) + zoneVolume(shapes, stripY);
  const centers = gridCentersIn(width, p.gridSpacing, p.wallCornerRadius);
  const ym = centers[0] + p.gridSpacing / 2; // between two -X-wall grid features
  const shell = slab("x", -length / 2 - 0.35, -length / 2 - 0.05)
    .clone()
    .intersect(slab("y", ym - 1, ym + 1))
    .intersect(slab("z", h / 2 - 5, h / 2 + 5));
  const vWall = zoneVolume(shapes, shell);
  const ok = vIn < 5 && vWall > 3;
  return { ok, msg: `cavity-interior intrusion ${vIn.toFixed(1)} mm³ (want ~0); wall-at-boundary ${vWall.toFixed(1)} mm³ (want ≳ 6)` };
};

// The near-floor wall/fillet thickening (floorCollar in perimeter.ts): when
// FLOOR_THICK > WALL_THICK, rebuild the SAME model with FLOOR_THICK forced
// down to WALL_THICK (which makes floorCollar a no-op) and assert the
// thickened version has strictly more material. A pure volume-delta check
// rather than a spatial probe — deliberately, since two earlier attempts at
// building this feature passed a "the collar shape looks fine in isolation"
// check while silently contributing ~0 net volume once fused (the collar's
// own boundary sat entirely inside — or outside — the real wall). Comparing
// total volume against a same-shape baseline can't be fooled by that.
const floorCollarAddsMaterial = (modelId) => (shapes, p) => {
  if (p.footThick <= p.wallThick) return { ok: true, msg: "n/a (footThick <= wallThick, no collar expected)" };
  const baseline = modelById(modelId).build({ ...p, footThick: p.wallThick });
  const baseShapes = Array.isArray(baseline) ? baseline : [baseline];
  const vThis = shapes.reduce((a, s) => a + measureVolume(s), 0);
  const vBase = baseShapes.reduce((a, s) => a + measureVolume(s), 0);
  for (const s of baseShapes) s.delete?.();
  const delta = vThis - vBase;
  return { ok: delta > 0, msg: `footThick=${p.footThick} vs footThick=${p.wallThick} (no collar): +${delta.toFixed(0)} mm³ (want > 0)` };
};

// REQ-4: the folded dovetail tang must DEGENERATE to a solid prism rather than
// throw or come out inside-out once the fold's wall leaves no core to remove.
// The eroded half-width is dovetailWidth/2 - wallThick*sec(A), so a thick
// enough wall takes it negative; the caller must not need a branch for that.
// Measured on the +Y rail over 1 mm of x just past the seam plane (further out
// a wall that thick clips the tang) and 10 mm of height at mid-frame, against
// the nominal solid trapezoid there. Lives here rather than in smoke.mjs
// because it needs a whole extra split-perimeter build at a non-default
// wallThick, and this harness already forks a process per suite.
const tangSolidWhenFoldDegenerates = () => (shapes, p) => {
  if (!p.split) return { ok: true, msg: "n/a (unsplit — no dovetail seams)" };
  const slopeA = Math.tan((p.dovetailAngle * Math.PI) / 180);
  const secA = 1 / Math.cos((p.dovetailAngle * Math.PI) / 180);
  if (p.dovetailWidth / 2 - p.wallThick * secA > 0)
    return { ok: true, msg: `n/a (fold does not degenerate at wallThick=${p.wallThick})` };
  const { length, width } = perimeterCavity(p);
  const splitX = length / 2;
  const yc = (width / 2 + p.overallWidth / 2) / 2; // centre of the +Y border band
  const rail = shapes.find((s) => s.boundingBox.bounds[0][1] > 0);
  const zone = slab("x", splitX + 1, splitX + 2)
    .clone()
    .intersect(slab("y", yc - 20, yc + 20))
    .intersect(slab("z", 50, 60));
  const v = zoneVolume([rail], zone);
  const want = 10 * (p.dovetailWidth + 2 * 1.5 * slopeA); // solid, 1 mm of x, 10 mm high
  return {
    ok: Math.abs(v - want) / want < 0.05,
    msg: `tang section ${v.toFixed(0)} mm³ (want ≈ ${want.toFixed(0)}, i.e. solid — a fold that ` +
      `still cut a core here would read well under)`,
  };
};

// perimeter-square-corners: the cavity corner must be genuinely square, not
// just a smaller rounding — assert a whole corner-module-sized cell at the
// cavity's outer corner is mostly void (a bin-sized footprint fits flush
// there), unlike the base perimeter where WALL_CORNER_RADIUS's arc eats a
// large chunk of that same cell.
const cavityCornerIsSquare = () => (shapes, p) => {
  const { length, width } = perimeterCavity(p);
  const halfL = length / 2, halfW = width / 2;
  const n = p.gridSpacing;
  const cellZone = slab("x", halfL - n, halfL - 0.2)
    .clone()
    .intersect(slab("y", halfW - n, halfW - 0.2))
    .intersect(slab("z", 3, p.overallHeight - 3));
  const v = zoneVolume(shapes, cellZone);
  const cellMax = n * n * (p.overallHeight - 6);
  const ok = v < 0.05 * cellMax; // well under the ~8% a 15.5mm rounded corner leaves
  return { ok, msg: `corner-module cell occupancy ${v.toFixed(0)} / ${cellMax.toFixed(0)} mm³ (${((v / cellMax) * 100).toFixed(1)}%, want < 5%)` };
};

// INV-1/INV-2: grid ribs are RIB_WIDTH wide × GRID_BUMP proud, independent of
// WALL_THICK. The proud-rib band just inside the -Y wall contains only ribs
// (and dividers, which are rib-width and coincide with grid centres), so its
// volume pins both rib dimensions; a rib whose width followed a 6 mm wall
// would read ~5× over.
const gridRibDimsTrackRibWidth = () => (shapes, p) => {
  if (!(p.gridBump > 0)) return { ok: true, msg: "n/a (no grid bumps)" };
  const { length, width } = perimeterCavity(p);
  const b = p.gridBump;
  const h = p.overallHeight;
  const centers = gridCentersIn(length, p.gridSpacing, p.wallCornerRadius);
  const zone = slab("y", -width / 2 + 0.2, -width / 2 + b - 0.2)
    .clone()
    .intersect(slab("x", -(length / 2 - p.wallCornerRadius), length / 2 - p.wallCornerRadius))
    .intersect(slab("z", 5, h - 5));
  const v = zoneVolume(shapes, zone);
  const want = centers.length * p.ribWidth * (b - 0.4) * (h - 10);
  const ok = v > 0.7 * want && v < 1.45 * want;
  return { ok, msg: `-Y rib-band ${v.toFixed(0)} mm³ (want ≈ ${want.toFixed(0)} from RIB_WIDTH=${p.ribWidth})` };
};

// INV-1/INV-2 + REQ-4.4: the +Y groove slot is RIB_WIDTH wide regardless of
// WALL_THICK — empty inside the slot, solid on its flank. On a thick wall
// (t ≥ 2·bump) the boss is dropped and the slot is a plain blind pocket in the
// flat wall; the same probes hold in both regimes.
const grooveWidthTracksRibWidth = () => (shapes, p) => {
  if (!(p.gridBump > 0)) return { ok: true, msg: "n/a (no grid bumps)" };
  const { length, width } = perimeterCavity(p);
  const b = p.gridBump;
  const h = p.overallHeight;
  const centers = gridCentersIn(length, p.gridSpacing, p.wallCornerRadius);
  const c0 = centers.reduce((a, c) => (Math.abs(c) < Math.abs(a) ? c : a), Infinity);
  const yBand = slab("y", width / 2 + 0.1, width / 2 + b - 0.35).clone().intersect(slab("z", 2, h - 2));
  const vSlot = zoneVolume(
    shapes,
    yBand.clone().intersect(slab("x", c0 - p.ribWidth / 2 + 0.2, c0 + p.ribWidth / 2 - 0.2)),
  );
  const vFlank = zoneVolume(
    shapes,
    yBand.clone().intersect(slab("x", c0 + p.ribWidth / 2 + 0.1, c0 + p.ribWidth / 2 + 0.5)),
  );
  const wantFlank = 0.5 * 0.4 * (b - 0.45) * (h - 4);
  const ok = vSlot < 2 && vFlank > wantFlank;
  return { ok, msg: `groove@${c0}: in-slot ${vSlot.toFixed(1)} mm³ (want ~0), flank ${vFlank.toFixed(1)} mm³ (want > ${wantFlank.toFixed(1)})` };
};

// Regression: a long-side divider sits at the same X as a grid module centre
// by construction (dividerCenters draws from the same set gridCenters does),
// so on the +Y/-X (groove) walls a divider's fuse used to silently refill
// whatever the groove cut had carved there — a fully-occluded female feature.
// Probe the +Y groove at the first divider's X and assert it's still hollow.
function perimeterDividerCenters(p) {
  const { length } = perimeterCavity(p);
  const g = gridCentersIn(length, p.gridSpacing, 0); // dividerCenters applies no corner filter
  const n = Math.min(Math.round(p.dividers), g.length);
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => g[Math.round(((g.length - 1) * (i + 1)) / (n + 1))]);
}
const dividerGroovesStayOpen = () => (shapes, p) => {
  if (!(p.gridBump > 0)) return { ok: true, msg: "n/a (no grid bumps)" };
  const divCenters = perimeterDividerCenters(p);
  if (!divCenters.length) return { ok: true, msg: "n/a (no dividers)" };
  const { width } = perimeterCavity(p);
  const b = p.gridBump, h = p.overallHeight;
  const grooveDepth = b + 0.3;
  const halfY = width / 2;
  const cx = divCenters[0];
  const zone = slab("x", cx - p.ribWidth / 2 + 0.15, cx + p.ribWidth / 2 - 0.15)
    .clone()
    .intersect(slab("y", halfY - 0.1, halfY + grooveDepth - 0.35))
    .intersect(slab("z", 2, h - 2));
  const v = zoneVolume(shapes, zone);
  return { ok: v < 2, msg: `+Y groove at divider X=${cx.toFixed(0)}: ${v.toFixed(1)} mm³ (want ~0; was fully refilled pre-fix)` };
};

// Regression: the pull tab's corner gusset reaches into the bin as WALL_THICK
// shrinks yInner or PULL_TAB_HT lengthens the 45° diagonal. Both gusset
// corners sit on the same Y as the outermost +X-socket/−X-rib centre
// (lengthModules centring, REQ-3.4); left unclamped the gusset caps the
// socket's open mouth from directly above — harmless over a proud rib, but
// over a socket it's an occluded female feature (an overhang needing bridging
// support inside a slot nobody can clean out).
const pullTabClearsSocket = () => (shapes, p) => {
  if (!(p.pullTabHeight > 0)) return { ok: true, msg: "n/a (no pull tab)" };
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const h = p.overallHeight;
  const bump = p.wallBump;
  const slotW = p.ribWidth + 2 * p.clear;
  const centers = Array.from(
    { length: p.lengthModules },
    (_, i) => (i - (p.lengthModules - 1) / 2) * p.gridSpacing,
  );
  const c0 = centers.reduce((a, c) => (c > a ? c : a), -Infinity); // outermost, nearest +Y
  const zone = slab("x", w / 2 - bump, w / 2 + 0.3)
    .clone()
    .intersect(slab("y", c0 - slotW / 2, c0 + slotW / 2))
    .intersect(slab("z", h + 0.2, h + p.pullTabHeight));
  const v = zoneVolume([shapes[0]], zone);
  return { ok: v < 0.5, msg: `material directly above +X socket footprint, z∈(h,h+tabHt]: ${v.toFixed(2)} mm³ (want ~0)` };
};

// Bin flavour of the same invariants: -X ribs are RIB_WIDTH × WALL_BUMP, and
// the +X socket slot is RIB_WIDTH + 2·CLEAR wide, whatever WALL_THICK is.
const binRibSocketDims = () => (shapes, p) => {
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const b = p.wallBump;
  const h = p.overallHeight;
  const rw = p.ribWidth;
  const s = shapes[0];
  const ribZone = slab("x", -w / 2 - b + 0.2, -w / 2 - 0.2).clone().intersect(slab("z", 2, h - 2));
  const vRib = zoneVolume([s], ribZone);
  const wantRib = p.lengthModules * rw * (b - 0.4) * (h - 4);
  const centers = Array.from(
    { length: p.lengthModules },
    (_, i) => (i - (p.lengthModules - 1) / 2) * p.gridSpacing,
  );
  const c0 = centers.reduce((a, c) => (Math.abs(c) < Math.abs(a) ? c : a), Infinity);
  const slotW = rw + 2 * p.clear;
  // Inside the wall where the slot is cut, shallow enough to clear the boss.
  const xBand = slab("x", w / 2 - b + 0.5, w / 2 - 0.2).clone().intersect(slab("z", 2, h - 2));
  const vSlot = zoneVolume([s], xBand.clone().intersect(slab("y", c0 - slotW / 2 + 0.15, c0 + slotW / 2 - 0.15)));
  const vFlank = zoneVolume([s], xBand.clone().intersect(slab("y", c0 + slotW / 2 + 0.1, c0 + slotW / 2 + 0.5)));
  const wantFlank = 0.5 * 0.4 * (b - 0.7) * (h - 4);
  const ribOk = vRib > 0.7 * wantRib && vRib < 1.45 * wantRib;
  const ok = ribOk && vSlot < 2 && vFlank > wantFlank;
  return {
    ok,
    msg: `-X ribs ${vRib.toFixed(0)} mm³ (want ≈ ${wantRib.toFixed(0)}); +X socket@${c0}: in-slot ${vSlot.toFixed(1)} (want ~0), flank ${vFlank.toFixed(1)} (want > ${wantFlank.toFixed(1)})`,
  };
};

// bin footprint: modules·grid − 2·clear, plus one WALL_BUMP rib on -X/+Y; tab on z.
const binFootprintBBox = (p) => [
  p.widthModules * p.gridSpacing - 2 * p.clear + p.wallBump,
  p.lengthModules * p.gridSpacing - 2 * p.clear + p.wallBump,
  p.overallHeight + p.pullTabHeight,
];
const overallBBox = (p) => [p.overallLength, p.overallWidth, p.overallHeight];

// ---------- per-model suites ----------
const SUITES = {
  "bin-no-lid": {
    // wallThick 2 keeps the socket bosses (t < 2·bump); wallThick 3 crosses the
    // REQ-4.4 threshold (t ≥ 2·bump → boss-less blind sockets in the flat wall);
    // ribWidth 1.8 proves the registration widths track RIB_WIDTH, and the
    // wallThick spreads prove they DON'T track WALL_THICK (spec INV-2).
    // pullTabHeight 8 and the combined wallThick+pullTabHeight variant exercise
    // the pull-tab/socket-occlusion regression (pullTabClearsSocket).
    variants: [
      {},
      { widthModules: 2, lengthModules: 5 },
      { overallHeight: 60 },
      { gridSpacing: 20 },
      { wallThick: 2 },
      { wallThick: 3 },
      { ribWidth: 1.8 },
      { pullTabHeight: 8 },
      { wallThick: 3, pullTabHeight: 15 },
    ],
    checks: [
      ["shape count", shapeCount(1)],
      ["one connected solid", (s) => ({ ok: solidCount(s[0]) === 1, msg: `${solidCount(s[0])} solids` })],
      ["bbox = footprint formula", bboxMatches(binFootprintBBox)],
      ["rib/socket dims track RIB_WIDTH, not WALL_THICK", binRibSocketDims()],
      ["pull tab doesn't cap the +X socket from above", pullTabClearsSocket()],
      ["floor at bottom, cavity open above", (s, p) => {
        // Compare per-mm cross-sections: the floor slab is nearly the full
        // footprint, the mid slab is walls only — a ratio in absolute volumes
        // would falsely fail for thick (but legitimate) walls.
        const zf = p.floorThick + 0.5;
        const floor = slabVolume(s[0], "z", 0, zf) / zf;
        const mid = slabVolume(s[0], "z", p.overallHeight / 2, p.overallHeight / 2 + 2) / 2;
        return { ok: floor > 2 * mid && mid > 0, msg: `floor ${floor.toFixed(0)} mm³/mm vs mid ${mid.toFixed(0)} mm³/mm` };
      }],
    ],
  },
  "bin-with-lid": {
    // wallThick 2: the lid seat legitimately tracks the wall, but the exterior
    // registration features must not (INV-2) — binRibSocketDims pins them.
    variants: [{}, { widthModules: 4, lengthModules: 2 }, { overallHeight: 70 }, { lidLabel: "AB" }, { wallThick: 2 }, { pullTabHeight: 9 }],
    checks: [
      ["shape count (body+lid)", shapeCount(2)],
      ["rib/socket dims track RIB_WIDTH, not WALL_THICK", binRibSocketDims()],
      ["pull tab doesn't cap the +X socket from above", pullTabClearsSocket()],
      ["lid does not interpenetrate body (seat cut)", (s) => {
        let ov = 0;
        try { ov = measureVolume(s[0].clone().intersect(s[1].clone())); } catch { /* disjoint */ }
        return { ok: ov < 1, msg: `body∩lid overlap ${ov.toFixed(1)} mm³` };
      }],
      ["lid sits at the top", (s, p) => {
        const zTop = meshBBox([s[1]]);
        const lidTopZ = s[1].mesh({ tolerance: 0.2 }).vertices; // check via bbox z-extent below rim
        void lidTopZ;
        // lid thickness is small vs body height and it's near the rim
        return { ok: zTop[2] < p.overallHeight * 0.2, msg: `lid z-extent ${zTop[2].toFixed(1)} (thin, near rim)` };
      }],
    ],
  },
  "bin-double-sided": {
    // wallThick 2.5 runs before the heavy 5×5 build: as the last variant it hit
    // OCCT heap exhaustion and slabVolume's throw-guard read as zero volumes.
    variants: [{}, { overallHeight: 80 }, { overallHeight: 150 }, { wallThick: 2.5 }, { pullTabHeight: 9 }, { widthModules: 3, lengthModules: 3 }, { widthModules: 5, lengthModules: 5 }],
    checks: [
      ["shape count (body+2 lids)", shapeCount(3)],
      ["body is one connected solid", (s) => ({ ok: solidCount(s[0]) === 1, msg: `${solidCount(s[0])} solids` })],
      ["bbox = footprint formula", bboxMatches(binFootprintBBox)],
      ["rib/socket dims track RIB_WIDTH, not WALL_THICK", binRibSocketDims()],
      ["pull tab doesn't cap the +X socket from above", pullTabClearsSocket()],
      // One peakSlab scan serves both assertions (it is ~55 boolean ops — the
      // most expensive probe in the suite).
      ["central floor at OVERALL_HT/2, open at both ends", (s, p) => {
        const { z, v: floor } = peakSlab(s[0], p.floorThick, p.overallHeight);
        const mid = p.overallHeight / 2;
        const bottom = slabVolume(s[0], "z", 5, 7);
        const ok = approx(z, mid, p.overallHeight * 0.12) && floor > 3 * bottom && bottom > 0;
        return { ok, msg: `floor peak ${floor.toFixed(0)} mm³ at z=${z.toFixed(1)} (h/2=${mid.toFixed(1)}); bottom-end ${bottom.toFixed(0)}` };
      }],
    ],
  },
  perimeter: {
    // Regression: at 250×180 the divider rib profile used to invert at the
    // filleted base (outerInnerY < bump tip) and the fuse left a zero-volume
    // flake; addDividers now clamps the outer edge, so every piece stays one
    // clean solid. Kept as a variant to guard the fix.
    // (The no-collar path, footThick<=wallThick, is exercised in perimeter-inv2
    // instead; the bed-subdivision variants live in perimeter-bed, their own
    // process — see the note there.)
    variants: [
      {},
      { overallLength: 250, overallWidth: 180 },
      { overallHeight: 70 },
    ],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid (no debris)", eachIsOneSolid()],
      ["assembled bbox = OVERALL_* (pieces stay in place)", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
      ["end-cap ribs survive subdivision", endCapRibsPresent()],
      ["cavity opening = N·P modules exactly (INV-7, any t)", cavityModuleExact()],
      ["grid ribs are RIB_WIDTH × GRID_BUMP (INV-2)", gridRibDimsTrackRibWidth()],
      ["grooves are RIB_WIDTH wide, blind in any wall (INV-2/REQ-4.4)", grooveWidthTracksRibWidth()],
      ["dividers don't refill the grooves they cross", dividerGroovesStayOpen()],
      ["cavity is open (hollow frame)", (s, p) => {
        const v = centerColumnVolume(s, 10, 10, p.overallHeight - 10);
        return { ok: v < 5, msg: `centre-column volume ${v.toFixed(1)} mm³ (want ~0)` };
      }],
    ],
  },
  // Bed-subdivision variants only, in their own process: each adds dovetail
  // seams so no piece exceeds the usable bed area, which multiplies the
  // segment count (and so the per-build boolean-op cost) well beyond the
  // plain 4-piece split above. Splitting these into a second process is the
  // same fix as perimeter-inv2 for the same underlying constraint — the OCCT
  // WASM heap is small, and floorCollar's extra fuse (see perimeter.ts) was
  // just enough additional per-build cost to tip the heaviest of these
  // (bedWidth=300×150) over the shared heap's limit when it ran as an 8th
  // variant alongside the plain-split ones above.
  "perimeter-bed": {
    model: "perimeter",
    variants: [
      { bedWidth: 256, bedDepth: 256 },
      { bedWidth: 220, bedDepth: 220 },
      { bedWidth: 180, bedDepth: 180 }, // end cap subdivides (nEnd=2) → exercises endCapRibsPresent
      { bedWidth: 300, bedDepth: 150 }, // asymmetric: only the long rails split
    ],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid (no debris)", eachIsOneSolid()],
      ["assembled bbox = OVERALL_* (pieces stay in place)", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
      ["end-cap ribs survive subdivision", endCapRibsPresent()],
      ["cavity opening = N·P modules exactly (INV-7, any t)", cavityModuleExact()],
      ["grid ribs are RIB_WIDTH × GRID_BUMP (INV-2)", gridRibDimsTrackRibWidth()],
      ["grooves are RIB_WIDTH wide, blind in any wall (INV-2/REQ-4.4)", grooveWidthTracksRibWidth()],
      ["dividers don't refill the grooves they cross", dividerGroovesStayOpen()],
      ["cavity is open (hollow frame)", (s, p) => {
        const v = centerColumnVolume(s, 10, 10, p.overallHeight - 10);
        return { ok: v < 5, msg: `centre-column volume ${v.toFixed(1)} mm³ (want ~0)` };
      }],
    ],
  },
  // The INV-2 wall-thickness sweep, in its own suite so it gets a fresh OCCT
  // heap (appended to the perimeter suite it exhausts the WASM heap and the
  // builds abort). Unsplit (split: 0) — cheaper, and the invariants don't
  // depend on the dovetail split. wallThick 1 → 6 covers the reasonable
  // liner-wall range: the cavity must stay exactly N·P modules and every
  // registration dimension must keep its RIB_WIDTH/GRID_BUMP size. 1 and 2.5
  // exercise the bossed grooves (t < 2·bump); 6 crosses the REQ-4.4 threshold
  // (boss-less flat-wall grooves). ribWidth 1.8 proves the features track the
  // RIB_WIDTH knob itself.
  "perimeter-inv2": {
    model: "perimeter",
    variants: [
      { split: 0, wallThick: 1 },
      { split: 0, wallThick: 2.5 },
      { split: 0, wallThick: 6 },
      { split: 0, ribWidth: 1.8 },
      { split: 0, footThick: 1 }, // footThick <= wallThick(3): the no-collar path
    ],
    checks: [
      ["single unsplit piece", pieceCountMatches()],
      ["one clean solid", eachIsOneSolid()],
      ["bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["cavity opening = N·P modules exactly (INV-7, any t)", cavityModuleExact()],
      ["grid ribs are RIB_WIDTH × GRID_BUMP (INV-2)", gridRibDimsTrackRibWidth()],
      ["grooves are RIB_WIDTH wide, blind in any wall (INV-2/REQ-4.4)", grooveWidthTracksRibWidth()],
      ["dividers don't refill the grooves they cross", dividerGroovesStayOpen()],
      // Split builds are the heaviest thing in this file; running an EXTRA
      // full rebuild inside this check per variant pushed the "perimeter"
      // suite's shared OCCT heap past its limit (measured: later variants
      // started failing to build at all). This suite is unsplit (split:0,
      // cheap) and its own child process, so it's the safe place for it.
      ["near-floor wall thickening adds real material", floorCollarAddsMaterial("perimeter")],
      ["cavity is open (hollow frame)", (s, p) => {
        const v = centerColumnVolume(s, 10, 10, p.overallHeight - 10);
        return { ok: v < 5, msg: `centre-column volume ${v.toFixed(1)} mm³ (want ~0)` };
      }],
    ],
  },
  // The fold's degenerate case, in its own process for the same reason
  // perimeter-bed and perimeter-inv2 are: it is a split build (the heaviest
  // thing in this file) and the WASM heap is per-process. wallThick 4.5 takes
  // the eroded tang half-width (5 - 4.5·sec 30°) negative, so there is no core
  // left to hollow out.
  "perimeter-fold": {
    model: "perimeter",
    variants: [{ wallThick: 4.5 }],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid (no debris)", eachIsOneSolid()],
      ["assembled bbox = OVERALL_* (pieces stay in place)", bboxMatches(overallBBox)],
      ["tang stays solid where the fold degenerates (REQ-4)", tangSolidWhenFoldDegenerates()],
    ],
  },
  "smooth-perimeter": {
    // Regression: 300×300 used to leave the two long-side pieces empty (same
    // divider-profile inversion as the perimeter, here blowing the fuse up to
    // nothing rather than a flake). Guarded by the addDividers clamp.
    variants: [{}, { overallLength: 300, overallWidth: 300 }, { bedWidth: 220, bedDepth: 220 }],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid", eachIsOneSolid()],
      ["assembled bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
    ],
  },
  "perimeter-square-corners": {
    // 250×180 and a bed-fit split exercise the same debris/inversion regressions
    // the base perimeter suite guards; the corner check is the model's reason
    // to exist. gridSpacing 20 changes which module lands nearest the corner.
    variants: [
      {},
      { overallLength: 250, overallWidth: 180 },
      { bedWidth: 220, bedDepth: 220 },
      { gridSpacing: 20 },
    ],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid (no debris)", eachIsOneSolid()],
      ["assembled bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
      // (INV-7's cavity-dimension formula is unchanged by this model and
      // already guarded by the base perimeter suite; cavityModuleExact's
      // no-intrusion strip assumes the WALL_CORNER_RADIUS exclusion margin,
      // which this model deliberately removes — a corner rib legitimately
      // sits in that strip here, so that check doesn't apply.)
      ["cavity corner is square (bin-sized cell mostly void)", cavityCornerIsSquare()],
      ["cavity is open (hollow frame)", (s, p) => {
        const v = centerColumnVolume(s, 10, 10, p.overallHeight - 10);
        return { ok: v < 5, msg: `centre-column volume ${v.toFixed(1)} mm³ (want ~0)` };
      }],
    ],
  },
  "perimeter-template": {
    variants: [{}, { overallLength: 300, overallWidth: 200 }, { sideWallTaper: 2, frontWallTaper: 2 }],
    checks: [
      ["shape count (2 slices)", shapeCount(2)],
      ["assembled bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["each slice is thin (TEST_THICK)", (s, p) => {
        const thins = s.map((sh) => Math.min(...meshBBox([sh])));
        const ok = thins.every((t) => approx(t, p.testThick, 0.5));
        return { ok, msg: `slice thin-dims [${thins.map((t) => t.toFixed(1)).join(",")}] want ${p.testThick}` };
      }],
    ],
  },
};

// ---------- runner ----------
const only = process.argv[2];

// With no model arg, run each model in its own process: the OCCT WASM heap is
// small and the heavy perimeter builds exhaust it if they follow the bins in
// one process. Each child runs one suite in a fresh heap.
if (!only) {
  const { spawnSync } = await import("node:child_process");
  const self = fileURLToPath(import.meta.url);
  let anyFail = false;
  for (const id of Object.keys(SUITES)) {
    const r = spawnSync(process.execPath, ["--expose-gc", self, id], { stdio: "inherit" });
    if (r.status !== 0) anyFail = true;
  }
  process.exit(anyFail ? 1 : 0);
}

const ids = [only];
let failures = 0;
let total = 0;

for (const id of ids) {
  const suite = SUITES[id];
  if (!suite) {
    console.error(`no suite for "${id}"`);
    process.exit(2);
  }
  console.log(`\n=== ${id} ===`);
  for (const overrides of suite.variants) {
    const label = Object.keys(overrides).length
      ? Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(" ")
      : "defaults";
    let ctx;
    try {
      ctx = build(suite.model ?? id, overrides);
    } catch (err) {
      console.log(`  [${label}] BUILD FAILED: ${err.message}`);
      failures++;
      total++;
      continue;
    }
    const xfailReason = suite.xfail?.[label];
    console.log(`  [${label}]${xfailReason ? `  (known-fail: ${xfailReason})` : ""}`);
    let variantFailed = false;
    for (const [name, check] of suite.checks) {
      total++;
      let res;
      try {
        res = check(ctx.shapes, ctx.p);
      } catch (err) {
        res = { ok: false, msg: `check threw: ${err.message}` };
      }
      if (!res.ok) variantFailed = true;
      // A failure in an xfail variant is expected (known limitation); only count
      // unexpected failures toward the exit code.
      const tag = res.ok ? "OK  " : xfailReason ? "XFAIL" : "FAIL";
      if (!res.ok && !xfailReason) failures++;
      console.log(`      ${tag} ${name} — ${res.msg}`);
      // Collect between checks, not just variants: slab probes make dozens of
      // OCCT temporaries per check, and on the heaviest late variants the WASM
      // heap otherwise exhausts mid-variant (booleans start throwing, which
      // slabVolume's guard reads as zero volumes — a phantom FAIL).
      globalThis.gc?.();
    }
    if (xfailReason && !variantFailed) {
      console.log(`      NOTE known-fail variant now PASSES — remove the xfail marker`);
    }
    // Free OCCT handles so the small WASM heap survives all the heavy builds.
    for (const s of ctx.shapes) s.delete?.();
    globalThis.gc?.();
  }
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
