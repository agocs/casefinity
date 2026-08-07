# Full-height dovetail joints on the perimeter split lines

Date: 2026-08-07
Status: approved, ready to implement
Affects: `hardcase-gridfinity-generator/src/models/perimeter.ts` (inherited by
`perimeter`, `perimeter-square-corners`, `smooth-perimeter`)
Supersedes: `2026-07-25-perimeter-screw-bosses-design.md`

## Problem

The port's dovetail joints barely exist.

The tang footprint is a trapezoid centred in the border, and the port builds it
by fusing that footprint into a piece's 2-D region and intersecting the frame.
The frame is a hollow U-channel, so the tang only materialises where the frame
happens to have material inside the tang band — and in the band, it mostly does
not.

Measured at the shipped defaults (350 × 250 × 110, `wallThick` 3): the corner
tang band sits at y ≈ 103…119 mm. At z = 0 the frame's outer footprint reaches
only y = 102.1, because `bottomCornerRadius` (19.05) pulls the wall in over the
whole bottom fillet. The tang band is outside the frame entirely below
z ≈ 19 mm, and above that it is a sliver of channel. The model doc comment
already conceded the joint "join[s] the pieces only at floor level"; the
measurement says it is thinner than that.

The screw bosses (`2026-07-25-perimeter-screw-bosses-design.md`) were added to
compensate — a fastener at each seam to stop the mouth splaying. They treat the
symptom.

## What the ground truth actually does

`ground-truth/Hardcase_Gridfinity_Perimeter.step` (Y-up; y is height) joins its
four pieces over the **full height** of the frame. Two features the port is
missing:

1. **An end bulkhead.** Each piece's end is closed by a transverse web spanning
   the entire U-channel cross-section, `WALL_THICK` (1.2 mm) thick, floor to
   rim. The channel is not open at a piece end.
2. **A full-height dovetail through that bulkhead.** The rail carries a dovetail
   tang, the cap a matching dovetail slot, both running the full height as
   straight vertical prisms.

Evidence, from `probe-joint.mjs` / `probe-xsec.mjs` against the STEP:

- Material in the rail's tang band (x 28.7…33.9) per 5 mm of height:
  ~230 mm³, constant from the floor to the rim (rising only with the wall
  taper). A plain wall section of the same footprint holds ~62 mm³. The band is
  ~3.7× a bare wall all the way up.
- XZ cross-section at mid-height (y 54…56) of the long rail: a fully-bridged
  band at x 32.6…33.8 spanning the whole border (z −27.5…−2.5) — the bulkhead —
  plus a dovetail-shaped wall structure protruding to x ≈ 28.8.
- Same cross-section of the end cap: a bulkhead at x 31.3…32.5 spanning the
  border, pierced by a dovetail-shaped mouth at z −18…−10, behind which a
  dovetail chamber widens away from the mouth (half-width ≈ 3.3 at the mouth,
  ≈ 5.2 at 3 mm depth — a ~30° flank, matching `BOARDER_DOVETAIL_ANGLE`).

The ground truth's tang and socket are thin-walled (everything in that design is
1.2 mm), which is a moulding/liner convention, not a structural one.

## Requirements

- **REQ-1** Every seam gets a full-height bulkhead: a slab filling the U-channel
  cross-section, `wallThick` thick on each side of the seam plane, from z = 0 to
  `overallHeight`, trimmed to the channel so it follows the wall taper and the
  bottom fillet. This applies to the 4 corner joints and to every interior
  bed-split seam on both rails and both caps.
- **REQ-2** The dovetail runs through the bulkhead at full height: a **solid**
  prism on the tang piece, a matching slot on the socket piece. Thin-walling the
  tang is not reproduced — at `wallThick` 3 mm a 5 mm-deep dovetail has no
  meaningful core left to hollow.
- **REQ-3** The socket piece's end web is pierced by the dovetail mouth, and the
  slot behind it is flanked by `wallThick` of material on both flanks and backed
  by `wallThick` at its far end, so the tang bottoms out against material.
- **REQ-4** The joint keeps its existing print clearance: the socket is the tang
  footprint grown by `dovetailClear` on tip and both flanks. The tang stays
  nominal.
- **REQ-5** The slot is open top and bottom, so pieces assemble by sliding
  together vertically. The dovetail constrains both in-plane axes over the full
  height. Vertical separation is deliberately unconstrained — that is the
  assembly direction.
- **REQ-6** No new parameters. The web thickness is `wallThick` (structural,
  matching the ground truth's `WALL_THICK` web); the joint keeps its existing
  `dovetailWidth` / `dovetailDepth` / `dovetailAngle` / `dovetailClear` knobs.
- **REQ-7** The screw-boss feature is removed outright: its stated justification
  ("the dovetails alone join the pieces only at floor level … so an assembled
  frame can splay at the mouth") no longer holds.
- **REQ-8** Where the bulkhead or the collar is wider than the channel, it is
  trimmed by the channel, not clamped. A dovetail wider than the border simply
  merges into the walls.

## Construction

The channel's hollow is implicit in `buildPerimeter` today; make it explicit as
a solid, once per build:

```
channel = outerLoft(wallThick, p) − cavityAt(0, wallThick, p).extrude(h)
```

`outerLoft(wallThick, p)` is already built in `buildPerimeter` as `wallInner`
(it is the wall cut's own tool), so `splitPieces` takes it as an argument rather
than rebuilding a second loft. `cavityAt(0, wallThick, p)` is the inner wall's
outer face, so the difference is exactly the open channel — taper, bottom
fillet and `clearance` all inherited.

Because that intersect trims to the channel automatically, each seam's 2-D
footprint needs only two flat pieces, and neither has to know anything about the
wall profile:

- **W** — a band spanning `[pos − wallThick, pos + wallThick]` on the seam axis,
  running the full half-plane on the off-axis. This becomes the end web on both
  pieces.
- **C** — `seamTang(axis, pos, band, dir, dovetailClear + wallThick)`: the
  socket footprint dilated by one wall thickness. This contains the tang
  footprint (so the tang piece gets a solid prism) and provides the socket
  piece's flanks and back.

Off-axis extents keep each bulkhead on the border it belongs to:

- X-axis seams (corner joints and long-rail bed splits, band at `±yc`): the
  half-plane `y ≥ 0` or `y ≤ 0` on that rail's side. The cavity subtraction
  removes the middle, so this cannot reach the opposite rail.
- Y-axis seams (end-cap bed splits, band at `±xcEnd`): `x` from `±splitX`
  outward, so a cap's bulkhead cannot land on a long rail at the same y.

Using a half-plane rather than the nominal border width matters at the corner
seams: at x = ±`splitX` the cavity's rounded corner has already turned away, so
the channel there is wider than the nominal border (≈40 mm vs 27.5 mm at the
defaults) and a nominal-width band would leave it partly open.

All seam footprints union into one drawing, extrude once, intersect the channel
once, and fuse into `frame` at the top of `splitPieces` — before any region
intersect. The existing region algebra then divides the result with no new
splitting logic:

| piece | region | gets |
|---|---|---|
| tang | `halfplane ∪ tangFootprint` | end web + solid dovetail prism |
| socket | `halfplane − grownTang` | end web with a dovetail mouth + flanks + back |

Ordering is unchanged: bulkheads fuse into `frame`, then `splitPieces` clips per
piece, then dividers, then grid features last (so a groove cut still wins).

### Interactions

- **Dividers.** A divider rib that lands at a seam merges with the bulkhead.
  Harmless — they are the same kind of object.
- **Grid grooves.** The bulkhead starts at the inner wall's outer face, so a
  groove cut `gridBump` deep from the cavity face does not reach it whenever
  `wallThick ≥ gridBump`. A thin-wall backing boss protrudes into the channel
  and merges with the bulkhead; also harmless.
- **Floor slab.** The channel solid spans z = 0 upward, so the bulkhead overlaps
  the floor. Fused, not cut.
- **Near the floor.** Below the bottom fillet the channel narrows to nothing, so
  the bulkhead and the tang are trimmed away there. Inherent to the case's
  rounded bottom; the joint still engages over ~90 mm of the 110 mm height at
  the defaults.

## Removals

From `perimeter.ts`: `MAJOR_DIA_MAX`, `majorDiaMax`, `BossDims`, `bossDims`,
`BossSeam`, `bossHalf`, `addBosses`, `wallFaceMag` (used only by the bosses),
the per-seam boss plumbing in `splitPieces` (`bd`, `segLenLong`, `segLenEnd`,
`flatRun`, `seamLen`, `longSeamLen`, `endSeamLen`, `capCutsClearPad`,
`cornerLen`, `cornerSeg`), the params `bosses` / `bossScrewDia` /
`bossHoleFactor` / `bossLen` / `bossWall`, and the boss paragraphs of the model
doc comment.

From `perimeter.ts`, `perimeter-square-corners.ts`, `smooth-perimeter.ts`: the
"Screw bosses" form group.

From `scripts/smoke.mjs`: the screw-boss block.

The superseded spec stays in place as history, with a pointer to this one.

## Verification

- `npm run smoke` — bboxes unchanged on all three perimeter variants (the
  bulkhead lives inside the existing envelope). `perimeter-square-corners`'s
  self-derived volume rises and is re-pinned.
- A new smoke block replacing the boss block: build the perimeter split,
  assert 4 pieces each one clean solid, and probe the corner tang band at mid
  height and near the rim to assert material on **both** sides of the seam
  plane — the check that would have failed before this change.
- `node scripts/diff-model.mjs perimeter ground-truth/Hardcase_Gridfinity_Perimeter.step`
  at the ground truth's own thicknesses, to confirm the joint moves toward the
  reference rather than away from it.
- `npm run scaling perimeter` — heavy bed-split configurations add a bulkhead
  per seam, so confirm the WASM heap still holds.
- `npm run build` — type check.

## Docs

- `docs/models.md` — perimeter row and form layout (drop the Screw bosses
  group), and the joint description.
- `docs/printing.md` — replace the screw-boss section with the vertical-assembly
  instruction; update the dovetail-clearance note.
- `docs/reverse-engineering.md` — record the full-height joint under the
  perimeter's recovered geometry, with the measurements above.
- `docs/casefinity-spec.md` — NOTE-8.5 currently says only that the liner
  perimeter is split into bed-fitting dovetail pieces; extend it to describe the
  full-height joint, and rebuild `public/casefinity-spec.html`.
- `hardcase-gridfinity-generator/README.md` — drop the screw bosses from "Known
  limitations" (the shallow-case pad break-out caveat goes with them).
