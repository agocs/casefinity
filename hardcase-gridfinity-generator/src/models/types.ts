import type { Shape3D } from "replicad";

export interface ParamDef {
  key: string;
  /** Original Fusion 360 user parameter name, for traceability */
  fusionName?: string;
  label: string;
  default: number;
  unit?: "mm" | "deg" | "";
  min?: number;
  max?: number;
  step?: number;
}

export type ParamValues = Record<string, number>;

export interface ModelDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  build(p: ParamValues): Shape3D | Shape3D[];
}

export function defaultValues(model: ModelDef): ParamValues {
  return Object.fromEntries(model.params.map((p) => [p.key, p.default]));
}
