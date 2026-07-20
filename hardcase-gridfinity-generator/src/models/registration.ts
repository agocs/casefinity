import type { ParamDef, ParamValues } from "./types.ts";

/**
 * The Casefinity registration interface — the single source of truth for the
 * dimensions that make independently designed parts interoperate (spec §2 and
 * §4: INV-1, INV-2, REQ-4.1, REQ-4.4). Bins (`bin-common.ts`) and the liner
 * (`perimeter.ts`) derive every rib/slot/boss width and every feature centre
 * from here, so a change to the interface is made in one place. WALL_THICK
 * deliberately enters only through the REQ-4.4 boss rule — never a mating
 * width (INV-2).
 */

/** The interface constant `w` (spec §2): the width of every male rib and the
 * basis of every female slot width. Shared by all bin variants and the liner.
 * No Fusion name: the originals drove this off WALL_THICK (numerically equal
 * at 1.2 mm); the generator freezes it as its own interface constant. */
export const ribWidthParam: ParamDef = { key: "ribWidth", label: "Rib width", default: 1.2, unit: "mm", min: 0.6, max: 3, step: 0.1 };

/** x/y offsets of module centres, e.g. 3 modules @ 15 → [-15, 0, 15]. Both
 * families centre their features here (REQ-3.4), which is why bin ribs and
 * liner grid bumps coincide when a bin sits on-grid. */
export function moduleCenters(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
}

/** Module centres along a liner cavity span given in mm — the span is always a
 * whole number of modules (INV-7), so this is exactly `moduleCenters`. */
export function gridCenters(span: number, spacing: number): number[] {
  return moduleCenters(Math.round(span / spacing), spacing);
}

/** The §4 interlock dimensions. `bump` is the proud/deep height `b`
 * (WALL_BUMP on bins, GRID_BUMP on the liner — the same interface value,
 * INV-1). */
export interface InterlockDims {
  /** Male rib width `w` (INV-1). */
  ribWidth: number;
  /** Locating female slot width `w + 2c` — the bin socket (REQ-4.1). */
  socketWidth: number;
  /** Relief female slot width, line-to-line `w` — the liner groove (REQ-4.2). */
  grooveWidth: number;
  /** Backing boss width behind a bin socket: `socket + 2w`. */
  binBossWidth: number;
  /** Backing boss width behind a liner groove: `3w`. */
  linerBossWidth: number;
  /** REQ-4.4: a female slot needs a backing boss only while the wall is
   * thinner than `2b` (the slot would sever it, or leave under `b` behind
   * it); a thicker wall swallows the slot as a plain blind pocket. */
  needBoss: boolean;
}

export function interlockDims(p: ParamValues, bump: number): InterlockDims {
  const rw = p.ribWidth;
  const socketWidth = rw + 2 * (p.clear ?? 0);
  return {
    ribWidth: rw,
    socketWidth,
    grooveWidth: rw,
    binBossWidth: socketWidth + 2 * rw,
    linerBossWidth: 3 * rw,
    needBoss: p.wallThick < 2 * bump,
  };
}
