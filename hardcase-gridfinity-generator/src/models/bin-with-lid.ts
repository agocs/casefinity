import { draw } from "replicad";
import type { Shape3D, Sketch } from "replicad";
import type { ModelDef, ParamValues } from "./types.ts";
import { binParams, buildBinBody, withDefaults } from "./bin-common.ts";

/**
 * Port of Hardcase_Gridfinity_Bin with Lid.f3d: the shared bin body plus a
 * sliding lid, modeled in place (as in the original file).
 *
 * The lid (measured from ground truth): a LID_THICK plate sitting
 * LID_LOCK_OFFSET + LID_CLEAR below the rim, reaching under the pull tab on
 * one side and into a shallow wall groove on the entry side, with a ramped
 * top surface on the entry edge.
 *
 * Not yet ported (≈1% of assembly volume — see README porting status):
 * - the lid seat cut into the bin walls/bosses and the scalloped +X rail
 * - lid lock notches and the engraved "TOP" label
 */

function buildLid(p: ParamValues): Shape3D {
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const d = p.lengthModules * p.gridSpacing - 2 * p.clear;
  const h = p.overallHeight;
  const t = p.wallThick;

  const z0 = h - p.lidThick - (p.lidLockOffset + p.lidClear);
  const z1 = z0 + p.lidThick;
  // measured wall engagements at defaults: 0.8 into the -X wall groove,
  // 0.85 clear of the +X rail
  const xMin = -(w / 2 - t) - 0.8;
  const xMax = w / 2 - t - 0.85;
  const yMin = -(d / 2) + p.clear; // entry side: nearly through the wall
  const yMax = d / 2 - t - p.lidClear; // under the pull tab
  const rampRun = 8.3;
  const rampDrop = 1.5;

  // profile in (y, z), extruded along +X
  const profile = draw([yMin, z0])
    .lineTo([yMax, z0])
    .lineTo([yMax, z1])
    .lineTo([yMin + rampRun, z1])
    .lineTo([yMin, z1 - rampDrop])
    .close();
  return (profile.sketchOnPlane("YZ", xMin) as Sketch).extrude(
    xMax - xMin,
  ) as Shape3D;
}

export const binWithLid: ModelDef = {
  id: "bin-with-lid",
  name: "Bin with lid",
  description:
    "Bin plus a sliding lid that tucks under the pull tab and locks into " +
    "the walls. Lid seat and label engraving still to come.",
  params: [
    ...withDefaults(binParams, { pullHoleLength: 12 }),
    { key: "lidThick", fusionName: "LID_THICK", label: "Lid thickness", default: 3, unit: "mm", min: 1, max: 6, step: 0.5 },
    { key: "lidClear", fusionName: "LID_CLEAR", label: "Lid clearance", default: 0.1, unit: "mm", min: 0, max: 0.5, step: 0.05 },
    { key: "lidLockOffset", fusionName: "LID_LOCK_OFFSET", label: "Lid lock offset", default: 0.2, unit: "mm", min: 0, max: 1, step: 0.1 },
  ],
  build(p) {
    return [buildBinBody(p), buildLid(p)];
  },
};
