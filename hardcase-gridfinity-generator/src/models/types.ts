import type { Shape3D } from "replicad";

export interface ParamDef {
  key: string;
  /** Original Fusion 360 user parameter name, for traceability */
  fusionName?: string;
  label: string;
  /** "number" (default) renders a numeric input; "text" a text input;
   *  "boolean" a checkbox. */
  type?: "number" | "text" | "boolean";
  default: number | string | boolean;
  unit?: "mm" | "deg" | "";
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Parameter values keyed by ParamDef.key. Numeric params (the vast majority)
 * hold numbers; "text" and "boolean" params hold string / number (1 or 0)
 * respectively. Kept indexed as `number` so numeric models can do arithmetic
 * on `p.key` without casts — read a text/boolean param via the helpers below.
 */
export type ParamValues = Record<string, number>;

/** Safely read a "text" parameter value (stored as a string at runtime). */
export function textParam(p: ParamValues, key: string, fallback = ""): string {
  const v = (p as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

/** Safely read a "boolean" parameter value (stored as 0 or 1). */
export function boolParam(p: ParamValues, key: string, fallback = true): boolean {
  const v = (p as Record<string, unknown>)[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return fallback;
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