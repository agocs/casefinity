import type { ModelDef, ParamValues } from "./types.ts";
import { buildPerimeter, perimeterParams } from "./perimeter.ts";
import { box } from "./bin-common.ts";
import type { Shape3D } from "replicad";

/**
 * Port of Hardcase_Gridfinity_Perimeter_Template.step — two 1mm-thin
 * cross-section slices through the perimeter wall profile, used for
 * verifying the U-channel shape at a glance (e.g. before printing).
 *
 * Solid 0: slice through the end wall (short side, 250mm direction)
 * Solid 1: slice through the side wall (long side, 350mm direction)
 *
 * Both are 1mm thick, full height, positioned at the centre of the wall.
 * Ground truth: 2 solids, volumes 6,646 and 8,646 mm³.
 */

export const perimeterTemplate: ModelDef = {
  id: "perimeter-template",
  name: "Perimeter template",
  description:
    "Two 1mm cross-section strips of the perimeter wall profile — one " +
    "through the end wall, one through the side wall. A quick sanity check " +
    "for the U-channel shape before printing.",
  params: perimeterParams,
  build(p: ParamValues): Shape3D[] {
    // Build the full perimeter (unsplit, single fused solid)
    const result = buildPerimeter({ ...p, split: 0 });
    const perimeter = Array.isArray(result) ? result[0] : result;

    const w = p.overallLength;
    const d = p.overallWidth;
    const h = p.overallHeight;

    // Compute cavity dimensions to find wall centres
    const sideBorder =
      w - p.gridSpacing * (Math.floor(w / p.gridSpacing) - p.sideBoarderBinAdd);
    const frontBorder =
      d - p.gridSpacing * (Math.floor(d / p.gridSpacing) - p.frontBoarderBinAdd);
    const cavityLen = w - sideBorder;
    const cavityWid = d - frontBorder;

    // Wall inner edges (cavity boundary) plus a small offset into the wall.
    // The 1mm slab captures the inner wall face and floor connection.
    const edgeOffset = 0; // try 0 first, then calibrate
    const xInner = cavityLen / 2 + edgeOffset;
    const yInner = cavityWid / 2 + edgeOffset;

    // End wall slice: 1mm thick in X, at the +X cavity edge.
    const endSlice = box(1, d, 0, h)
      .translate(xInner, 0, 0)
      .intersect(perimeter);

    // Side wall slice: 1mm thick in Y, at the +Y cavity edge.
    const sideSlice = box(w, 1, 0, h)
      .translate(0, yInner, 0)
      .intersect(perimeter);

    return [endSlice as Shape3D, sideSlice as Shape3D];
  },
};