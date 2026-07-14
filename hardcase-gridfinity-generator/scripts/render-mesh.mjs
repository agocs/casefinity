// Render solids to orthographic depth-map PNGs (one per view axis).
// Boolean-free: meshes the shape and rasterizes triangles with a z-buffer.
//
// Usage:
//   node scripts/render-mesh.mjs <file.step[#solidIndex] | model:id> <out-prefix> [size]
// Produces <out-prefix>-x.png, -y.png, -z.png (view along each axis).
import { importStepSolids } from "./occt-utils.mjs";
import { renderViews } from "./render-lib.mjs";

const [source, outPrefix = "render", sizeArg = "400"] = process.argv.slice(2);

let shapes;
if (source.startsWith("model:")) {
  const { modelById, defaultValues } = await import("../src/models/index.ts");
  const model = modelById(source.slice(6));
  const built = model.build(defaultValues(model));
  shapes = Array.isArray(built) ? built : [built];
} else {
  const [file, solidIndex] = source.split("#");
  shapes = await importStepSolids(file);
  if (solidIndex !== undefined) shapes = [shapes[Number(solidIndex)]];
}

renderViews(shapes, outPrefix, Number(sizeArg));
