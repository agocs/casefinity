import { drawRoundedRectangle, drawRectangle, drawCircle, draw } from "replicad";
import type { Shape3D, Sketch, Drawing } from "replicad";
import type { ModelDef, ParamDef, ParamValues } from "./types.ts";
import { gridCenters, interlockDims, ribWidthParam } from "./registration.ts";

/**
 * Port of Hardcase_Gridfinity_Perimeter.f3d — the liner frame that drops into
 * a hard case and registers the bins to a grid.
 *
 * Reverse-engineered from ground-truth/Hardcase_Gridfinity_Perimeter.step
 * (see scripts/diff-aligned.mjs). The border is a thin-walled U-channel open
 * at the top:
 *   - inner (cavity) wall: vertical, WALL_THICK thick, at the cavity boundary;
 *   - outer (case) wall: tapered by the front/side wall draft, meeting the
 *     outer footprint (OVERALL_LENGTH x OVERALL_WIDTH) at the top mouth;
 *   - hollow between the two walls, closed at the bottom by a floor.
 * The cavity opening is OVERALL_* minus the recovered side/front borders
 * (SIDE_BOARDER = L - GRID_SPACING*(floor(L/GRID)-SIDE_BOARDER_BIN_ADD), etc.).
 *
 * Ported (Stages 1-5): the U-channel border walls + floor; the grid-bump
 * features on the inner wall (ribs on the -Y/+X walls, matching grooves on the
 * +Y/-X walls, GRID_BUMP proud/deep, full height, one per grid-cell centre —
 * the bins register against these); the dovetailed split into four border pieces
 * (see splitPieces); configurable divider cross-ribs on the long sides (see
 * addDividers); and the case bottom-corner radius rolled into the outer wall
 * (see outerLoft / filletInset) so the pieces seat cleanly in the case.
 * FLOOR_THICK isn't only the flat floor cap's own height — it also ramps the
 * outer wall's thickness up near the base of that same bottom fillet, so the
 * whole ≤30°-from-horizontal region (a shallow, support-needing overhang, and
 * exactly where a printed piece flexes most) is as thick as the floor rather
 * than dropping straight to WALL_THICK (see floorCollar).
 *
 * Remaining simplification: the foot is a flat floor rather than the real gusset
 * ramp, but the fit-critical outer surface (taper + bottom fillet) matches.
 *
 * Optional screw bosses (`bosses`, off by default) put a pad either side of every
 * seam — the four corner joints and every interior bed-split seam — at the rim on
 * the inside of the case wall, with a clearance hole on the piece that carries the
 * tang and a thread-forming pilot hole on its mate. The dovetails alone join the
 * pieces only at floor level (the tang band sits between the two walls, where the
 * frame has material only in the floor slab), so an assembled frame can splay at
 * the mouth; a screw at each seam closes it. Hole sizes come from the REMFORM® II
 * brochure and the pads are proportioned for FDM PETG rather than for moulding —
 * see bossDims. Three caveats: the screw drives ALONG the channel, so a full-height
 * divider between the boss and the nearest opening limits how straight a driver
 * can come in (~57 mm of clear run at the default divider spacing); on a case
 * too shallow for the full 45° gusset the ramp is clamped to land on the floor
 * slab, leaving an overhang steeper than 45° that wants support; and on an
 * absurdly shallow case the gusset clips out THROUGH the wall — the pad's outer
 * face is flat, placed where the wall runs at the rim, but the feature is ~2*pad
 * tall (15.8 mm at the M3 defaults), and over that height the wall leans inward
 * (taper, then much faster inside the bottom corner radius), so the pad sits ever
 * deeper in the wall toward its foot and eventually breaks out the far side.
 * Measured at the defaults: nothing at 27 mm of case depth, 0.7 mm proud at 25 mm,
 * 5.1 mm at 20 mm. Accepted, not fixed (see the README's "Known limitations"):
 * every real hard case is 100 mm-plus deep, and following the fillet would trade a
 * flat, drillable boss face for a curved one on geometry nobody prints.
 *
 * Print clearances (both default to a nominal fit; dial in per printer/material):
 *   - `clearance` (CLEARANCE) shrinks the whole outer envelope so the assembled
 *     frame drops into the case (default 0 = exact case size);
 *   - `dovetailClear` (BOARDER_DOVETAIL_CLEAR) opens a gap between each tang and
 *     its socket so the four pieces slide together (default 0.2 mm).
 */

const deg = (d: number) => (d * Math.PI) / 180;

/** Outer-wall rounded rectangle at height z, inset inward by `inset`. */
function outerAt(z: number, inset: number, p: ParamValues): Sketch {
  // Walls taper inward toward the bottom; z = overallHeight is the case mouth.
  const shrinkL = 2 * (p.overallHeight - z) * Math.tan(deg(p.frontWallTaper));
  const shrinkW = 2 * (p.overallHeight - z) * Math.tan(deg(p.sideWallTaper));
  // The wall rolls inward over the last BOTTOM_CORNER_RADIUS to follow the case's
  // rounded bottom (a quarter-round tangent to the wall at z = radius); so the
  // footprint is pulled in by 2*filletInset near the base.
  const fillet = 2 * filletInset(z, p);
  // CLEARANCE shrinks the whole outer envelope so the assembled frame drops into
  // the case with a small gap (both wall faces move in equally, thickness kept).
  const clear = 2 * p.clearance;
  const length = p.overallLength - shrinkL - fillet - clear - 2 * inset;
  const width = p.overallWidth - shrinkW - fillet - clear - 2 * inset;
  const radius = Math.max(p.bottomCornerRadius - inset, 0.5);
  return drawRoundedRectangle(length, width, radius).sketchOnPlane("XY", z) as Sketch;
}

/** How far the outer wall is drawn inward at height z by the case bottom-corner
 * radius (a quarter-round tangent to the wall at z = radius, meeting the floor
 * at z = 0). Zero above the radius. */
function filletInset(z: number, p: ParamValues): number {
  const r = p.bottomCornerRadius;
  if (r <= 0 || z >= r) return 0;
  return r - Math.sqrt(r * r - (r - z) * (r - z));
}

/** The outer wall solid: a short multi-section loft over the bottom fillet
 * (z = 0..radius) fused to a straight two-section loft for the tapered body
 * (z = radius..height). Splitting them keeps the fillet's clustered sections
 * from corrupting the straight taper (a single mixed loft splines the body out
 * to full width). */
function outerLoft(inset: number, p: ParamValues): Shape3D {
  const r = p.bottomCornerRadius;
  const [base, ...rest] = [0, 0.3, 0.6, 1].map((f) => outerAt(f * r, inset, p));
  const fillet = base.loftWith(rest) as Shape3D;
  const body = outerAt(r, inset, p).loftWith(outerAt(p.overallHeight, inset, p)) as Shape3D;
  return fillet.fuse(body);
}

/**
 * Extra wall material ramping from FLOOR_THICK at z=0 down to WALL_THICK at
 * z=0.3*bottomCornerRadius (the fillet loft's own next sample). The fillet is
 * a quarter-round of radius r=bottomCornerRadius, so its tangent is θ from
 * horizontal at height r(1−cos θ) — the tangent reaches 30° from horizontal
 * at just r(1−cos30°) ≈ 0.134*r, well inside this ramp's 0..0.3*r span, so
 * the whole ≤30°-from-horizontal zone sits within it. A 30°-from-horizontal
 * overhang is a shallow one in FDM terms (it needs support if left thin) and
 * is exactly where a printed piece flexes most, so thickening it toward the
 * floor's own thickness makes that band self-supporting and stiffens the
 * piece. The ramp must reach ABOVE the flat floor cap's own height (built
 * separately in buildPerimeter, z=0..FLOOR_THICK) or the extra material is
 * entirely masked by it: at typical defaults FLOOR_THICK alone already
 * reaches past the 30° point, so a collar that stopped there would add next
 * to nothing — reaching to 0.3*r instead extends real, unmasked thickness
 * above the floor cap, right where the wall would otherwise drop straight
 * back to WALL_THICK.
 *
 * `wallInner` MUST be the actual `outerLoft(t, p)` already built for the wall
 * cut in buildPerimeter (not re-derived here): the fillet is a circular arc,
 * a nonlinear function of z, and a fresh 2-point loft at inset=t can't
 * reproduce that curve — it comes out MORE pulled-in than the real wall at
 * every intermediate height, so a from-scratch "outer" edge sits entirely
 * inside the real wall's own solid and contributes exactly zero volume when
 * fused (measured — an earlier version did this and the frame's total volume
 * didn't move at all). Restricting the real wallInner to z<=zEnd guarantees
 * the collar's outer face is pixel-for-pixel the same surface as the wall's.
 *
 * The ramp itself is a single, monotonic two-point loft — inset=FLOOR_THICK
 * at z=0 straight to inset=WALL_THICK at zEnd, no intermediate "hold flat
 * then bend" sample. Two earlier attempts added a middle sample (at the 30°
 * height) to keep the near-horizontal zone uniformly thick before ramping:
 * one mixed it into outerLoft's own 5-section spline and it overshot enough
 * to measure LESS total material than before; the other kept it as its own
 * short 3-section loft and *that* overshot too, past the real wall's surface,
 * erasing nearly the whole collar (measured: 350 mm³ instead of the ~2900 mm³
 * a sane ramp gives). A flat-plateau-then-bend profile is exactly the shape
 * that makes a spline loft overshoot regardless of how few points it's split
 * across; a plain monotonic 2-point ramp has no such inflection to overshoot.
 *
 * `outerInnerY` (used by addDividers to trace a rib's outer edge) still
 * assumes a flat WALL_THICK inset; that's conservative here, not wrong — it
 * places the divider's outer edge further out than this collar's actual inner
 * face, so the rib fuse only picks up extra (harmless) overlap, never a gap.
 */
function floorCollar(p: ParamValues, wallInner: Shape3D): Shape3D | null {
  const t = p.wallThick;
  if (p.footThick <= t) return null; // FLOOR_THICK no thicker than the wall — nothing to add
  const r = p.bottomCornerRadius;
  const zEnd = 0.3 * r; // > filletAngleZ(30, p) ≈ 0.134*r always; matches outerLoft's own sample
  // Cutter sized to the case, not an arbitrary huge box — cheaper for OCCT,
  // and this runs on every build (unlike splitPieces' own `big`, computed once
  // per split), so the small WASM heap on heavy bed-split configurations feels
  // the difference (measured: an oversized cutter here was enough to tip the
  // heaviest bed-fit variant over the limit).
  const big = Math.max(p.overallLength, p.overallWidth);
  const cutter = (drawRectangle(big, big).sketchOnPlane("XY", 0) as Sketch).extrude(zEnd) as Shape3D;
  const outerShell = wallInner.clone().intersect(cutter);
  const innerShell = (outerAt(0, p.footThick, p) as Sketch).loftWith(outerAt(zEnd, t, p)) as Shape3D;
  return outerShell.cut(innerShell) as Shape3D;
}

/** Cavity opening dimensions: OVERALL_* minus the recovered side/front border
 * (SIDE_BOARDER = L - GRID_SPACING*(floor(L/GRID) - SIDE_BOARDER_BIN_ADD)). */
function cavityDims(p: ParamValues): { length: number; width: number } {
  const sideBoarder =
    p.overallLength - p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const frontBoarder =
    p.overallWidth - p.gridSpacing * (Math.floor(p.overallWidth / p.gridSpacing) - p.frontBoarderBinAdd);
  return { length: p.overallLength - sideBoarder, width: p.overallWidth - frontBoarder };
}

/** Cavity-boundary rounded rectangle, expanded outward (into the border) by
 * `outset`. outset 0 is the cavity hole itself. */
function cavityAt(z: number, outset: number, p: ParamValues): Sketch {
  const { length, width } = cavityDims(p);
  const radius = Math.max(p.wallCornerRadius + outset, 0.5);
  return drawRoundedRectangle(length + 2 * outset, width + 2 * outset, radius).sketchOnPlane("XY", z) as Sketch;
}

/**
 * Grid-bump features on the inner (cavity) wall, one per grid-cell centre,
 * full height. Like the bins, adjacent walls differ: the -Y and +X walls carry
 * ribs proud into the cavity (GRID_BUMP proud, RIB_WIDTH wide), while the
 * opposite +Y and -X walls carry matching grooves cut into the wall — so a bin,
 * whose exterior has ribs on two faces and sockets on the two others, registers
 * either way round. Registration widths derive from RIB_WIDTH / GRID_BUMP only;
 * WALL_THICK is structural (it sets how deep a rib anchors into the wall and
 * whether a groove needs a backing boss) and never changes the interface
 * dimensions (spec INV-2).
 *
 * Applied per wall so the split can add each wall's features to the one piece
 * that owns that wall (a +X-wall rib fused to a whole frame that is later split
 * would orphan into the neighbouring side piece). `walls` selects which of the
 * four to apply. Ribs are fused, grooves cut; each set is unioned as one 2-D
 * drawing and applied in a single boolean (cheap).
 */
type WallSpec = { axis: "X" | "Y"; sign: 1 | -1; kind: "rib" | "groove" };
const ALL_WALLS: WallSpec[] = [
  { axis: "Y", sign: -1, kind: "rib" }, // -Y wall
  { axis: "X", sign: 1, kind: "rib" }, // +X wall
  { axis: "Y", sign: 1, kind: "groove" }, // +Y wall
  { axis: "X", sign: -1, kind: "groove" }, // -X wall
];

function applyGridFeatures(shape: Shape3D, p: ParamValues, walls: WallSpec[] = ALL_WALLS): Shape3D {
  const { length, width } = cavityDims(p);
  const half = { X: length / 2, Y: width / 2 };
  const t = p.wallThick;
  const b = p.gridBump;
  // Registration widths come from the shared interface (registration.ts);
  // depths are structural: ribs span GRID_BUMP proud of the cavity face plus
  // WALL_THICK back into the wall (the embed is anchoring; the proud, mating
  // part is always exactly GRID_BUMP), grooves cut from 0.3 mm inside the face
  // to GRID_BUMP deep.
  const { ribWidth: rw, grooveWidth, linerBossWidth: bossWide, needBoss } = interlockDims(p, b);
  const ribDepth = b + t;
  const grooveDepth = b + 0.3;
  const ribOff = (t - b) / 2; // face -> rib-box centre (proud into cavity)
  const grooveOff = grooveDepth / 2 - 0.3; // face -> groove-box centre (into wall)
  const rect = (cx: number, cy: number, wx: number, wy: number) =>
    drawRectangle(wx, wy).translate(cx, cy);
  type Draw = ReturnType<typeof rect>;
  const solid = (rects: Draw[]) =>
    rects.reduce((a, r) => (a ? a.fuse(r) : r)).sketchOnPlane("XY", 0).extrude(p.overallHeight) as Shape3D;

  // On a thin wall (needBoss: t < 2b, spec REQ-4.4) the `b`-deep slot cuts
  // clean through and would read as an open slit into the U-channel hollow.
  // Back it with a wider boss (like the bin socket's interior boss) so the
  // female pocket is blind and the cavity stays closed — the bin rib seats
  // against it. A wall at least 2b thick holds the slot with ≥ b of material
  // behind it, so the groove is cut straight into the flat wall, boss omitted.
  const bossDepth = t + b; // spans the wall plus GRID_BUMP into the hollow

  let out = shape;
  for (const w of walls) {
    // Feature only the flat wall sections. A grid centre inside a rounded corner
    // arc (|c| > span/2 − wallCornerRadius) would place a rib/groove on the curve,
    // where no bin face registers; the ground truth leaves the corners clean.
    const span = w.axis === "X" ? width : length;
    const centers = gridCenters(span, p.gridSpacing).filter(
      (c) => Math.abs(c) <= span / 2 - p.wallCornerRadius,
    );
    // A block at each grid centre: `mag` = its centre's distance from the cavity
    // centre, `wide` = size along the wall, `deep` = size normal to the wall.
    const feat = (mag: number, wide: number, deep: number): Shape3D => {
      const rects = centers.map((c) =>
        w.axis === "X"
          ? rect(w.sign * mag, c, deep, wide) // ±X wall: normal along X, along-wall in Y
          : rect(c, w.sign * mag, wide, deep), // ±Y wall: along-wall in X, normal along Y
      );
      return solid(rects);
    };
    if (w.kind === "rib") {
      out = out.fuse(feat(half[w.axis] + ribOff, rw, ribDepth));
    } else {
      if (needBoss) out = out.fuse(feat(half[w.axis] + bossDepth / 2, bossWide, bossDepth)); // backing boss
      out = out.cut(feat(half[w.axis] + grooveOff, grooveWidth, grooveDepth)); // the slot
    }
  }
  return out;
}

/** `dividers` evenly-spaced grid-cell centres along the cavity length. */
function dividerCenters(p: ParamValues): number[] {
  const g = gridCenters(cavityDims(p).length, p.gridSpacing);
  const n = Math.min(Math.round(p.dividers), g.length);
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => g[Math.round(((g.length - 1) * (i + 1)) / (n + 1))]);
}

/** Y of the outer wall's inner face at height z on a long side's straight edge
 * (follows the side taper and the bottom fillet). */
function outerInnerY(z: number, p: ParamValues): number {
  const shrinkW = 2 * (p.overallHeight - z) * Math.tan(deg(p.sideWallTaper));
  return (p.overallWidth - shrinkW - 2 * filletInset(z, p)) / 2 - p.wallThick;
}

/**
 * Fuse divider ribs onto one long-side wall (signY = +1 / -1). Each is a full-
 * height cross-rib, RIB_WIDTH wide (a module-boundary feature — it protrudes
 * into the cavity like a grid rib, so its width must not follow WALL_THICK or
 * a thick wall would eat into the adjacent modules), that fills the U-channel
 * from the cavity-face bump across to the case wall — like the BOARDER_DIVIDERS
 * ribs in the source (there placed ad hoc; here at `dividers` evenly-spaced
 * grid centres).
 *
 * The rib's outer edge is drawn as a Y-Z profile that follows the wall taper and
 * bottom fillet, so it meets the case wall at every height without an expensive
 * intersect against the outer loft. Applied BEFORE the grid features (see the
 * callers), not after: a divider coincides in X with a grid module centre by
 * construction, and on the +Y/-X (groove) walls, cutting the groove after the
 * divider's fuse is what keeps the groove open — see applyGridFeatures's
 * caller-ordering note.
 */
function addDividers(shape: Shape3D, p: ParamValues, signY: 1 | -1): Shape3D {
  const centers = dividerCenters(p);
  if (!centers.length) return shape;
  const h = p.overallHeight;
  // The divider's cavity-facing edge must sit flush with whatever that wall
  // actually presents at the cavity boundary — NOT the same offset on both
  // walls. The -Y wall carries a rib (ALL_WALLS convention): its per-module
  // rib already reaches GRID_BUMP past the face, so flushing the divider to
  // the rib tip avoids a visible step. The +Y wall carries a groove (a
  // recess, not a protrusion): there is no bump to flush against, so the
  // divider must stop AT the face. Using the rib-tip offset on the groove
  // wall too made the divider poke GRID_BUMP into the open cavity as a
  // phantom nub — and once the groove cut (correctly) runs last, that nub
  // gets sliced clean off the frame as floating debris (a piece the split
  // count and one-clean-solid checks below both catch).
  const isRibWall = signY < 0;
  const innerMag = isRibWall ? cavityDims(p).width / 2 - p.gridBump : cavityDims(p).width / 2;
  const inner = signY * innerMag;
  const zs = [0, 0.3, 0.6, 1].map((f) => f * p.bottomCornerRadius).concat(h);
  // Profile in the Y-Z plane: inner edge straight at `inner`, outer edge tracing
  // the wall from the base fillet up to the mouth. Near the filleted base the
  // tapered wall can curve inward PAST the bump line (outerInnerY < innerMag) —
  // for a narrow case that inverts the profile into a self-intersecting polygon
  // and the rib fuse degenerates (zero-volume flake, or the whole piece blows up
  // to empty). Clamp the outer edge to stay at least `minGap` outside the inner
  // edge so the profile is always a valid simple polygon; the clamp is inactive
  // wherever the channel is genuinely open, so it never alters a good case.
  const minGap = 0.5;
  const outerMag = (z: number) => Math.max(outerInnerY(z, p), innerMag + minGap);
  let prof = draw([inner, 0]);
  for (const z of zs) prof = prof.lineTo([signY * outerMag(z), z]);
  prof = prof.lineTo([inner, h]);
  const profile = prof.close();
  const ribs = centers
    .map(
      (cx) =>
        (profile.sketchOnPlane("YZ", cx - p.ribWidth / 2) as Sketch).extrude(
          p.ribWidth,
        ) as Shape3D,
    )
    .reduce((a, b) => a.fuse(b));
  return shape.fuse(ribs);
}

/**
 * Signed coordinate of the outer wall's INNER face on the wall whose normal runs
 * along `axis`, at height z — the same surface `outerAt(z, wallThick, p)` draws,
 * so taper, bottom fillet and CLEARANCE are all accounted for. `outerInnerY`
 * omits the clearance term, which is deliberately conservative for a divider
 * (it only has to overlap the wall) but wrong for a screw boss, which has to sit
 * exactly ON the face at a known embedment.
 */
function wallFaceMag(axis: "X" | "Y", z: number, p: ParamValues): number {
  const overall = axis === "X" ? p.overallLength : p.overallWidth;
  const taper = axis === "X" ? p.frontWallTaper : p.sideWallTaper;
  const shrink = 2 * (p.overallHeight - z) * Math.tan(deg(taper));
  return (overall - shrink - 2 * filletInset(z, p) - 2 * p.clearance) / 2 - p.wallThick;
}

/**
 * REMFORM® II metric series maximum major diameter per nominal size (REMINC/
 * CONTI brochure p. 2). The clearance hole is sized to this, so a screw at the
 * top of its diameter tolerance still passes freely. Sizes off the table follow
 * the table's own pattern: +0.10 below 5 mm, +0.15 from 5 mm up.
 */
const MAJOR_DIA_MAX: [nominal: number, max: number][] = [
  [1.0, 1.07], [1.2, 1.27], [1.4, 1.47], [1.6, 1.7], [1.8, 1.9], [2.0, 2.1],
  [2.2, 2.3], [2.5, 2.6], [3.0, 3.1], [3.5, 3.6], [4.0, 4.1], [4.5, 4.6],
  [5.0, 5.15], [6.0, 6.15], [7.0, 7.15], [8.0, 8.15], [9.0, 9.15], [10.0, 10.15],
];
function majorDiaMax(d: number): number {
  const hit = MAJOR_DIA_MAX.find(([nom]) => Math.abs(nom - d) < 1e-6);
  return hit ? hit[1] : d + (d >= 5 ? 0.15 : 0.1);
}

type BossDims = {
  clearDia: number;
  pilotDia: number;
  /** The pad's depth into the channel and its height — a square section. */
  pad: number;
  /** How far the pad's outer edge is pushed into the wall. */
  embed: number;
  /** Top of the pad: the case mouth, so the pad's top face is the rim. */
  zTop: number;
  /** Vertical drop of the 45° gusset ramp (== pad, unless clamped). */
  run: number;
};

/**
 * Derived screw-boss geometry, or null when the frame has no room for a usable
 * one (the two guards below).
 *
 * Hole sizes come from the REMFORM® II brochure: the CLEARANCE hole is the
 * screw's maximum major diameter (p. 2, see majorDiaMax) and the PILOT hole is
 * the "recommended hole size" — a factor times the MINIMUM major diameter
 * (p. 3), which that table gives as the nominal size for every listed metric
 * size, hence `bossHoleFactor * bossScrewDia`. The 0.80 default is the
 * brochure's factor for PET / PBT / PC / PS: PETG is not listed and PET and PC
 * are its closest listed relatives (PP/PE/PA/ABS would be 0.75, 30 % glass-
 * filled 0.82–0.85, all reachable via the parameter).
 *
 * `pad` is clearDia + 2*bossWall — the same material all round the LARGER of the
 * two holes, so both halves of a joint are the same block and the pilot side
 * simply gets extra meat. At the M3 defaults that is 7.9 mm, about 2.6x nominal
 * where injection-moulding practice would say 2x: the boss prints with its axis
 * horizontal, so hoop stress at the hole runs partly across layer lines, which
 * is FDM PETG's weak direction.
 */
function bossDims(p: ParamValues): BossDims | null {
  const clearDia = majorDiaMax(p.bossScrewDia);
  const pilotDia = p.bossHoleFactor * p.bossScrewDia;
  const pad = clearDia + 2 * p.bossWall;
  const zTop = p.overallHeight;
  // No room between the rim and the floor slab for even the block itself.
  if (zTop - pad <= p.footThick) return null;
  // No room across the U-channel: a pad deeper than the border would grow
  // through the cavity wall and stick out where the bins go. Checked on both the
  // long and the end walls, since seams on both carry bosses.
  const { length, width } = cavityDims(p);
  const border = Math.min(
    wallFaceMag("Y", zTop, p) - (width / 2 + p.wallThick),
    wallFaceMag("X", zTop, p) - (length / 2 + p.wallThick),
  );
  if (pad > border) return null;
  // 45° gusset: the ramp's vertical drop equals the pad's depth. On a case too
  // shallow for the full run it is clamped to land on the floor slab, and is
  // then steeper than 45° (see the model doc comment).
  const run = Math.min(pad, zTop - pad - p.footThick);
  return { clearDia, pilotDia, pad, embed: Math.min(0.4, p.wallThick / 2), zTop, run };
}

/** One half of a boss pair: which seam, which side of it, and which hole. */
type BossSeam = {
  /** The screw's axis — along the wall, across the seam. */
  axis: "X" | "Y";
  /** Which of the two walls normal to the other axis carries the pad. */
  wallSign: 1 | -1;
  /** Seam-plane coordinate on `axis`. */
  at: number;
  /** Which side of the seam this half occupies (+1 = above `at`). */
  side: 1 | -1;
  hole: "clear" | "pilot";
  /** Pad length along `axis` — the thread engagement on the pilot side. */
  len: number;
};

/**
 * The pad block for one half of a boss pair, and the bore that goes with it.
 *
 * The pad's outer edge is placed `embed` INSIDE the wall face taken at the rim,
 * never tangent to it: a tangent pad is a zero-thickness-contact boolean. The
 * wall tapers, so its face is further in lower down and the pad is embedded
 * progressively deeper toward its base — always overlapping, never floating, and
 * never breaking through the outer surface as long as embed < wallThick.
 *
 * Cross-section in the (wall-normal, z) plane: flat top at the rim, vertical
 * face into the channel, then a ramp of slope `run/pad` (45° unless clamped)
 * straight back to the wall. That ramp IS the gusset — the pad has no flat
 * underside to overhang.
 */
function bossHalf(p: ParamValues, s: BossSeam, d: BossDims): { pad: Shape3D; bore: Shape3D } {
  const nAxis = s.axis === "X" ? "Y" : "X"; // the wall's normal
  const g = s.wallSign;
  const nOut = g * (wallFaceMag(nAxis, d.zTop, p) + d.embed);
  const nIn = nOut - g * d.pad;
  const zBase = d.zTop - d.pad;
  const prof = draw([nOut, d.zTop])
    .lineTo([nIn, d.zTop])
    .lineTo([nIn, zBase])
    .lineTo([nOut, zBase - d.run])
    .close();
  const u0 = s.side > 0 ? s.at : s.at - s.len;
  // Verified against the kernel: "YZ" maps a drawing's (a, b) to (Y, Z), sits at
  // X = offset and extrudes toward +X; "XZ" maps it to (X, Z) but sits at
  // Y = -offset and extrudes toward -Y — hence the negated, length-shifted
  // offset so both cases span [u0, u0 + len] on the seam axis.
  const prism = (dr: Drawing, from: number, len: number): Shape3D =>
    s.axis === "X"
      ? ((dr.sketchOnPlane("YZ", from) as Sketch).extrude(len) as Shape3D)
      : ((dr.sketchOnPlane("XZ", -(from + len)) as Sketch).extrude(len) as Shape3D);
  const r = (s.hole === "clear" ? d.clearDia : d.pilotDia) / 2;
  const over = 0.5; // both holes are through holes; over-cut leaves no film
  const bore = drawCircle(r).translate(nOut - g * (d.pad / 2), d.zTop - d.pad / 2);
  return { pad: prism(prof, u0, s.len), bore: prism(bore, u0 - over, s.len + 2 * over) };
}

/**
 * Fuse the boss halves for `seams` onto one already-split piece.
 *
 * Per piece, after slicing — never as one solid straddling the seam that the
 * split later divides. A wide dovetail pushes the tang footprint out toward the
 * case wall (at the defaults it already reaches into the pad's own band), so a
 * straddling pad would be handed to the wrong piece and gouged by the socket's
 * clearance growth, right where the hole is.
 *
 * Pads are fused first and all bores cut afterwards as one cutter: a pad may
 * merge with a divider rib that happens to fall in its span, and the screw still
 * has to pass through it.
 */
function addBosses(piece: Shape3D, p: ParamValues, d: BossDims | null, seams: BossSeam[]): Shape3D {
  if (!d || !seams.length) return piece;
  let out = piece;
  let bores: Shape3D | null = null;
  for (const s of seams) {
    const half = bossHalf(p, s, d);
    out = out.fuse(half.pad);
    bores = bores ? bores.fuse(half.bore) : half.bore;
  }
  return bores ? (out.cut(bores) as Shape3D) : out;
}

/**
 * Split the one-piece frame into dovetailed border pieces so it prints in
 * bed-sized parts. The base split is 2 long side-rails + 2 short end caps, cut
 * at the cavity-length boundary (X = ±cavityHalfLength); each long rail carries
 * a dovetail tang at the border centre of its ends (BOARDER_DOVETAIL_WIDTH wide,
 * _DEPTH deep, flaring by _ANGLE so it locks) that plugs into a socket in the
 * end cap. The end caps keep the rounded corners. The socket cut is grown by
 * BOARDER_DOVETAIL_CLEAR beyond the tang, leaving a print-clearance gap.
 *
 * When a printer bed is given (bedWidth/bedDepth > 0), each rail is further
 * subdivided into in-line segments so no piece exceeds the usable bed area
 * (bed minus 2*bedMargin), with an extra dovetail seam at every cut. Blank bed
 * fields (0) mean "no limit" → the original four pieces (Nlong = Nend = 1), so
 * this is a strict generalization of the 4-piece split. Pieces stay in their
 * assembled positions; the viewer and 3MF export present them separately.
 */
function splitPieces(frame: Shape3D, p: ParamValues): Shape3D[] {
  const { length, width } = cavityDims(p);
  const splitX = length / 2;
  const yc = (width / 2 + p.overallWidth / 2) / 2; // long-rail border centre (Y)
  const xcEnd = (length / 2 + p.overallLength / 2) / 2; // end-cap border centre (X)
  const w = p.dovetailWidth;
  const depth = p.dovetailDepth;
  const flare = depth * Math.tan((p.dovetailAngle * Math.PI) / 180);
  const c = p.dovetailClear; // socket grown by this; tang stays nominal
  const big = Math.max(p.overallLength, p.overallWidth); // generous half-plane bound

  // Dovetail trapezoid crossing a seam. `axis` is the direction the tang
  // protrudes (and along which the joint locks): "X" for a seam cutting a long
  // rail, "Y" for one cutting an end cap. `pos` is the seam coordinate on that
  // axis, `band` the centre coordinate on the other axis, `dir` = ±1 the
  // protrusion direction. The base sits 2 mm inside the owning segment so the
  // fuse overlaps with no coincident-face sliver; the flared tip locks it.
  // `grow` enlarges it into a socket (tip and both flanks) by the joint gap.
  const seamTang = (axis: "X" | "Y", pos: number, band: number, dir: 1 | -1, grow = 0): Drawing => {
    const a0 = pos - dir * 2;
    const a1 = pos + dir * (depth + grow);
    const hw = w / 2 + grow;
    const hwTip = w / 2 + flare + grow;
    const pt = (a: number, b: number): [number, number] => (axis === "X" ? [a, b] : [b, a]);
    return draw(pt(a0, band - hw))
      .lineTo(pt(a0, band + hw))
      .lineTo(pt(a1, band + hwTip))
      .lineTo(pt(a1, band - hwTip))
      .close();
  };
  const rect = (x0: number, x1: number, y0: number, y1: number): Drawing =>
    drawRectangle(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2);
  const solid = (d: Drawing): Shape3D =>
    (d.sketchOnPlane("XY", 0) as Sketch).extrude(p.overallHeight) as Shape3D;

  // Grid features go on the piece that owns each wall (avoids orphaning a rib
  // into a neighbour); dividers go on the long sides.
  const wallSpec = (axis: "X" | "Y", sign: 1 | -1, kind: "rib" | "groove"): WallSpec[] =>
    p.gridBump > 0 ? [{ axis, sign, kind }] : [];
  const div = (piece: Shape3D, signY: 1 | -1): Shape3D =>
    p.dividers > 0 ? addDividers(piece, p, signY) : piece;

  // Bed-fit segment counts. A thin rail lies along the bed's longer axis, so the
  // length limit is the larger usable dimension. `cornerReserve`/`interiorReserve`
  // hold back room for the tangs a segment protrudes: long rails keep their
  // corner tangs at every N (2*depth), end caps gain one interior tang when N>1.
  // 0 on either bed dimension = no limit → N=1 (the original 4-piece split).
  const bedActive = p.bedWidth > 0 && p.bedDepth > 0;
  const usable = Math.max(p.bedWidth - 2 * p.bedMargin, p.bedDepth - 2 * p.bedMargin);
  const MAXSEG = 24;
  const fitCount = (span: number, cornerReserve: number, interiorReserve: number): number => {
    if (!bedActive) return 1;
    for (let n = 1; n < MAXSEG; n++) {
      if (span / n + (n === 1 ? cornerReserve : interiorReserve) <= usable) return n;
    }
    return MAXSEG;
  };
  const nLong = fitCount(2 * splitX, 2 * depth, 2 * depth);
  const nEnd = fitCount(p.overallWidth, 0, depth);
  const cutsLong = Array.from({ length: nLong - 1 }, (_, i) => -splitX + ((i + 1) * 2 * splitX) / nLong);
  const cutsEnd = Array.from({ length: nEnd - 1 }, (_, i) => -p.overallWidth / 2 + ((i + 1) * p.overallWidth) / nEnd);

  // Screw bosses (see bossDims / bossHalf): a pad either side of every seam, at
  // the rim on the inside of the case wall. Lengths are worked out per seam and
  // must come out the SAME on both sides, or one piece gets a pad and its mate
  // gets nothing: `seamLen` is therefore a function of the seam alone (both
  // adjoining segments are equal length by construction), and a seam too short
  // for a usable screw yields 0 and is skipped on both sides.
  const bd = p.bosses ? bossDims(p) : null;
  const segLenLong = (2 * splitX) / nLong;
  const segLenEnd = p.overallWidth / nEnd;
  // Where a wall's flat run ends: past this the outer wall turns into the case's
  // rounded plan corner, and a pad placed on the straight-wall face would stand
  // proud of the curve.
  const flatRun = (axis: "X" | "Y", at: number): number =>
    (axis === "X" ? p.overallLength : p.overallWidth) / 2 - p.bottomCornerRadius - Math.abs(at) - 0.5;
  // Half the shorter adjoining segment, less 1 mm, keeps two pads on one segment
  // from running into each other; below 1.5 x the screw diameter there is not
  // enough engagement to call it a joint, so drop the pair.
  const seamLen = (segLen: number, room: number): number => {
    const len = Math.min(p.bossLen, segLen / 2 - 1, room);
    return len >= 1.5 * p.bossScrewDia ? len : 0;
  };
  const longSeamLen = (at: number): number => seamLen(segLenLong, flatRun("X", at));
  const endSeamLen = (at: number): number => seamLen(segLenEnd, flatRun("Y", at));
  // A corner joint's pad sits on the long wall, so on the end cap it is a Y-slice
  // away from being cut in half by a bed split. Only reachable on an absurdly
  // small bed, but half a pad is a broken joint, so drop the pair if it happens.
  const capCutsClearPad = (d: BossDims): boolean => {
    const hi = wallFaceMag("Y", d.zTop, p) + d.embed;
    return cutsEnd.every((c) => Math.abs(c) < hi - d.pad || Math.abs(c) > hi);
  };
  // The corner joint is the same seam seen from the rail (which owns the tang, so
  // it takes the clearance hole) and from the cap (the pilot hole).
  const cornerLen = bd && capCutsClearPad(bd) ? longSeamLen(splitX) : 0;
  // Which Y-segment of an end cap holds the corner pad on the +Y / -Y long wall
  // (the cap is sliced across the pad's axis, so its mate has to be found).
  const cornerSeg = bd
    ? ([1, -1] as const).map((g) => ({
        wallSign: g,
        seg: cutsEnd.filter((c) => c < g * (wallFaceMag("Y", bd.zTop, p) + bd.embed - bd.pad / 2)).length,
      }))
    : [];

  // Slice a featured rail/cap `body` (already the U-channel wall profile) into N
  // in-line segments along `axis`, joined by a wall-profile dovetail at each
  // interior seam. The key follows the wall — like the corner joints — because
  // it is built by adding/removing the tang FOOTPRINT to a segment's 2-D region
  // and intersecting the body, NOT by fusing a solid prism (which would leave a
  // solid block). `band` is the seam's centre on the off-axis. Only the slice
  // `axis` is bounded into segments; the cross-axis spans the full half-plane
  // (±big) so the body's own features are never clipped here — an end-cap rib
  // protrudes past the wall face into the cavity, and clipping the cross-axis at
  // the face (as an earlier version did) shears the rib off. Each seam: left
  // segment gets the tang (region ∪ footprint), right the grown socket (− footprint).
  const sliceSegments = (
    body: Shape3D,
    axis: "X" | "Y",
    n: number,
    cuts: number[],
    band: number,
  ): Shape3D[] => {
    if (n === 1) return [body];
    const bounds = [-big, ...cuts, big];
    const seg = (a0: number, a1: number): Drawing =>
      axis === "X" ? rect(a0, a1, -big, big) : rect(-big, big, a0, a1);
    return Array.from({ length: n }, (_, i) => {
      let region = seg(bounds[i], bounds[i + 1]);
      if (i < n - 1) region = region.fuse(seamTang(axis, cuts[i], band, 1)); // male tang past the far seam
      if (i > 0) region = region.cut(seamTang(axis, cuts[i - 1], band, 1, c)); // socket at the near seam
      return body.clone().intersect(solid(region));
    });
  };

  // One long side-rail (sy = +1 top / -1 bottom): the full featured rail, then
  // sliced into nLong in-line segments. Features/dividers are applied to the
  // whole rail first so slicing (intersect) clips them per segment. Dividers
  // are fused BEFORE the grid groove cut (not after) — same reasoning as the
  // unsplit path in buildPerimeter: a divider sits at the same X as a grid
  // module centre, so cutting the groove last is what keeps it open instead of
  // the divider's fuse silently refilling it.
  const longSegments = (sy: 1 | -1): Shape3D[] => {
    const y0 = sy > 0 ? 0 : -big;
    const y1 = sy > 0 ? big : 0;
    const region0 = rect(-splitX, splitX, y0, y1)
      .fuse(seamTang("X", splitX, sy * yc, 1))
      .fuse(seamTang("X", -splitX, sy * yc, -1));
    const kind = sy > 0 ? "groove" : "rib";
    const rail = applyGridFeatures(div(frame.clone().intersect(solid(region0)), sy), p, wallSpec("Y", sy, kind));
    const segs = sliceSegments(rail, "X", nLong, cutsLong, sy * yc);
    if (!bd) return segs;
    // Bosses go on the long wall this rail owns. The rail carries the tang at
    // both corner joints and at every interior seam it sits BELOW (sliceSegments
    // gives the lower segment the male tang), so those ends take the clearance
    // hole and the piece on the far side takes the pilot.
    return segs.map((seg, i) => {
      const seams: BossSeam[] = [];
      const add = (at: number, side: 1 | -1, hole: "clear" | "pilot", len: number) => {
        if (len) seams.push({ axis: "X", wallSign: sy, at, side, hole, len });
      };
      if (i === 0) add(-splitX, 1, "clear", cornerLen);
      if (i === nLong - 1) add(splitX, -1, "clear", cornerLen);
      if (i < nLong - 1) add(cutsLong[i], -1, "clear", longSeamLen(cutsLong[i]));
      if (i > 0) add(cutsLong[i - 1], 1, "pilot", longSeamLen(cutsLong[i - 1]));
      return addBosses(seg, p, bd, seams);
    });
  };

  // One end cap (ex = +1 right / -1 left): full-width beyond the split with the
  // corners and their (grown) sockets, sliced into nEnd segments along Y.
  const endSegments = (ex: 1 | -1): Shape3D[] => {
    const x0 = ex > 0 ? splitX : -big;
    const x1 = ex > 0 ? big : -splitX;
    const kind = ex > 0 ? "rib" : "groove";
    const cap = applyGridFeatures(frame.clone().intersect(solid(rect(x0, x1, -big, big))), p, wallSpec("X", ex, kind))
      .cut(solid(seamTang("X", ex * splitX, yc, ex, c)))
      .cut(solid(seamTang("X", ex * splitX, -yc, ex, c)));
    const segs = sliceSegments(cap, "Y", nEnd, cutsEnd, ex * xcEnd);
    if (!bd) return segs;
    // Two kinds of seam meet this cap: the corner joints, whose pads sit on the
    // LONG walls (screw along X, pilot side — the rail holds the tang and the
    // screw head), and its own interior bed splits, whose pads sit on the END
    // wall (screw along Y).
    return segs.map((seg, i) => {
      const seams: BossSeam[] = [];
      for (const { wallSign, seg } of cornerSeg) {
        if (cornerLen && seg === i)
          seams.push({ axis: "X", wallSign, at: ex * splitX, side: ex, hole: "pilot", len: cornerLen });
      }
      const add = (at: number, side: 1 | -1, hole: "clear" | "pilot") => {
        const len = endSeamLen(at);
        if (len) seams.push({ axis: "Y", wallSign: ex, at, side, hole, len });
      };
      if (i < nEnd - 1) add(cutsEnd[i], -1, "clear");
      if (i > 0) add(cutsEnd[i - 1], 1, "pilot");
      return addBosses(seg, p, bd, seams);
    });
  };

  return [...longSegments(1), ...longSegments(-1), ...endSegments(1), ...endSegments(-1)];
}

/**
 * Deliberate deviation from the ground truth: `wallThick` and `footThick`
 * default to 3 mm / 4 mm, not the Fusion originals' 1.2 mm / 1 mm. The source
 * design is a thin liner glued inside a rigid case; the generator ships a
 * self-supporting frame meant to be printed and used standalone, so it defaults
 * to heavier walls and floor. Neither drives the registration interface
 * (rib/socket widths, grid pitch, bumps derive from RIB_WIDTH/GRID_BUMP — see
 * registration.ts), so parts still interlock at any thickness. Set them back to
 * 1.2 / 1 mm to reproduce the original geometry. See README "Intentional
 * deviations from the ground truth".
 *
 * RIB_WIDTH (the "Grid bump width" knob, shared with the bins) deviates from
 * the originals too — 3 mm rather than 1.2 mm, for printability. That one IS an
 * interface dimension; see the note on `ribWidthParam` in registration.ts.
 */
export const perimeterParams: ParamDef[] = [
    { key: "overallLength", fusionName: "OVERALL_LENGTH", label: "Case length", default: 350, unit: "mm", min: 60, max: 900, step: 1 },
    { key: "overallWidth", fusionName: "OVERALL_WIDTH", label: "Case width", default: 250, unit: "mm", min: 60, max: 900, step: 1 },
    { key: "overallHeight", fusionName: "OVERALL_HEIGHT", label: "Case depth", default: 110, unit: "mm", min: 10, max: 400, step: 1 },
    { key: "bottomCornerRadius", fusionName: "BOTTOM_CORNER_RADIUS", label: "Bottom corner radius", default: 19.05, unit: "mm", min: 1, max: 60, step: 0.05 },
    { key: "wallCornerRadius", fusionName: "WALL_CORNER_RADIUS", label: "Cavity corner radius", default: 15.5, unit: "mm", min: 1, max: 60, step: 0.5 },
    { key: "sideWallTaper", fusionName: "SIDE_WALL_TAPER", label: "Side wall taper", default: 2, unit: "deg", min: 0, max: 15, step: 0.5 },
    { key: "frontWallTaper", fusionName: "FRONT_WALL_TAPER", label: "Front wall taper", default: 2, unit: "deg", min: 0, max: 15, step: 0.5 },
    { key: "wallThick", fusionName: "WALL_THICK", label: "Wall thickness", default: 3, unit: "mm", min: 0.4, max: 6, step: 0.1 },
    ribWidthParam,
    { key: "clearance", fusionName: "CLEARANCE", label: "Case clearance", default: 0, unit: "mm", min: 0, max: 1, step: 0.05 },
    { key: "gridSpacing", fusionName: "GRID_SPACING", label: "Grid spacing", default: 15, unit: "mm", min: 10, max: 50, step: 0.5 },
    { key: "gridBump", fusionName: "GRID_BUMP", label: "Grid bump", default: 1.5, unit: "mm", min: 0, max: 3, step: 0.1 },
    { key: "sideBoarderBinAdd", fusionName: "SIDE_BOARDER_BIN_ADD", label: "Side border bins", default: 4, unit: "", min: 0, max: 10, step: 1 },
    { key: "frontBoarderBinAdd", fusionName: "FRONT_BOARDER_BIN_ADD", label: "Front border bins", default: 3, unit: "", min: 0, max: 10, step: 1 },
    { key: "footThick", label: "Floor thickness", default: 4, unit: "mm", min: 0.6, max: 6, step: 0.2 },
    { key: "dividers", fusionName: "BOARDER_DIVIDERS", label: "Dividers per long side", default: 4, unit: "", min: 0, max: 12, step: 1 },
    { key: "split", label: "Split into pieces", default: 1, unit: "", min: 0, max: 1, step: 1 },
    { key: "bedWidth", label: "Printer bed width (0 = no limit)", default: 0, unit: "mm", min: 0, max: 1000, step: 1 },
    { key: "bedDepth", label: "Printer bed depth (0 = no limit)", default: 0, unit: "mm", min: 0, max: 1000, step: 1 },
    { key: "bedMargin", label: "Bed margin (per side)", default: 5, unit: "mm", min: 0, max: 30, step: 1 },
    { key: "dovetailWidth", fusionName: "BOARDER_DOVETAIL_WIDTH", label: "Dovetail width", default: 10, unit: "mm", min: 4, max: 30, step: 0.5 },
    { key: "dovetailDepth", fusionName: "BOARDER_DOVETAIL_DEPTH", label: "Dovetail depth", default: 5, unit: "mm", min: 2, max: 15, step: 0.5 },
    { key: "dovetailAngle", fusionName: "BOARDER_DOVETAIL_ANGLE", label: "Dovetail angle", default: 30, unit: "deg", min: 0, max: 45, step: 1 },
    { key: "dovetailClear", fusionName: "BOARDER_DOVETAIL_CLEAR", label: "Dovetail clearance", default: 0.2, unit: "mm", min: 0, max: 1, step: 0.05 },
    { key: "bosses", label: "Screw bosses at split lines (needs split)", default: 0, unit: "", min: 0, max: 1, step: 1 },
    { key: "bossScrewDia", label: "Boss screw size (nominal dia)", default: 3, unit: "mm", min: 2, max: 6, step: 0.5 },
    { key: "bossHoleFactor", label: "Pilot hole factor (x min screw dia)", default: 0.8, unit: "", min: 0.7, max: 0.9, step: 0.01 },
    { key: "bossLen", label: "Boss length (each side of seam)", default: 6, unit: "mm", min: 2, max: 20, step: 0.5 },
    { key: "bossWall", label: "Boss material around hole", default: 2.4, unit: "mm", min: 1, max: 6, step: 0.2 },
];

export function buildPerimeter(p: ParamValues): Shape3D | Shape3D[] {
    const h = p.overallHeight;
    const t = p.wallThick;

    // Outer (case) wall: tapered thin tube, open top and bottom.
    // Coplanar top/bottom caps on purpose: extending the cutter past the ends
    // leaves boolean debris on tapered lofts, and OCCT shell() fails outright.
    // Build the outer block once and reuse it (wall cut, divider bounding).
    const outer = outerLoft(0, p);
    const wallInner = outerLoft(t, p);
    const outerWall = outer.clone().cut(wallInner.clone());

    // Inner (cavity) wall: vertical thin tube on the border side of the cavity.
    const innerWall = (cavityAt(0, t, p) as Sketch)
      .extrude(h)
      .cut((cavityAt(0, 0, p) as Sketch).extrude(h)) as Shape3D;

    // Floor closing the bottom of the channel. Its outer edge follows the pulled-
    // in bottom footprint of the filleted wall (outerAt at z=0), so it is the
    // narrow band the real foot is, and it overlaps the wall base to fuse into
    // one connected solid.
    const floor = (outerAt(0, 0, p) as Sketch)
      .extrude(p.footThick)
      .cut((cavityAt(0, 0, p) as Sketch).extrude(p.footThick)) as Shape3D;

    let frame = (outerWall as Shape3D).fuse(innerWall).fuse(floor);
    // Thicken the near-horizontal base of the fillet up to FLOOR_THICK — see
    // floorCollar.
    const collar = floorCollar(p, wallInner);
    if (collar) frame = frame.fuse(collar);
    // When splitting, grid features + dividers are added per piece (splitPieces);
    // otherwise apply them to the whole frame.
    if (p.split) return splitPieces(frame, p);
    // Dividers FIRST, grid features (grooves) LAST: a divider coincides in X
    // with a grid module centre by construction (dividerCenters draws from the
    // same set gridCenters does), so on the +Y/-X (groove) walls a divider's
    // additive fuse would otherwise refill whatever a groove cut had carved out
    // there. Cutting the groove last guarantees it always wins — it stays a
    // clean blind pocket even where a divider crosses it (the wider backing
    // boss keeps the divider connected to the frame either side of the notch).
    let out = p.dividers > 0 ? addDividers(addDividers(frame, p, 1), p, -1) : frame;
    if (p.gridBump > 0) out = applyGridFeatures(out, p);
    return out;
}

export const perimeter: ModelDef = {
  id: "perimeter",
  name: "Perimeter (frame)",
  description:
    "Liner frame that drops into the hard case: a tapered U-channel border " +
    "around a gridded cavity, split into dovetailed pieces for printing (enter a " +
    "printer bed size to auto-subdivide so every piece fits), with grid bumps, " +
    "configurable dividers and print clearances.",
  params: perimeterParams,
  presets: [
    { label: "Apache 3800", values: { overallLength: 377.825, overallWidth: 268.2875, overallHeight: 110 } },
    { label: "Apache 4800", values: { overallLength: 454.025, overallWidth: 323.85, overallHeight: 125 } },
  ],
  groups: [
    { title: "Basic dimensions", collapsed: false, keys: ["overallLength", "overallWidth", "overallHeight", "wallThick", "footThick"] },
    { title: "Advanced dimensions", collapsed: true, keys: ["bottomCornerRadius", "wallCornerRadius", "sideWallTaper", "frontWallTaper", "clearance"] },
    { title: "Interior features", collapsed: true, keys: ["sideBoarderBinAdd", "frontBoarderBinAdd", "dividers"] },
    { title: "Module features", collapsed: true, keys: ["gridSpacing", "gridBump", "ribWidth"] },
    { title: "Printer convenience", collapsed: false, keys: ["split", "bedWidth", "bedDepth", "bedMargin", "dovetailWidth", "dovetailDepth", "dovetailAngle", "dovetailClear"] },
    { title: "Screw bosses", collapsed: true, keys: ["bosses", "bossScrewDia", "bossHoleFactor", "bossLen", "bossWall"] },
  ],
  build: buildPerimeter,
};
