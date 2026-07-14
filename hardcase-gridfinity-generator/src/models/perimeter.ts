import { drawRoundedRectangle, drawRectangle, draw } from "replicad";
import type { Shape3D, Sketch, Drawing } from "replicad";
import type { ModelDef, ParamDef, ParamValues } from "./types.ts";

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
 *
 * Remaining simplification: the foot is a flat floor rather than the real gusset
 * ramp, but the fit-critical outer surface (taper + bottom fillet) matches.
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

/** Centres of the grid cells along a cavity edge of the given clear span. */
function gridCenters(span: number, spacing: number): number[] {
  const n = Math.round(span / spacing);
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/**
 * Grid-bump features on the inner (cavity) wall, one per grid-cell centre,
 * full height. Like the bins, adjacent walls differ: the -Y and +X walls carry
 * ribs proud into the cavity (GRID_BUMP proud, WALL_THICK wide), while the
 * opposite +Y and -X walls carry matching grooves cut into the wall — so a bin,
 * whose exterior has ribs on two faces and sockets on the two others, registers
 * either way round.
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
  // Ribs span GRID_BUMP proud of the cavity face plus WALL_THICK back into the
  // wall; grooves cut from 0.3 mm inside the face to GRID_BUMP deep.
  const ribDepth = b + t;
  const grooveDepth = b + 0.3;
  const ribOff = (t - b) / 2; // face -> rib-box centre (proud into cavity)
  const grooveOff = grooveDepth / 2 - 0.3; // face -> groove-box centre (into wall)
  const rect = (cx: number, cy: number, wx: number, wy: number) =>
    drawRectangle(wx, wy).translate(cx, cy);
  type Draw = ReturnType<typeof rect>;
  const solid = (rects: Draw[]) =>
    rects.reduce((a, r) => (a ? a.fuse(r) : r)).sketchOnPlane("XY", 0).extrude(p.overallHeight) as Shape3D;

  let out = shape;
  for (const w of walls) {
    const deep = w.kind === "rib" ? ribDepth : grooveDepth;
    const off = w.kind === "rib" ? ribOff : grooveOff;
    const centers = gridCenters(w.axis === "X" ? width : length, p.gridSpacing);
    const rects = centers.map((c) =>
      w.axis === "X"
        ? rect(w.sign * (half.X + off), c, deep, t) // ±X wall: features along Y
        : rect(c, w.sign * (half.Y + off), t, deep), // ±Y wall: features along X
    );
    out = w.kind === "rib" ? out.fuse(solid(rects)) : out.cut(solid(rects));
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
 * height cross-rib, WALL_THICK wide, that fills the U-channel from the cavity-
 * face bump across to the case wall — like the BOARDER_DIVIDERS ribs in the
 * source (there placed ad hoc; here at `dividers` evenly-spaced grid centres).
 *
 * The rib's outer edge is drawn as a Y-Z profile that follows the wall taper and
 * bottom fillet, so it meets the case wall at every height without an expensive
 * intersect against the outer loft. Applied last (after the grid grooves) so a
 * groove can't slice a rib.
 */
function addDividers(shape: Shape3D, p: ParamValues, signY: 1 | -1): Shape3D {
  const centers = dividerCenters(p);
  if (!centers.length) return shape;
  const h = p.overallHeight;
  const inner = signY * (cavityDims(p).width / 2 - p.gridBump); // bump tip
  const zs = [0, 0.3, 0.6, 1].map((f) => f * p.bottomCornerRadius).concat(h);
  // Profile in the Y-Z plane: inner edge straight at `inner`, outer edge tracing
  // the wall from the base fillet up to the mouth.
  let prof = draw([inner, 0]);
  for (const z of zs) prof = prof.lineTo([signY * outerInnerY(z, p), z]);
  prof = prof.lineTo([inner, h]);
  const profile = prof.close();
  const ribs = centers
    .map(
      (cx) =>
        (profile.sketchOnPlane("YZ", cx - p.wallThick / 2) as Sketch).extrude(
          p.wallThick,
        ) as Shape3D,
    )
    .reduce((a, b) => a.fuse(b));
  return shape.fuse(ribs);
}

/**
 * Split the one-piece frame into four dovetailed border pieces (2 long sides +
 * 2 short ends) so it prints in case-sized parts. The split runs at the cavity-
 * length boundary (X = ±cavityHalfLength); each long-side piece carries a
 * dovetail tang at the border centre of its ends (BOARDER_DOVETAIL_WIDTH wide,
 * _DEPTH deep, flaring by _ANGLE so it locks) that plugs into a matching socket
 * in the end piece. The end pieces keep the rounded corners.
 *
 * The socket cut in the end pieces is grown by BOARDER_DOVETAIL_CLEAR beyond the
 * side pieces' tang, leaving a print-clearance gap so the joint slides together.
 */
function splitPieces(frame: Shape3D, p: ParamValues): Shape3D[] {
  const { length, width } = cavityDims(p);
  const splitX = length / 2;
  const yc = (width / 2 + p.overallWidth / 2) / 2; // long-side border centre
  const w = p.dovetailWidth;
  const depth = p.dovetailDepth;
  const flare = depth * Math.tan((p.dovetailAngle * Math.PI) / 180);
  const big = p.overallLength; // generous half-plane bound

  // Dovetail footprint at corner (sx, sy): base set 2 mm inside the split line
  // X = sx*splitX (overlaps the side rectangle cleanly, no sliver seam), tip
  // `depth` further out, flared (dovetail). `grow` enlarges the socket beyond the
  // tang by the joint clearance on the tip and both flanks.
  const tang = (sx: number, sy: number, grow = 0): Drawing => {
    const x0 = sx * (splitX - 2);
    const x1 = sx * (splitX + depth) + sx * grow;
    const y = sy * yc;
    const hw = w / 2 + grow;
    const hwTip = w / 2 + flare + grow;
    return draw([x0, y - hw])
      .lineTo([x0, y + hw])
      .lineTo([x1, y + hwTip])
      .lineTo([x1, y - hwTip])
      .close();
  };
  const rect = (x0: number, x1: number, y0: number, y1: number): Drawing =>
    drawRectangle(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2);
  const solid = (d: Drawing): Shape3D =>
    (d.sketchOnPlane("XY", 0) as Sketch).extrude(p.overallHeight) as Shape3D;
  const piece = (region: Drawing): Shape3D => frame.clone().intersect(solid(region));

  const c = p.dovetailClear; // socket grown by this; tang stays nominal
  // Long sides: middle X-span plus tangs into both ends.
  const sidePlus = rect(-splitX, splitX, 0, big).fuse(tang(1, 1)).fuse(tang(-1, 1));
  const sideMinus = rect(-splitX, splitX, -big, 0).fuse(tang(1, -1)).fuse(tang(-1, -1));
  // Ends: full-width beyond the split, minus the (grown) tang sockets; corners stay.
  const endPlus = rect(splitX, big, -big, big).cut(tang(1, 1, c)).cut(tang(1, -1, c));
  const endMinus = rect(-big, -splitX, -big, big).cut(tang(-1, 1, c)).cut(tang(-1, -1, c));

  // Add each wall's grid features to the piece that owns that wall (avoids
  // orphaning a rib into the neighbouring piece); dividers go on the long sides.
  const wall = (axis: "X" | "Y", sign: 1 | -1, kind: "rib" | "groove"): WallSpec[] =>
    p.gridBump > 0 ? [{ axis, sign, kind }] : [];
  const div = (piece: Shape3D, signY: 1 | -1): Shape3D =>
    p.dividers > 0 ? addDividers(piece, p, signY) : piece;
  return [
    div(applyGridFeatures(piece(sidePlus), p, wall("Y", 1, "groove")), 1),
    div(applyGridFeatures(piece(sideMinus), p, wall("Y", -1, "rib")), -1),
    applyGridFeatures(piece(endPlus), p, wall("X", 1, "rib")),
    applyGridFeatures(piece(endMinus), p, wall("X", -1, "groove")),
  ];
}

export const perimeterParams: ParamDef[] = [
    { key: "overallLength", fusionName: "OVERALL_LENGTH", label: "Case length", default: 350, unit: "mm", min: 60, max: 900, step: 1 },
    { key: "overallWidth", fusionName: "OVERALL_WIDTH", label: "Case width", default: 250, unit: "mm", min: 60, max: 900, step: 1 },
    { key: "overallHeight", fusionName: "OVERALL_HEIGHT", label: "Case depth", default: 110, unit: "mm", min: 10, max: 400, step: 1 },
    { key: "bottomCornerRadius", fusionName: "BOTTOM_CORNER_RADIUS", label: "Bottom corner radius", default: 19.05, unit: "mm", min: 1, max: 60, step: 0.05 },
    { key: "wallCornerRadius", fusionName: "WALL_CORNER_RADIUS", label: "Cavity corner radius", default: 15.5, unit: "mm", min: 1, max: 60, step: 0.5 },
    { key: "sideWallTaper", fusionName: "SIDE_WALL_TAPER", label: "Side wall taper", default: 2, unit: "deg", min: 0, max: 15, step: 0.5 },
    { key: "frontWallTaper", fusionName: "FRONT_WALL_TAPER", label: "Front wall taper", default: 2, unit: "deg", min: 0, max: 15, step: 0.5 },
    { key: "wallThick", fusionName: "WALL_THICK", label: "Wall thickness", default: 1.2, unit: "mm", min: 0.4, max: 5, step: 0.1 },
    { key: "clearance", fusionName: "CLEARANCE", label: "Case clearance", default: 0, unit: "mm", min: 0, max: 1, step: 0.05 },
    { key: "gridSpacing", fusionName: "GRID_SPACING", label: "Grid spacing", default: 15, unit: "mm", min: 10, max: 50, step: 0.5 },
    { key: "gridBump", fusionName: "GRID_BUMP", label: "Grid bump", default: 1.5, unit: "mm", min: 0, max: 3, step: 0.1 },
    { key: "sideBoarderBinAdd", fusionName: "SIDE_BOARDER_BIN_ADD", label: "Side border bins", default: 4, unit: "", min: 0, max: 10, step: 1 },
    { key: "frontBoarderBinAdd", fusionName: "FRONT_BOARDER_BIN_ADD", label: "Front border bins", default: 3, unit: "", min: 0, max: 10, step: 1 },
    { key: "footThick", label: "Floor thickness", default: 1, unit: "mm", min: 0.6, max: 6, step: 0.2 },
    { key: "dividers", fusionName: "BOARDER_DIVIDERS", label: "Dividers per long side", default: 4, unit: "", min: 0, max: 12, step: 1 },
    { key: "split", label: "Split into 4 pieces", default: 1, unit: "", min: 0, max: 1, step: 1 },
    { key: "dovetailWidth", fusionName: "BOARDER_DOVETAIL_WIDTH", label: "Dovetail width", default: 10, unit: "mm", min: 4, max: 30, step: 0.5 },
    { key: "dovetailDepth", fusionName: "BOARDER_DOVETAIL_DEPTH", label: "Dovetail depth", default: 5, unit: "mm", min: 2, max: 15, step: 0.5 },
    { key: "dovetailAngle", fusionName: "BOARDER_DOVETAIL_ANGLE", label: "Dovetail angle", default: 30, unit: "deg", min: 0, max: 45, step: 1 },
    { key: "dovetailClear", fusionName: "BOARDER_DOVETAIL_CLEAR", label: "Dovetail clearance", default: 0.2, unit: "mm", min: 0, max: 1, step: 0.05 },
];

export function buildPerimeter(p: ParamValues): Shape3D | Shape3D[] {
    const h = p.overallHeight;
    const t = p.wallThick;

    // Outer (case) wall: tapered thin tube, open top and bottom.
    // Coplanar top/bottom caps on purpose: extending the cutter past the ends
    // leaves boolean debris on tapered lofts, and OCCT shell() fails outright.
    // Build the outer block once and reuse it (wall cut, divider bounding).
    const outer = outerLoft(0, p);
    const outerWall = outer.clone().cut(outerLoft(t, p));

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

    const frame = (outerWall as Shape3D).fuse(innerWall).fuse(floor);
    // When splitting, grid features + dividers are added per piece (splitPieces);
    // otherwise apply them to the whole frame.
    if (p.split) return splitPieces(frame, p);
    let out = p.gridBump > 0 ? applyGridFeatures(frame, p) : frame;
    if (p.dividers > 0) out = addDividers(addDividers(out, p, 1), p, -1);
    return out;
}

export const perimeter: ModelDef = {
  id: "perimeter",
  name: "Perimeter (frame)",
  description:
    "Liner frame that drops into the hard case: a tapered U-channel border " +
    "around a gridded cavity, split into four dovetailed pieces for printing, " +
    "with grid bumps, configurable dividers and print clearances.",
  params: perimeterParams,
  build: buildPerimeter,
};
