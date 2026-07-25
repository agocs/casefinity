# Screw bosses at perimeter split lines

Date: 2026-07-25
Status: approved, ready to implement
Affects: `hardcase-gridfinity-generator/src/models/perimeter.ts` (inherited by
`perimeter`, `perimeter-square-corners`, `smooth-perimeter`)

## Problem

A split perimeter liner is held together only by the dovetail joints, and those
joints live at floor level: the tang footprint is a trapezoid in the border
centre, where the frame has material only in the floor slab (the walls are at
the cavity boundary and at the case wall, both outside the tang band). So the
top of an assembled frame has nothing joining one piece to the next — the pieces
can splay apart at the mouth, which is exactly where a loaded bin pushes them.

Give the user a place to put a screw: a boss on each side of every split line,
near the top, so pieces can be fastened with plastic-forming screws.

## Requirements

- REQ-1 A boss pair at every dovetail seam: the 4 corner joints (long rail ↔ end
  cap) and every interior bed-split seam, on both long rails and both end caps.
- REQ-2 Bosses sit on the inside face of the **outer** (case) wall, near the top,
  inside the U-channel. The screw axis is horizontal, parallel to that wall, and
  crosses the seam plane, so tightening pulls the two pieces together.
- REQ-3 One side of each seam carries a **clearance** hole sized to the screw's
  **maximum major diameter**; the other carries a **pilot** hole at the
  brochure's **recommended hole size**, concentric with the clearance hole.
- REQ-4 The boss's underside is a 45° ramp to the wall (integral gusset) so the
  feature is printable in the modelled orientation with no support.
- REQ-5 Sized for FDM PETG, not for injection moulding: heavier wall around the
  hole than the moulding rule of thumb.
- REQ-6 Off by default; opt-in via a parameter, so existing geometry and the
  smoke-test expectations are untouched when it is off.
- REQ-7 Boss-off builds must be geometrically identical to today's output.

## Hole sizing (source: REMFORM® II brochure, REMINC/CONTI 2023, pp. 2–3)

Page 2, metric series — major diameter max/min per nominal size. Minimum major
diameter equals the nominal size for every listed metric size; the maximum is
nominal + 0.10 up to 4.5 mm and nominal + 0.15 from 5.0 mm up:

| Size | 1.0 | 1.2 | 1.4 | 1.6 | 1.8 | 2.0 | 2.2 | 2.5 | 3.0 | 3.5 | 4.0 | 4.5 | 5.0 | 6.0 | 7.0 | 8.0 | 9.0 | 10.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Major max | 1.07 | 1.27 | 1.47 | 1.70 | 1.90 | 2.10 | 2.30 | 2.60 | 3.10 | 3.60 | 4.10 | 4.60 | 5.15 | 6.15 | 7.15 | 8.15 | 9.15 | 10.15 |

Page 3, recommended hole sizes — "derived by multiplying the minimum screw
diameter by the factor listed": 0.75 for PP, PE, PA 6/6.6, ABS, ASA, ABS/PC;
**0.80 for PVC rigid, SAN, PS, PBT, PET, PC, PPO, PET 30 % GF**; 0.82 for
PC/PPO 30 % GF; 0.85 for PA 6 and PBT 30 % GF.

PETG is not listed. Its closest listed relatives are PET and PC, both **0.80**,
so 0.80 is the default factor — exposed as a parameter so a user printing PP/ABS
(0.75) or a glass-filled filament (0.85) can follow their own row.

At the M3 default: pilot = 0.80 × 3.00 = **2.40 mm**, clearance = **3.10 mm**.

The brochure gives no boss OD or engagement-depth guidance, so those come from
FDM practice (below), not from the source.

## Geometry

Local frame per seam: `u` = along the wall (the seam axis: X on a long rail, Y on
an end cap), `v` = normal to the wall, positive inward toward the cavity, `z` =
height. `F(z)` = the outer wall's inner-face coordinate at height z — the same
surface `outerAt(z, wallThick, p)` produces, i.e. tapered by the wall draft,
pulled in by the bottom fillet, and shifted by `clearance` (the existing
`outerInnerY` omits the clearance term, which is harmless for dividers but not
for a boss, so the boss uses its own corrected helper for both axes).

Pad cross-section in the (v, z) plane, a quadrilateral:

```
        v=0 (wall face)      v = pad
 zTop ── ┌────────────────────┐        pad  = clearDia + 2*bossWall
         │                    │        zTop = overallHeight (flush with the rim)
         │        (O)         │        hole axis at zTop - pad/2, v = pad/2
         │                    │
 zTop-pad└──────────────────  ┘
         │                 ╱           45° ramp, run = pad, so the ramp's
         │            ╱                foot is at zTop - 2*pad
         │       ╱
 zTop-2p ┴──╱
```

- Pad depth = pad height = `clearDia + 2*bossWall` (square section, uniform
  material all round the larger of the two holes). At M3 defaults:
  3.10 + 4.8 = **7.9 mm**, ≈ 2.6 × nominal. Injection-moulding practice is
  2 × nominal; FDM PETG gets more because the boss is printed with its axis
  horizontal, so hoop stress at the hole runs partly across layer lines, which is
  the weak axis. Material above the hole = `bossWall` = 2.4 mm.
- Pad length along `u` = `bossLen` per side, default **6 mm** = 2 × nominal, the
  usual minimum thread engagement for a thread-forming screw in plastic. Both
  sides get the same length, so the defaults call for an **M3 × 12** screw.
- The pad's outer edge is placed at `F(zTop) + embed` with
  `embed = min(0.4, wallThick/2)`, so it always bites into the wall (never a
  tangent-face boolean) and never breaks through the outer surface. Because the
  wall tapers, `F` is smaller lower down, so the pad is embedded *more* toward
  its base — always overlapping, never floating.
- Both holes are through holes, cut over the pad's full length; the diameter
  steps at the seam plane. No blind pocket to bridge, no boolean debris.
- The clearance hole goes on the **tang side** of the seam (the long rail at a
  corner joint; the lower-`u` segment at an interior seam, matching
  `sliceSegments`' "left segment gets the tang" convention), so the head bears on
  the tang piece and tightening seats the tang in its socket.
- Shallow cases: if `zTop - 2*pad` would fall below the floor slab, the ramp run
  is clamped so the foot lands at `footThick`. The pad itself is never shrunk;
  the ramp only gets steeper than 45° in cases too shallow to hold the full run,
  and that is documented in the model doc comment.

## Construction

Bosses are fused **per piece, after slicing**, never as a straddling solid that
the split later divides. A wide `dovetailWidth` can push the tang footprint out
as far as the case wall, and a boss caught in that footprint would be handed to
the wrong piece and eaten into by the socket's clearance growth. Building each
half against its own piece removes that whole failure mode.

Two placements in `splitPieces`:

- **Corner seams** — fused onto the full rail / cap before it is sliced, since
  they sit at the extreme ends of a rail (first and last segment own them) and
  `bossLen` never reaches a bed cut. Rail gets the clearance half at both ends;
  each cap gets the pilot half.
- **Interior seams** — fused inside `sliceSegments`: segment *i* gets the
  clearance half at its far seam (it owns the tang there) and the pilot half at
  its near seam.

A divider falling inside a boss's span simply merges with it and the hole drills
through; that is extra material, not a defect, so no special handling.

## Parameters

New, appended to `perimeterParams`, in a new collapsed "Screw bosses" group; all
three perimeter variants inherit them (`perimeter-template` has its own param
list and is unaffected).

| key | label | default | range |
|---|---|---|---|
| `bosses` | Screw bosses at split lines | 0 | 0–1 |
| `bossScrewDia` | Screw size (nominal dia) | 3 | 2–6, step 0.5 |
| `bossHoleFactor` | Pilot hole factor (× screw dia) | 0.80 | 0.70–0.90, step 0.01 |
| `bossLen` | Boss length (each side of seam) | 6 | 2–20, step 0.5 |
| `bossWall` | Boss material around hole | 2.4 | 1–6, step 0.2 |

`bosses` has no effect when `split` is 0 (an unsplit frame has no seam), which
the parameter label states.

## Known limitation

The screw drives *along* the channel, so a straight driver run has to fit between
the boss and the nearest full-height obstruction. At default divider spacing that
is ≈57 mm of clear channel — fine for a stubby driver or a ball-end key, tight
for an inline bit and handle. Documented in the model doc comment and the README;
not designed around, because any other screw axis would not cross the seam plane.

## Verification

- REQ-7: build every perimeter variant with `bosses: 0` and confirm the output is
  identical to `main`'s (piece count, per-piece volume and bbox).
- Boss-on build: piece count unchanged, one clean solid per piece (no debris,
  same check the split already relies on), total volume increased by
  approximately the analytically computed pad volume × seam count.
- `npm run smoke` unchanged (feature off by default).
- `render-mesh.mjs` images of a boss-on piece for visual review.
