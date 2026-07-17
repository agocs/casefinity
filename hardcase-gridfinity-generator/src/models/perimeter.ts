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

  // A groove's slot is `b`-deep but the wall is only `t` thick, so the slot cuts
  // clean through and would read as an open slit into the U-channel hollow. Back
  // it with a wider boss (like the bin socket's interior boss) so the female
  // pocket is blind and the cavity stays closed — the bin rib seats against it.
  const bossWide = 3 * t;
  const bossDepth = t + b; // spans the wall plus GRID_BUMP into the hollow

  let out = shape;
  for (const w of walls) {
    const centers = gridCenters(w.axis === "X" ? width : length, p.gridSpacing);
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
      out = out.fuse(feat(half[w.axis] + ribOff, t, ribDepth));
    } else {
      out = out
        .fuse(feat(half[w.axis] + bossDepth / 2, bossWide, bossDepth)) // backing boss
        .cut(feat(half[w.axis] + grooveOff, t, grooveDepth)); // slot through the wall
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
  const innerMag = cavityDims(p).width / 2 - p.gridBump; // bump tip (magnitude)
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
        (profile.sketchOnPlane("YZ", cx - p.wallThick / 2) as Sketch).extrude(
          p.wallThick,
        ) as Shape3D,
    )
    .reduce((a, b) => a.fuse(b));
  return shape.fuse(ribs);
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
  // whole rail first so slicing (intersect) clips them per segment.
  const longSegments = (sy: 1 | -1): Shape3D[] => {
    const y0 = sy > 0 ? 0 : -big;
    const y1 = sy > 0 ? big : 0;
    const region0 = rect(-splitX, splitX, y0, y1)
      .fuse(seamTang("X", splitX, sy * yc, 1))
      .fuse(seamTang("X", -splitX, sy * yc, -1));
    const kind = sy > 0 ? "groove" : "rib";
    const rail = div(applyGridFeatures(frame.clone().intersect(solid(region0)), p, wallSpec("Y", sy, kind)), sy);
    const cuts = Array.from({ length: nLong - 1 }, (_, i) => -splitX + ((i + 1) * 2 * splitX) / nLong);
    return sliceSegments(rail, "X", nLong, cuts, sy * yc);
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
    const cuts = Array.from({ length: nEnd - 1 }, (_, i) => -p.overallWidth / 2 + ((i + 1) * p.overallWidth) / nEnd);
    return sliceSegments(cap, "Y", nEnd, cuts, ex * xcEnd);
  };

  return [...longSegments(1), ...longSegments(-1), ...endSegments(1), ...endSegments(-1)];
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
    { key: "split", label: "Split into pieces", default: 1, unit: "", min: 0, max: 1, step: 1 },
    { key: "bedWidth", label: "Printer bed width (0 = no limit)", default: 0, unit: "mm", min: 0, max: 1000, step: 1 },
    { key: "bedDepth", label: "Printer bed depth (0 = no limit)", default: 0, unit: "mm", min: 0, max: 1000, step: 1 },
    { key: "bedMargin", label: "Bed margin (per side)", default: 5, unit: "mm", min: 0, max: 30, step: 1 },
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
    "around a gridded cavity, split into dovetailed pieces for printing (enter a " +
    "printer bed size to auto-subdivide so every piece fits), with grid bumps, " +
    "configurable dividers and print clearances.",
  params: perimeterParams,
  build: buildPerimeter,
};
