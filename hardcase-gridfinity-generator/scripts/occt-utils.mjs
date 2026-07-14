// Shared bootstrap for the analysis scripts: loads the OCCT kernel into
// replicad (working around the emscripten ESM/CJS-globals mismatch in Node)
// and provides compound-aware STEP import.
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.require = require;
globalThis.__dirname = dirname(
  require.resolve("replicad-opencascadejs/src/replicad_single.js"),
);

const { default: initOpenCascade } = await import(
  "replicad-opencascadejs/src/replicad_single.js"
);

export const oc = await initOpenCascade();
export const replicad = await import("replicad");
replicad.setOC(oc);

/** Import a STEP file and return its solids (explodes compounds). */
export async function importStepSolids(file) {
  const shape = await replicad.importSTEP(new Blob([readFileSync(file)]));
  if (shape.constructor.name !== "Compound") return [shape];
  const solids = [];
  const explorer = new oc.TopExp_Explorer_2(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (explorer.More()) {
    solids.push(replicad.cast(explorer.Current()));
    explorer.Next();
  }
  return solids;
}

export function describe(label, shape) {
  const [lo, hi] = shape.boundingBox.bounds;
  const dims = hi.map((v, i) => v - lo[i]);
  console.log(
    `${label}: vol ${replicad.measureVolume(shape).toFixed(1)} mm^3, ` +
      `dims ${dims.map((d) => d.toFixed(2)).join(" x ")}, ` +
      `bbox [${lo.map((v) => v.toFixed(2))}] .. [${hi.map((v) => v.toFixed(2))}]`,
  );
}

/** A big slab covering [a, b] along the given axis ('x' | 'y' | 'z'). */
export function slab(axis, a, b) {
  const planes = { x: "YZ", y: "ZX", z: "XY" }; // normals point along +axis
  return replicad
    .drawRectangle(2000, 2000)
    .sketchOnPlane(planes[axis], a)
    .extrude(b - a);
}

/** Volume of shape within [a, b] along axis. */
export function slabVolume(shape, axis, a, b) {
  try {
    return replicad.measureVolume(shape.clone().intersect(slab(axis, a, b)));
  } catch {
    return 0; // OCCT booleans can throw on degenerate/empty intersections
  }
}

/** ASCII occupancy map of shape over a 2D grid (axis1 rows, axis2 cols). */
export function occupancyMap(shape, axis1, from1, to1, axis2, from2, to2, cell) {
  const rows = [];
  for (let a = from1; a < to1; a += cell) {
    let row = "";
    for (let b = from2; b < to2; b += cell) {
      let volume = 0;
      try {
        const piece = shape
          .clone()
          .intersect(slab(axis1, a, a + cell))
          .intersect(slab(axis2, b, b + cell));
        volume = replicad.measureVolume(piece);
      } catch {
        // OCCT booleans can throw on degenerate/empty intersections
      }
      row += volume > cell * cell * 0.3 ? "#" : ".";
    }
    rows.push(`${axis1}=${a.toFixed(2).padStart(7)} ${row}`);
  }
  return rows.join("\n");
}
