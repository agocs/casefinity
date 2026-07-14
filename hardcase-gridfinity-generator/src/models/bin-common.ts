import { draw, drawRectangle } from "replicad";
import type { Shape3D, Sketch } from "replicad";
import type { ParamDef, ParamValues } from "./types.ts";

/**
 * Shared geometry for the Hardcase Gridfinity bins, reverse-engineered from
 * the ground-truth STEP files by slab probing and boolean diffing (see
 * scripts/diff-model.mjs; the no-lid variant matches to 0.02% by volume).
 *
 * - Outer footprint: modules * GRID_SPACING - 2 * CLEAR, sharp corners
 * - Floor FLOOR_THICK, walls WALL_THICK, open top at OVERALL_HT
 * - Bins interlock side by side: exterior vertical ribs (WALL_THICK wide,
 *   WALL_BUMP proud) at module centers on two adjacent faces (-X, +Y); the
 *   opposite walls carry matching sockets — a slot (WALL_THICK + 2*CLEAR
 *   wide, WALL_BUMP deep) cut through the wall at each module center,
 *   backed by an interior boss (slot + 2*WALL_THICK wide, WALL_BUMP thick)
 *   so the neighbouring bin's rib snaps in without opening the cavity
 * - One wall (+Y, a ribbed one) extends PULL_TAB_HT above the rim with a
 *   drafted pull slot and two 45-degree gussets (side-wall continuations)
 */

export function box(
  width: number,
  depth: number,
  z0: number,
  z1: number,
  cx = 0,
  cy = 0,
): Shape3D {
  return drawRectangle(width, depth)
    .translate(cx, cy)
    .sketchOnPlane("XY", z0)
    .extrude(z1 - z0) as Shape3D;
}

/** x/y offsets of module centers, e.g. 3 modules @ 15 -> [-15, 0, 15] */
export function moduleCenters(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
}

/** Parameters shared by every bin variant. */
export const binParams: ParamDef[] = [
  { key: "widthModules", fusionName: "WIDTH_MODULE_NUMBER", label: "Width (modules)", default: 3, unit: "", min: 1, max: 20, step: 1 },
  { key: "lengthModules", fusionName: "LENGTH_MODULE_NUMBER", label: "Length (modules)", default: 3, unit: "", min: 1, max: 20, step: 1 },
  { key: "gridSpacing", fusionName: "GRID_SPACING", label: "Grid spacing", default: 15, unit: "mm", min: 10, max: 50, step: 0.5 },
  { key: "overallHeight", fusionName: "OVERALL_HT", label: "Height", default: 110, unit: "mm", min: 20, max: 300, step: 1 },
  { key: "wallThick", fusionName: "WALL_THICK", label: "Wall thickness", default: 1.2, unit: "mm", min: 0.8, max: 3, step: 0.1 },
  { key: "floorThick", fusionName: "FLOOR_THICK", label: "Floor thickness", default: 1, unit: "mm", min: 0.6, max: 4, step: 0.2 },
  { key: "clear", fusionName: "CLEAR", label: "Clearance", default: 0.1, unit: "mm", min: 0, max: 0.5, step: 0.05 },
  { key: "wallBump", fusionName: "WALL_BUMP", label: "Rib depth", default: 1.5, unit: "mm", min: 0.5, max: 3, step: 0.1 },
  { key: "pullTabHeight", fusionName: "PULL_TAB_HT", label: "Pull tab height", default: 5, unit: "mm", min: 0, max: 15, step: 0.5 },
  { key: "pullHoleLength", fusionName: "PULL_HOLE_LENGTH", label: "Pull slot length", default: 10, unit: "mm", min: 4, max: 30, step: 1 },
  { key: "lidPullHeight", fusionName: "LID_PULL_HT", label: "Pull slot height", default: 1, unit: "mm", min: 0.5, max: 5, step: 0.5 },
];

export function withDefaults(
  params: ParamDef[],
  overrides: Record<string, number>,
): ParamDef[] {
  return params.map((p) =>
    p.key in overrides ? { ...p, default: overrides[p.key] } : p,
  );
}

/**
 * The side-wall interlock: exterior ribs on the -X and +Y faces (WALL_BUMP
 * proud), matching sockets on the +X and -Y faces (a slot through the wall
 * backed by an interior boss). `bossZ0` is where the interior bosses start (the
 * floor level, so they don't obstruct the cavity floor). Shared by every bin.
 */
export function addInterlockRibs(
  bin: Shape3D,
  w: number,
  d: number,
  h: number,
  p: ParamValues,
  bossZ0: number,
): Shape3D {
  const t = p.wallThick;
  const bump = p.wallBump;
  const slotWidth = t + 2 * p.clear;
  const bossWidth = slotWidth + 2 * t;
  for (const c of moduleCenters(p.lengthModules, p.gridSpacing)) {
    bin = bin.fuse(box(bump, t, 0, h, -w / 2 - bump / 2, c));
  }
  for (const c of moduleCenters(p.widthModules, p.gridSpacing)) {
    bin = bin.fuse(box(t, bump, 0, h, c, d / 2 + bump / 2));
  }
  for (const c of moduleCenters(p.lengthModules, p.gridSpacing)) {
    bin = bin
      .fuse(box(bump, bossWidth, bossZ0, h, w / 2 - t - bump / 2, c))
      .cut(box(bump, slotWidth, 0, h, w / 2 - bump / 2, c));
  }
  for (const c of moduleCenters(p.widthModules, p.gridSpacing)) {
    bin = bin
      .fuse(box(bossWidth, bump, bossZ0, h, c, -d / 2 + t + bump / 2))
      .cut(box(slotWidth, bump, 0, h, c, -d / 2 + bump / 2));
  }
  return bin;
}

/**
 * The pull tab: the +Y wall continues PULL_TAB_HT above the rim with two 45°
 * side gussets and a drafted finger slot. Shared by the bin variants.
 */
export function addPullTab(bin: Shape3D, w: number, d: number, h: number, p: ParamValues): Shape3D {
  const t = p.wallThick;
  bin = bin.fuse(box(w, t, h, h + p.pullTabHeight, 0, d / 2 - t / 2));
  const yInner = d / 2 - t;
  const gusset = draw([yInner, h])
    .lineTo([yInner - p.pullTabHeight, h])
    .lineTo([yInner, h + p.pullTabHeight])
    .close();
  for (const x0 of [w / 2 - t, -w / 2]) {
    bin = bin.fuse((gusset.sketchOnPlane("YZ", x0) as Sketch).extrude(t) as Shape3D);
  }
  // pull slot through the tab: a drafted cut, wider at the inner face
  // (measured 1.86 mm outer / 2.6 mm inner around a LID_PULL_HT core)
  const zc = h + p.pullTabHeight / 2;
  const hOut = (p.lidPullHeight + 0.86) / 2;
  const hIn = (p.lidPullHeight + 1.6) / 2;
  const yOut = d / 2;
  const slot = draw([yOut + 1, zc - hOut])
    .lineTo([yOut, zc - hOut])
    .lineTo([yInner, zc - hIn])
    .lineTo([yInner - 1, zc - hIn])
    .lineTo([yInner - 1, zc + hIn])
    .lineTo([yInner, zc + hIn])
    .lineTo([yOut, zc + hOut])
    .lineTo([yOut + 1, zc + hOut])
    .close();
  return bin.cut(
    (slot.sketchOnPlane("YZ", -p.pullHoleLength / 2) as Sketch).extrude(p.pullHoleLength) as Shape3D,
  );
}

export function buildBinBody(p: ParamValues): Shape3D {
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const d = p.lengthModules * p.gridSpacing - 2 * p.clear;
  const h = p.overallHeight;
  const t = p.wallThick;

  let bin = box(w, d, 0, h).cut(box(w - 2 * t, d - 2 * t, p.floorThick, h + 1));
  bin = addInterlockRibs(bin, w, d, h, p, p.floorThick);
  if (p.pullTabHeight > 0) bin = addPullTab(bin, w, d, h, p);
  return bin;
}
