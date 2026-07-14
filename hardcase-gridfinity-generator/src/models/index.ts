import type { ModelDef } from "./types.ts";
import { perimeter } from "./perimeter.ts";
import { smoothPerimeter } from "./smooth-perimeter.ts";
import { binNoLid } from "./bin-no-lid.ts";
import { binWithLid } from "./bin-with-lid.ts";
import { binDoubleSided } from "./bin-double-sided.ts";
import { perimeterTemplate } from "./perimeter-template.ts";

export const models: ModelDef[] = [perimeter, smoothPerimeter, binNoLid, binWithLid, binDoubleSided, perimeterTemplate];

export function modelById(id: string): ModelDef {
  const model = models.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
}

export type { ModelDef, ParamDef, ParamValues } from "./types.ts";
export { defaultValues } from "./types.ts";
