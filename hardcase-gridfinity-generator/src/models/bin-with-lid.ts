import { draw, drawText } from "replicad";
import type { Shape3D, Sketch } from "replicad";
import type { ModelDef, ParamValues } from "./types.ts";
import { textParam } from "./types.ts";
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
 * The lid seat is cut into the bin walls by subtracting the lid from the body,
 * so the two parts no longer interpenetrate (was ~216 mm³).
 *
 * "TOP" is engraved on the lid's top face using the bundled LiberationSans
 * font (loaded by the worker / smoke bootstrap).
 *
 * Not yet ported (top-face cosmetic detail): the lid's rounded top corners and
 * edge chamfers, the scalloped +X rail, and the lid lock notches.
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
  const lidLen = xMax - xMin;
  const lidWid = yMax - yMin;

  // profile in (y, z), extruded along +X
  const profile = draw([yMin, z0])
    .lineTo([yMax, z0])
    .lineTo([yMax, z1])
    .lineTo([yMin + rampRun, z1])
    .lineTo([yMin, z1 - rampDrop])
    .close();
  let lid = (profile.sketchOnPlane("YZ", xMin) as Sketch).extrude(
    lidLen,
  ) as Shape3D;

  // Engrave the label on the top face
  const label = textParam(p, "lidLabel", "TOP");
  if (label) {
    try {
      const fontSize = 8;
      const engraveDepth = 0.5;
      // Centre the text on the lid using the text's bounding box
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;
      const textDrawing = drawText(label, {
        fontFamily: "LiberationSans",
        fontSize,
        startX: 0,
        startY: 0,
      });
      const bb = textDrawing.boundingBox;
      // Compute true geometric centre from the bounding box corners
      const [bbMin, bbMax] = bb.bounds;
      const textCX = (bbMin[0] + bbMax[0]) / 2;
      const textCY = (bbMin[1] + bbMax[1]) / 2;
      textDrawing.translate(cx - textCX, cy - textCY);
      const textSketch = textDrawing.sketchOnPlane("XY", z1 - engraveDepth) as Sketch;
      lid = lid.cut(textSketch.extrude(engraveDepth + 0.1) as Shape3D);
    } catch (_err) {
      // Text ops can fail if the font isn't loaded; skip engraving gracefully
      console.warn("Lid text engraving failed — skipping");
    }
  }

  return lid;
}

export const binWithLid: ModelDef = {
  id: "bin-with-lid",
  name: "Bin with lid",
  description:
    "Bin plus a sliding lid that tucks under the pull tab. " +
    "Optional engraved label on the lid.",
  params: [
    ...withDefaults(binParams, { pullHoleLength: 12 }),
    { key: "lidThick", fusionName: "LID_THICK", label: "Lid thickness", default: 3, unit: "mm", min: 1, max: 6, step: 0.5 },
    { key: "lidClear", fusionName: "LID_CLEAR", label: "Lid clearance", default: 0.1, unit: "mm", min: 0, max: 0.5, step: 0.05 },
    { key: "lidLockOffset", fusionName: "LID_LOCK_OFFSET", label: "Lid lock offset", default: 0.2, unit: "mm", min: 0, max: 1, step: 0.1 },
    { key: "lidLabel", fusionName: "LID_LABEL", type: "text", label: "Lid label", default: "TOP" },
  ],
  build(p) {
    const lid = buildLid(p);
    // Cut the lid's footprint out of the body so the lid seats in a groove in
    // the walls instead of interpenetrating them.
    const body = buildBinBody(p).cut(lid.clone()) as Shape3D;
    return [body, lid];
  },
};
