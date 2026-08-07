# Folded dovetail tang, and an honest dovetail angle

Date: 2026-08-07
Status: approved, ready to implement
Affects: `hardcase-gridfinity-generator/src/models/perimeter.ts` (inherited by
`perimeter`, `perimeter-square-corners`, `smooth-perimeter`)
Amends: `2026-08-07-full-height-dovetails-design.md` (REQ-2)

## Problem

Two defects in the split perimeter's dovetail joint, both in `seamTang`.

### 1. The tang is a solid slug that ignores `wallThick`

`seamTang` builds the tang footprint at nominal size and the piece region
materialises it as `region ∪ tangFootprint`, so the tang is a solid prism.
`wallThick` enters only the *collar* (`seamTang(..., dovetailClear +
wallThick)`), which shapes the socket's flanks. The tang itself never changes.

Measured on the shipped `perimeter` defaults, seam at x = 142.5, horizontal
section at mid-height, area per 1 mm of x:

| x | 143 | 144 | 145 | 146 | 147 |
|---|---|---|---|---|---|
| `wallThick` 1.2 | 12.47 | 13.30 | 14.12 | 14.95 | 7.78 |
| `wallThick` 3.0 | 12.47 | 13.30 | 14.12 | 14.95 | 7.78 |

Identical, and each value is the full nominal trapezoid width at that x — the
tang is solid at both thicknesses. At `wallThick` 1.2 that is a
110 × ~14 × 5 mm solid slug (~6.9 cm³ before the bottom fillet trims it) hanging
off a 1.2 mm ribbon, four times over.

`2026-08-07-full-height-dovetails-design.md` REQ-2 chose this deliberately:
"Thin-walling the tang is not reproduced — at `wallThick` 3 mm a 5 mm-deep
dovetail has no meaningful core left to hollow." That reasoning holds at 3 mm
and fails at 1.2 mm, and the model lets the user set 0.4 mm.

### 2. The flank angle is not `dovetailAngle`

`seamTang`'s trapezoid runs from `pos − 2` (the base overlap that avoids a
coincident-face sliver) to `pos + depth`, but flares by only
`depth · tan(dovetailAngle)` over that whole run. The resulting flank is
`atan(depth · tan(A) / (depth + 2))` — 22.4° at the defaults, not 30°. Tang and
socket share the shape so they still mate, but the parameter does not mean what
it says, and `dovetailWidth` is not the width anywhere in particular (11.65 mm
at the seam plane, not 10).

## What the ground truth does

`ground-truth/Hardcase_Gridfinity_Perimeter.step` (Y-up; y is height, 4 solids:
rails at x 28.79…321.21, caps at x 0…32.51 and 315.99…350.02). Horizontal
section at mid-height (y 55…56), material per 1 mm of x:

| x | 28 | 29 | 30 | 31 | 32 | 33 | 34–38 |
|---|---|---|---|---|---|---|---|
| rail | 1.98 | 9.19 | 2.77 | 2.77 | 10.86 | 19.42 | 2.40 |
| cap | 10.60 | 5.11 | 7.63 | 22.58 | 15.11 | 0 | 0 |

Reading the rail: the bulkhead is the band at x ≈ 32.6…33.8 (1.2 mm thick across
the ~25 mm border ⇒ ~25 mm²/mm, matching 19.42 over 0.8 mm and 10.86 over
0.4 mm). The tang region divides into a tip face at x 28.79…29.99 — 9.19 mm²/mm,
i.e. a 1.2 mm end wall about 7.7 mm wide — and, behind it at x 30…32.6, just
2.77 mm²/mm: two 1.2 mm flanks and nothing between them, against 2.40 mm²/mm for
the plain U-channel further along (its two walls). **The tang is hollow**: the
bulkhead sheet folds out into a dovetail outline and folds back, and the void is
closed behind by the bulkhead itself. Rendering the section confirms it, and it
matches the photograph of a printed reference piece: one continuous ribbon of
wall, no solid dovetail anywhere in the design.

The cap's socket is the same fold inward, which the port already reproduces —
the collar gives the socket `wallThick` flanks and a `wallThick` back, measured
at 6.5 mm²/mm of flank at `wallThick` 3 and 2.4 at 1.2.

## Requirements

- **REQ-1** The tang is a fold of thickness `wallThick`, not a solid prism: its
  footprint is eroded by `wallThick` and the core removed, leaving flanks, a tip
  and a back wall each one wall thick.
- **REQ-2** The fold's back wall is the seam's own end web, so the joint keeps a
  single continuous `wallThick` bulkhead rather than gaining a second skin.
- **REQ-3** The fold is closed at the bottom by the frame's floor and open at
  the top, so it prints without support and assembles by sliding down — the
  existing assembly direction is unchanged.
- **REQ-4** Where the erosion degenerates the tang stays solid, with no special
  case in the caller and no new parameter. This is what makes the shipped 3 mm
  default behave sensibly: the core is ~8.5 mm² there and vanishes entirely for
  a thick enough wall.
- **REQ-5** The flank makes exactly `dovetailAngle` with the seam axis, and
  `dovetailWidth` is exactly the tang's width **at the seam plane**. The base
  overlap no longer participates in the flare.
- **REQ-6** The tip half-width is unchanged at `w/2 + depth · tan(A)`, so the
  tang's reach, the socket's depth and every model bounding box stay put.
- **REQ-7** `dovetailClear` becomes a true perpendicular gap: the socket
  profile is the tang profile offset normal to each face, not widened across the
  band.
- **REQ-8** No new parameters. Corner joints and bed-split seams get the same
  treatment through the same helper.

## Construction

### The profile

Replace `seamTang`'s trapezoid with a hexagon, `seamProfile(axis, pos, band,
dir, d = 0)`, where `d` is a signed perpendicular offset (0 = the nominal tang,
`+dovetailClear` = the socket, `+dovetailClear + wallThick` = the collar):

```
A    = dovetailAngle           tanA = tan(A)   secA = 1 / cos(A)
ov   = 2                       (existing base overlap, unchanged)
hwB  = w/2 + d * secA          half-width behind and at the seam plane
a1   = pos + dir * (depth + d) tip face
hwT  = hwB + (depth + d) * tanA
a0   = pos - dir * ov          base face
```

with vertices, in `(a, b)` seam-local coordinates:

```
(a0, band − hwB) → (a0, band + hwB) → (pos, band + hwB)
                 → (a1, band + hwT) → (a1, band − hwT) → (pos, band − hwB)
```

Behind the seam plane the profile is a constant-width rectangle; ahead of it,
the flank rises at `tanA`. Offsetting a flank normal to itself by `d` moves it
`d · secA` in the band direction, and the tip face by `d` along the axis —
hence the two different multipliers. The base face `a0` is *not* offset by `d`:
it sits inside the owning piece, where it exists only to keep the fuse off a
coincident face, and moving it would serve nothing. At the defaults this takes
the flank from 22.4° to 30°, the neck from 11.65 mm to 10.00 mm, and leaves the
tip at 15.77 mm.

### The fold

The core is the same shape eroded by `wallThick`, with its base face **on the
seam plane** rather than at `a0` — the piece's end web occupies
`[pos − wallThick, pos]` and must survive as the fold's back wall (REQ-2):

```
hwB_core = w/2 − wallThick * secA
a1_core  = pos + dir * (depth − wallThick)
hwT_core = hwB_core + (depth − wallThick) * tanA
```

a plain trapezoid from `(pos, band ± hwB_core)` to `(a1_core, band ± hwT_core)`.
Skip the seam's core when `depth − wallThick < 0.05` or `hwB_core < 0.05` —
that is REQ-4's degeneracy, and the tang comes out solid with no branch in the
caller.

### Where the cut lands

`splitPieces` today builds the seam bulkheads and fuses them straight into the
frame:

```
joined = frame.fuse(channelSolid(p, wallInner, footprint))
```

Cut the cores out of the bulkheads *before* that fuse:

```
bulkheads = channelSolid(p, wallInner, footprint)
joined    = frame.fuse(cores ? bulkheads.cut(solid(cores)) : bulkheads)
```

Three things follow for free:

- The floor lives in `frame` and is fused after the cut, so it closes the fold
  at the bottom (REQ-3).
- `channelSolid` returns strictly the hollow between the two walls, so the cut
  cannot reach the frame's own walls.
- The socket piece's region already subtracts the clearance-grown tang, so it
  never owned the material being removed. No per-piece logic changes.

All cores union into one drawing and extrude once, mirroring how the seam
footprints are already handled.

### Callers

`seamTang` → `seamProfile` at every existing call site, with `grow` renamed to
the signed offset `d`; the values passed are unchanged (`0` for the nominal
tang, `c` for a socket cut, `c + wb` for the collar). `sliceSegments`,
`longSegments` and `endSegments` need no other edits.

### Interactions

- **Dividers.** Fused per piece after the joint is built. A divider at a grid
  centre near a seam can locally refill the fold. Structurally harmless — it is
  wall meeting wall — but confirm it does not close the fold outright at the
  defaults, where `splitX` is a module boundary.
- **Grid grooves.** Cut `gridBump` deep from the cavity face, so they do not
  reach the fold whenever `wallThick ≥ gridBump`. Unchanged by this work.
- **Near the floor.** The channel narrows to nothing below the bottom fillet, so
  bulkhead, tang and fold are all trimmed away there, as before.
- **Material.** At `wallThick` 1.2 the core is ~35.8 mm² of section, ~3.9 cm³
  per corner seam before fillet trimming; at 3 mm it is ~8.5 mm², ~0.9 cm³.

## Verification

- `npm run smoke` — `perimeter` and `smooth-perimeter` bboxes unchanged (REQ-6;
  the fold removes interior material and the tip does not move).
  `perimeter-square-corners` carries a self-derived volume that falls and is
  re-pinned.
- A section probe at `wallThick` 1.2 and 3.0 asserting the tang's per-mm section
  area now *differs* between the two — the exact check that fails today — and
  that at 1.2 mm it is close to two flanks plus a tip rather than the solid
  trapezoid width.
- A flank-angle probe: tang half-width at the seam plane is `dovetailWidth / 2`,
  and at the tip `w/2 + depth · tan(dovetailAngle)` (REQ-5, REQ-6).
- Degeneracy: build at a `wallThick` large enough to collapse the core and
  assert the tang comes out solid and the build does not throw (REQ-4).
- `node scripts/diff-model.mjs perimeter ground-truth/Hardcase_Gridfinity_Perimeter.step`
  at the ground truth's own thicknesses — the joint should move toward the
  reference.
- `npm run scaling perimeter` — one extra boolean per seam; confirm the WASM
  heap still holds on heavy bed splits.
- `npm run build` — type check.

## Docs

- `perimeter.ts` model doc comment — the joint paragraph currently says "solid
  tang on one piece"; replace with the fold, and note that it degrades to solid
  at thick walls.
- `docs/models.md` — the perimeter joint description.
- `docs/printing.md` — `dovetailWidth` now means the width at the seam plane and
  `dovetailAngle` is the true flank angle; the tang is hollow, so a seam costs
  materially less filament.
- `docs/reverse-engineering.md` — record the ground-truth folded-tang
  measurements above under the perimeter's recovered geometry.
- `2026-08-07-full-height-dovetails-design.md` — a pointer noting REQ-2 is
  amended here.
