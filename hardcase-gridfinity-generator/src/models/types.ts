import type { Shape3D } from "replicad";

export interface ParamDef {
  key: string;
  /** Original Fusion 360 user parameter name, for traceability */
  fusionName?: string;
  label: string;
  /** "number" (default) renders a numeric input; "text" a free-text input. */
  type?: "number" | "text";
  default: number | string;
  unit?: "mm" | "deg" | "";
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Parameter values keyed by ParamDef.key. Numeric params (the vast majority)
 * hold numbers; a "text" param holds a string. Kept indexed as `number` so the
 * numeric models can do arithmetic on `p.key` without casts — read a text
 * param's value via `textParam(p, key)`.
 */
export type ParamValues = Record<string, number>;

/** Safely read a "text" parameter value (stored as a string at runtime). */
export function textParam(p: ParamValues, key: string, fallback = ""): string {
  const v = (p as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

export interface ModelDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  build(p: ParamValues): Shape3D | Shape3D[];
}

export function defaultValues(model: ModelDef): ParamValues {
  return Object.fromEntries(
    model.params.map((p) => [p.key, p.default]),
  ) as unknown as ParamValues;
}
