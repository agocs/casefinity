import { draw, drawText, drawCircle } from "replicad";
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
 * The +X edge carries the rail (see buildLid): the ground-truth lid steps its
 * +X plate face back and protrudes a rounded bead that runs the slide length
 * and seats in a groove in the +X wall. The -X edge is the deeper locking
 * tongue (xMin). The top-face edge is rounded over (rounded top corners +
 * softened top edge), matching the ground truth's top-corner round.
 *
 * Note: the "lid lock notches" once listed as TODO are not present in this
 * ground-truth lid — cross-sectioning shows the entry edge is solid at every
 * height (module centres included), so they were not modelled. The ground truth
 * does have a transverse lip+groove near one edge that is not yet ported.
 */

function buildLid(p: ParamValues): Shape3D {
  const w = p.widthModules * p.gridSpacing - 2 * p.clear;
  const d = p.lengthModules * p.gridSpacing - 2 * p.clear;
  const h = p.overallHeight;
  const t = p.wallThick;

  const z0 = h - p.lidThick - (p.lidLockOffset + p.lidClear);
  const z1 = z0 + p.lidThick;
  // measured wall engagements at defaults: 0.8 into the -X wall groove (the deep
  // locking tongue), 0.85 clear of the +X wall (the +X rail bead reaches here).
  const xMin = -(w / 2 - t) - 0.8;
  // +X rail: the ground-truth lid does not run flat to the +X edge — the plate
  // steps back and a rounded bead (RAIL_PROUD proud, running the full slide
  // length, centred low) protrudes back out to the wall gap, seating in a groove
  // in the +X wall. Step the plate edge in by railProud; the bead below adds it
  // back so the outer extent (and bbox) is unchanged. The body seat-cut forms
  // the matching groove automatically.
  const railProud = 0.75;
  const xRailTip = w / 2 - t - 0.85; // outer face of the rail bead (== old flat edge)
  const xMax = xRailTip - railProud; // stepped-back plate face
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

  // Rounded top corners / softened top edge: round over the top-face edge loop.
  // Measured from ground truth: the top face carries rounded corners (~2 mm) in
  // the top ~0.3 mm and a softened top edge, while the body stays square below.
  // Applied to the bare plate (before the rail and engraving) so the finder
  // can't catch the engraving's letter edges. Fillet failures are non-fatal.
  const topRound = 1.0;
  try {
    lid = lid.fillet(topRound, (e) => e.inPlane("XY", z1)) as Shape3D;
  } catch (_err) {
    console.warn("Lid top-edge round-over failed — skipping");
  }

  // Fuse the +X rail bead: a cylinder along the slide (Y) axis centred on the
  // stepped plate face, so its inner half merges into the plate and its outer
  // half is the rounded rail. Centred just above the lid underside (measured
  // ~0.05 mm up), matching the ground-truth bead height.
  const railCenterZ = z0 + railProud + 0.05;
  // "XZ" plane offset d places the sketch at Y=-d and extrudes toward -Y, so
  // offset -yMax starts the bead at the pull-tab end and runs it back to yMin,
  // spanning the plate's full [yMin, yMax].
  const railBead = (drawCircle(railProud)
    .translate(xMax, railCenterZ)
    .sketchOnPlane("XZ", -yMax) as Sketch).extrude(lidWid) as Shape3D;
  lid = lid.fuse(railBead);

  // Engrave the label on the top face
  const label = textParam(p, "lidLabel", "TOP");
  if (label) {
    try {
      const fontSize = 8;
      const engraveDepth = 0.5;
      // Centre the text on the lid using the text's bounding box.
      // NOTE: Drawing.translate() is broken (doesn't move geometry),
      // so we measure first, then draw at the computed position.
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;
      // Measure the text at origin to find its centre offset
      const measureDrawing = drawText(label, {
        fontFamily: "LiberationSans",
        fontSize,
        startX: 0,
        startY: 0,
      });
      const bb = measureDrawing.boundingBox;
      const [bbMin, bbMax] = bb.bounds;
      const textCX = (bbMin[0] + bbMax[0]) / 2;
      const textCY = (bbMin[1] + bbMax[1]) / 2;
      // Now draw at the correct position
      const textDrawing = drawText(label, {
        fontFamily: "LiberationSans",
        fontSize,
        startX: cx + textCX,
        startY: cy - textCY,
      });
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
  groups: [
    { title: "Basic dimensions", collapsed: false, keys: ["widthModules", "lengthModules", "overallHeight", "wallThick", "floorThick", "clear", "pullTabHeight", "pullHoleLength", "lidPullHeight", "lidLabel"] },
    { title: "Advanced dimensions", collapsed: true, keys: ["lidThick", "lidClear", "lidLockOffset"] },
    { title: "Module features", collapsed: true, keys: ["gridSpacing", "ribWidth", "wallBump"] },
  ],
  build(p) {
    const lid = buildLid(p);
    // Cut the lid's footprint out of the body so the lid seats in a groove in
    // the walls instead of interpenetrating them.
    const body = buildBinBody(p).cut(lid.clone()) as Shape3D;
    return [body, lid];
  },
};
