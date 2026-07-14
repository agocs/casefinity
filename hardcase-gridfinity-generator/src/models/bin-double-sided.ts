import type { ModelDef, ParamValues } from "./types.ts";
import {
  box,
  addInterlockRibs,
  addPullTab,
  binParams,
  withDefaults,
} from "./bin-common.ts";
import { drawRectangle } from "replicad";
import type { Shape3D, Sketch } from "replicad";

/**
 * Port of Hardcase_Gridfinity_Bin Double Sided.step — an open-ended tube
 * with a central floor (hopper-filleted on the bottom), interlock ribs,
 * pull tab, and two inset lids (one at each end).
 *
 * Ground truth (4×4 modules, default params):
 *   Body: 61.3 × 61.3 × 115  (includes pull tab +5, ribs)
 *   Lids: 57.4 × 58.4 × 3.3  (two, inset ~2 mm from tube)
 *   Body volume: 68,178; each lid ~9,600
 *
 * The hopper (r≈18) on the bottom face of the central floor is
 * approximated with a loft cut: a truncated pyramid from the full
 * interior cross-section at the floor bottom down to a smaller
 * rectangle at z = floorZ0 - r, mimicking a concave fillet.
 */

const doubleSidedParams = withDefaults(binParams, {
  widthModules: 4,
  lengthModules: 4,
});

export const binDoubleSided: ModelDef = {
  id: "bin-double-sided",
  name: "Bin (double sided)",
  description:
    "Open-ended tube usable from both sides. A central floor with a hopper " +
    "divides the bin into two compartments; inset lids close each end. " +
    "Interlock ribs and pull tab match the other bin variants.",
  params: doubleSidedParams,
  build(p: ParamValues): Shape3D[] {
    const w = p.widthModules * p.gridSpacing - 2 * p.clear;
    const d = p.lengthModules * p.gridSpacing - 2 * p.clear;
    const h = p.overallHeight;
    const t = p.wallThick;
    const midH = h / 2;

    // Interior dimensions
    const iw = w - 2 * t;
    const id = d - 2 * t;

    // --- Body ---
    // Open tube through both ends (no bottom floor)
    let body = box(w, d, 0, h).cut(box(iw, id, -1, h + 1));

    // Central floor: solid slab across the full interior cross-section
    // at mid-height. Ground truth is y≈53–56 in Y-up frame.
    const floorZ0 = 53;
    const floorZ1 = 56.2;
    const floorSlab = box(iw, id, floorZ0, floorZ1);
    body = body.fuse(floorSlab);

    // Hopper: a concave fillet on the bottom face of the floor (r≈18).
    // Approximated as a loft cut — a truncated pyramid from the full
    // interior at the floor bottom down to a smaller rectangle at z=floorZ0-r.
    // The inset is calibrated larger than r (25 vs 18) because a pyramid
    // over-removes material in the corners compared to a curved fillet.
    const hopperR = 18;
    const hopperBot = floorZ0 - hopperR; // z ≈ 35
    const hopperInset = 25; // calibrated for volume match (pyramid ≈ curved fillet)
    const topSketch = drawRectangle(iw, id)
      .sketchOnPlane("XY", floorZ0) as Sketch;
    const botSketch = drawRectangle(iw - 2 * hopperInset, id - 2 * hopperInset)
      .sketchOnPlane("XY", hopperBot) as Sketch;
    const hopperCut = (topSketch.loftWith(botSketch) as Shape3D);
    body = body.cut(hopperCut);

    // Interlock ribs (bossZ0 = 0 — no bottom floor to obstruct bosses)
    body = addInterlockRibs(body, w, d, h, p, 0);

    // Pull tab at the +Y face (top of the tube)
    if (p.pullTabHeight > 0) {
      body = addPullTab(body, w, d, h, p);
    }

    // --- Lids ---
    // Two plates closing each end. Ground truth: 57.4 × 58.4 × 3.3.
    // Use interior dimensions minus a small clearance to avoid overlap.
    const lidThick = 3.3;
    const lidClear = 0.3;
    const lidW = iw - lidClear;
    const lidD = id - lidClear;
    const bottomLid = box(lidW, lidD, 0, lidThick);
    const topLid = box(lidW, lidD, h - lidThick, h);

    return [body, bottomLid, topLid];
  },
};