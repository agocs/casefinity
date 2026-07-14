import type { ModelDef, ParamValues } from "./types.ts";
import { drawRoundedRectangle } from "replicad";
import type { Shape3D, Sketch } from "replicad";
import { perimeterParams } from "./perimeter.ts";
import { box } from "./bin-common.ts";

/**
 * Port of Hardcase_Gridfinity_Perimeter_Template.step — two 1mm-thin
 * cross-section slices through the HARD CASE SHELL, arranged at right
 * angles. Each slice is a D-shaped profile ~10mm thick showing the case
 * wall: rounded bottom, straight tapered sides.
 *
 * Ground truth: 2 solids, volumes ~6,646 and ~8,646 mm³.
 */

function deg(d: number): number { return (d * Math.PI) / 180; }

/** Build the case shell wall: a hollow box with tapered sides and a
 * rounded bottom, ~10mm thick. */
function caseShell(p: ParamValues): Shape3D {
  const L = p.overallLength;   // 350
  const W = p.overallWidth;    // 250
  const H = p.overallHeight;   // 110
  const R = p.bottomCornerRadius; // 19.05
  const t = 10.05; // case wall stroke at the bottom
  const taper = Math.tan(deg(p.sideWallTaper)); // ~tan(2°)

  // Outer: shrinks from L×W at z=H down to (L-2*H*taper)×(W-2*H*taper) at z=0,
  // with the bottom R mm pulled further inward by the fillet.
  // Inner: same shape, offset inward by t on all sides.

  function outerRect(z: number): { len: number; wid: number; rad: number } {
    const shrink = 2 * (H - z) * taper;
    // Fillet inset at height z
    let fillet = 0;
    if (z < R) fillet = 2 * (R - Math.sqrt(R * R - (R - z) * (R - z)));
    return {
      len: L - shrink - fillet,
      wid: W - shrink - fillet,
      rad: Math.max(R, 0.5),
    };
  }

  function innerRect(z: number): { len: number; wid: number; rad: number } {
    const o = outerRect(z);
    return {
      len: o.len - 2 * t,
      wid: o.wid - 2 * t,
      rad: Math.max(R - t, 0.5),
    };
  }

  function sketchAt(z: number, rect: { len: number; wid: number; rad: number }): Sketch {
    return drawRoundedRectangle(rect.len, rect.wid, rect.rad).sketchOnPlane("XY", z) as Sketch;
  }

  // Outer solid: loft from z=0 to z=H
  const outerSolid = (sketchAt(0, outerRect(0)).loftWith(sketchAt(H, outerRect(H))) as Shape3D);

  // Inner solid: same shape, offset inward by t
  const innerSolid = (sketchAt(0, innerRect(0)).loftWith(sketchAt(H, innerRect(H))) as Shape3D);

  return outerSolid.cut(innerSolid);
}

export const perimeterTemplate: ModelDef = {
  id: "perimeter-template",
  name: "Perimeter template",
  description:
    "Two 1mm cross-section slices of the hard case shell, arranged at " +
    "right angles. D-shaped profiles showing the case wall thickness.",
  params: perimeterParams,
  build(p: ParamValues): Shape3D[] {
    const shell = caseShell(p);
    const w = p.overallLength;
    const d = p.overallWidth;
    const h = p.overallHeight;
    const t = 10.05;

    // Wall centres: halfway between outer edge and inner surface
    const xCenter = w / 2 - t / 2;
    const yCenter = d / 2 - t / 2;

    // Side wall slice: 1mm thick in Y, at the +Y wall centre
    const sideSlice = box(w, 1, 0, h)
      .translate(0, yCenter, 0)
      .intersect(shell);

    // End wall slice: 1mm thick in X, at the +X wall centre
    const endSlice = box(1, d, 0, h)
      .translate(xCenter, 0, 0)
      .intersect(shell);

    return [endSlice as Shape3D, sideSlice as Shape3D];
  },
};