# Model catalog

Every model, what it is, how closely it matches the original design, and the
parameters its form exposes.

Six of the eight are ports of original Fusion 360 designs and are measured
against STEP ground truth. Two — *Perimeter (square corners)* and *Solid block* —
are new designs with no original to compare against; their smoke tests lock
self-derived values instead.

| Model | ID | Fidelity vs ground truth |
|---|---|---|
| Perimeter (frame) | `perimeter` | bbox exact at nominal; geometry measured at the original 1.2 mm wall / 1 mm floor |
| Smooth Perimeter | `smooth-perimeter` | bbox exact; same foot and divider simplifications as the perimeter |
| Perimeter (square corners, beta) | `perimeter-square-corners` | no ground truth — new design |
| Bin (no lid) | `bin-no-lid` | volume within 0.02% |
| Bin with lid | `bin-with-lid` | body within 0.014%, lid within 0.03%, total 0.09% |
| Bin (double sided) | `bin-double-sided` | bbox exact; total within 0.03% |
| Perimeter template | `perimeter-template` | bbox exact; per-slice volume within ~1% |
| Solid block | `solid-block` | no ground truth — derived from `bin-no-lid` |

All eight pass `npm run smoke`.

## The perimeter family

Three variants share one build and one parameter set (`perimeterParams` in
`src/models/perimeter.ts`), so the form below is identical for all three.

**Perimeter (frame)** — the flagship. A U-channel border around a central cavity,
with grid bumps, a dovetail split into 4 pieces (or auto-subdivided further to fit
a printer bed), optional screw bosses at every seam, configurable dividers, the
case bottom-radius, and print clearances. Prints as dovetailed pieces that seat in
the case. Fidelity is measured at the original 1.2 mm wall / 1 mm floor — the
shipped defaults are deliberately heavier, see *Intentional deviations* below.
It is the slowest model to build (~14 s).

**Smooth Perimeter (gridfinity interior)** — the same build at a 42 mm grid with
bumps off, matching the original smooth variant.

**Perimeter (square corners, beta)** — not a port. Reuses the perimeter build with
a **squared** rather than rounded cavity corner, so a bin can occupy the
corner-most grid cell flush. The outer wall is unchanged, so it still fits the
case's rounded corner and bottom. No such variant exists in the originals, so
there is no ground truth; smoke locks a self-derived bbox of 350 × 250 × 110 and
a volume of 757,113 at the 3 mm wall / 4 mm floor / 3 mm grid-bump defaults
(including the near-floor wall thickening — see "Extend FLOOR_THICK" in
`perimeter.ts`), and `npm run scaling perimeter-square-corners` guards the
squared-corner invariant.

### Form layout

**Basic dimensions** (expanded) — Case length, Case width, Case depth, Wall
thickness, Floor thickness.

**Advanced dimensions** (collapsed) — Bottom corner radius, Cavity corner radius,
Side wall taper, Front wall taper, Case clearance.

**Interior features** (collapsed) — Side border bins, Front border bins, Dividers
per long side.

**Module features** (collapsed) — Grid spacing, Grid bump, Grid bump width.

**Printer convenience** (expanded) — Split into pieces, Printer bed width
(0 = no limit), Printer bed depth (0 = no limit), Bed margin (per side), and a
*Dovetails* subsection: Dovetail width, Dovetail depth, Dovetail angle, Dovetail
clearance.

**Screw bosses** (collapsed) — Screw bosses at split lines (needs split), Boss
screw size (nominal dia), Pilot hole factor (× min screw dia), Boss length (each
side of seam), Boss material around hole.

See [printing.md](printing.md) for what the bed, dovetail, and screw-boss
parameters actually do to the printed result.

## The bins

All bins share `bin-common.ts` (`buildBinBody`, `binParams`, `box`,
`moduleCenters`) and the same **Module features** group (collapsed): Grid
spacing, Grid bump width, Rib depth. They all share these **Basic dimensions**
(expanded): Width (modules), Length (modules), Height, Wall thickness, Floor
thickness, Clearance, Pull tab height, Pull slot length, Pull slot height.

### Bin (no lid)

Complete; volume within 0.02% of ground truth. No parameters beyond the shared
set.

### Bin with lid

Complete. The plate sits flush with the rim, with a half-round rail bead on each
edge — running in a wall groove on −X and on a continuous rail ledge on +X — the
interference lock over the last `LID_LOCK_LENGTH`, a finger-pull scoop,
socket notches on the entry edge, and a configurable engraving.

Body within 0.014%, lid within 0.03% (excluding the engraving, which uses a
different font); total 33,754 vs ground truth 33,722, or 0.09%. `npm run smoke`
asserts the retention features directly — see *With-lid retention* in
[reverse-engineering.md](reverse-engineering.md) for why that matters.

Adds **Lid label** to Basic dimensions, and an **Advanced dimensions** group
(collapsed): Lid thickness, Lid clearance, Lid lock grip, Lid lock length, Lid
rail radius, Finger lip width, Finger scoop length.

### Bin (double sided)

Complete — an open tube with a central floor, a concave hopper fillet, interlock
ribs, a pull tab, and 2 chamfered lids. bbox exact; body 68.3k vs 68.2k, total
(body + 2 lids) 87.3k vs 87.4k, or 0.03%.

Adds **Hopper fillet inset** to Basic dimensions.

### Solid block

The Bin (no lid) body with the interior cavity left uncut
(`buildBinBody(p, true)`). Keeps the footprint, the interlock ribs and sockets,
and the pull tab — stock for subtracting your own tool-holder pockets in CAD.

Not an original design, so there is no ground truth; smoke locks a self-derived
bbox of 46.3 × 46.3 × 115 and a volume of 220,848. Shared parameters only.

## Perimeter template

Two 1 mm test slices of the case wall — one across the width, one across the
length — each a closed frame (rounded floor, tapered walls, top cap). Print these
first to check the fit against your actual case before committing to a full
frame. bbox exact; per-slice volume within ~1%.

**Basic dimensions** (expanded) — Case length, Case width, Case depth, Wall
thickness, Slice thickness.

**Advanced dimensions** (collapsed) — Bottom corner radius, Side wall taper,
Front wall taper.

**Printer convenience** (expanded) — Generate Length Template, Generate Width
Template.

## Intentional deviations from the originals

The ports reproduce the original geometry, but a few **defaults** are set richer
than the Fusion 360 originals on purpose. The generated parts are meant to be
printed and used standalone, not to round-trip the source file.

### Perimeter wall and floor thickness

The originals use a **1.2 mm wall** and a **1 mm floor** — a thin liner glued
into a rigid case. The generator defaults to a **3 mm wall** and **4 mm floor**
so the frame is self-supporting and prints robustly on its own. This applies to
every perimeter variant, since they share `perimeterParams`. Set them back to
1.2 / 1 mm to reproduce the source geometry.

The fidelity figures above are measured at the original thicknesses; the shipped
defaults deliberately enclose more material — which is why the square-corners
smoke volume is locked at the 3/4 mm defaults.

### Grid bump width

The originals make every rib, socket, and groove **1.2 mm** wide (`RIB_WIDTH`,
exposed as **Grid bump width** under *Module features*). At that size a rib is a
single extrusion wide on a 0.4 mm nozzle — fragile — and the matching slot is a
single-pass gap, so the generator defaults to **3 mm**.

The parameter is capped at 4.5 mm: a socket's backing boss is `3w + 2c` wide and
sits on the outermost module centre, so above ~4.87 mm it overhangs the footprint
and bins stop tiling at the 15 mm pitch.

### What this means for interoperability

Wall and floor thickness do **not** touch the registration interface — rib and
socket widths, grid pitch, and bumps all derive from `RIB_WIDTH` / `GRID_BUMP`,
never `WALL_THICK` (see `src/models/registration.ts`). Parts built at either
thickness still interlock.

Grid bump width **is** that interface. Bins and the liner read the one parameter,
so they agree at any setting, but **a part printed at 3 mm does not mate with one
printed at the original 1.2 mm.** Pick one and stay with it.

`npm run smoke` therefore pins `ribWidth: 1.2` for the models whose expected
volumes come from the STEP ground truth, so those remain true fidelity
measurements.

## Known limitations

- **Screw-boss gussets clip out through the wall on very shallow cases** —
  around 26 mm of case depth and below at the M3 defaults (0.7 mm proud at 25 mm,
  5.1 mm at 20 mm), because the boss feature is taller than the clean run between
  the rim and the case's bottom corner radius. Accepted rather than fixed; see
  *Screw bosses* in [printing.md](printing.md) for the mechanism and the ways
  around it.
- The perimeter's foot is a flat floor rather than the original's gusseted ramp,
  and its dividers are evenly spaced rather than cloning the original's ad-hoc
  per-edge layout. Both are deliberate simplifications.
- The double-sided bin's hopper fillet is approximated with a loft cut, which
  accounts for its ~0.3% volume difference.
