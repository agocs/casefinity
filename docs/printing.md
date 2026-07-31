# Printing guide

Practical notes on getting a printable, well-fitting result: which export format
to use, how to fit an oversized frame onto your bed, how to screw the pieces
together, and what clearances to dial in.

## Choosing an export format

The generator offers **STL**, **STEP**, and **3MF**.

**STL** and **STEP** fuse a model's shapes into a single solid. **3MF** keeps them
separate: each build shape becomes its own `<object>` in the package (see
`src/three-mf.ts`), so a multi-part model — the four dovetailed perimeter pieces,
or a bin body plus its lids — imports as **individually selectable parts** on the
slicer plate. For anything that comes out as more than one piece, 3MF is the one
you want.

Geometry is the model's own Z-up space in millimetres, identical to STL, so `z=0`
sits on the plate.

Use **STEP** if you intend to modify the model in CAD — the *Solid block* model
exists specifically as stock for subtracting your own tool-holder pockets.

## Print clearances

Two parameters open up the fit, and both default to a nominal (tight) value
because the smoke tests validate against nominal ground truth:

- **Case clearance** (`clearance`, default `0`) insets the whole outer envelope.
  Real cases have draft, mould seams, and radii that a nominal envelope does not
  account for. **Try ~0.15 mm.**
- **Dovetail clearance** (`dovetailClear`, default `0.2`) grows the end-piece
  socket beyond the side-piece tang, opening a slide-fit gap. It does not affect
  the bounding box. `0.2` is usually right; increase it if the pieces bind.

Before committing to a full frame, print the **Perimeter template** — two 1 mm
cross-sections of the case wall — and check them against your actual case. It
costs a few minutes of printing instead of several hours.

Case interior dimensions for a couple of common cases are in
[case-dimensions.md](case-dimensions.md).

## Fitting the perimeter to your printer

A full-size case frame — 350 × 250 mm at the defaults — is larger than most print
beds even after the standard 4-way dovetail split.

The perimeter takes three optional parameters that solve this automatically:
**Printer bed width**, **Printer bed depth**, and **Bed margin** (per side, for
brim and adhesion). Set them and the frame auto-subdivides so that no piece
exceeds the usable area (`bed − 2·margin`). Each long rail is cut into in-line
segments and each end cap into stacked segments, with an extra dovetail seam at
every cut. The pieces still assemble into the same frame.

The bed fields default to `0`, meaning no limit, which reproduces the original
four pieces. Every export format works with subdivided output — 3MF names each
piece separately.

`splitPieces` in `src/models/perimeter.ts` is the single source of this logic, and
`npm run scaling` asserts that across bed sizes every piece is one clean solid and
fits the bed.

## Screw bosses

The dovetails join the pieces only at floor level — the tang band lies between the
cavity wall and the case wall, where the frame is just the floor slab — so a tall
assembled frame can still splay apart at the mouth.

Ticking **Screw bosses at split lines** (off by default) adds a pad either side of
every seam, at the rim on the inside of the case wall: a **clearance hole** on the
piece that carries the tang, and a concentric **thread-forming pilot hole** on its
mate. Tightening a plastic screw then pulls the tang home and closes the joint at
the top.

### Hole sizing

Hole sizes follow the [REMFORM® II brochure](https://taptite.com/assets/files/REMFORM-II-BROCHURE-CONTI-REMINC-2023.pdf)
(REMINC/CONTI, pp. 2–3): the clearance hole is the screw's **maximum major
diameter**, and the pilot hole is the **recommended hole size** — a material
factor times the minimum major diameter.

The factor defaults to **0.80**, the brochure's value for PET / PBT / PC / PS.
PETG is not listed, and PET and PC are its closest relatives. Printing something
else, use your own row from the brochure:

| Material | Factor |
|---|---|
| PP, PE, PA 6/6.6, ABS, ASA | 0.75 |
| PET, PBT, PC, PS (default) | 0.80 |
| 30% glass-filled | 0.82–0.85 |

At the M3 default that gives a **3.10 mm clearance hole** and a **2.40 mm pilot**,
in a **7.9 mm pad** — about 2.6 × nominal, heavier than the 2 × moulding rule of
thumb because the boss prints with its axis horizontal, so hoop stress at the hole
runs partly across layer lines.

### Which end takes the screw

The clearance hole's outer mouth carries a **45° × 0.5 mm lead-in chamfer**; the
pilot hole and both seam-facing ends are left sharp. Besides easing the screw in,
that is the point of it: 3.10 mm and 2.40 mm holes in a printed part are not
reliably tellable apart by eye, and the chamfered mouth is. **Drive the screw
into the funnelled hole** — it is always on the piece carrying the dovetail tang.

6 mm of engagement per side means the defaults want an **M3 × 12 thread-forming
screw for plastics** — REMFORM, Plastite, PT or similar, **not** a machine screw.

The pad's whole underside is a 45° ramp to the wall, so it prints without support.

### Three things to know before you print

- **Driver access.** The screw drives *along* the channel, so a straight driver
  run has to fit between the boss and the nearest full-height obstruction. At the
  default divider spacing that is about **57 mm** of clear channel — fine for a
  stubby driver or a ball-end key, tight for an inline bit and handle. Fewer
  **dividers per long side** gives more room. No other screw axis would cross the
  seam, so this is inherent rather than a bug.
- **Shallow cases steepen the gusset.** On a case too shallow for the full 45°
  gusset — roughly under 20 mm of depth at the M3 defaults — the ramp is clamped
  to land on the floor slab and becomes steeper than 45°, which wants support.
  Bosses are dropped entirely if the pad cannot fit between the rim and the floor,
  or across the border width.
- **Very shallow cases: the gusset clips out through the wall.** The pad's outer
  face is flat and placed where the wall runs at the *rim*, sunk 0.4 mm into it,
  while the boss feature is about `2 × pad` tall — 15.8 mm at the M3 defaults.
  Over that height the wall leans inward, by the taper and then much faster once
  the case's 19.05 mm bottom corner radius starts rolling it in, so the pad sits
  progressively deeper in the wall toward its foot and eventually breaks out
  through the far side. Measured at the defaults: nothing at 27 mm of case depth,
  **0.7 mm proud at 25 mm, 5.1 mm proud at 20 mm** — so the threshold is around
  26 mm, and such a piece would not seat in a real case anyway.

  This is **not fixed on purpose**: every real hard case is 100 mm-plus deep, and
  having the boss follow the fillet would trade a flat, drillable face for a
  curved one on geometry nobody prints. On a genuinely shallow liner, either leave
  the bosses off or shrink the pad — a smaller **Boss screw size** or **Boss
  material around hole** lowers the whole feature, and a thicker wall gives it
  more to hide in.

## Interoperability warning

**Grid bump width** is the registration interface between bins and the liner. The
generator defaults to **3 mm**, where the originals used 1.2 mm, because a 1.2 mm
rib is a single extrusion wide on a 0.4 mm nozzle.

Everything you print must agree on this one number. A part printed at 3 mm **does
not mate** with one printed at 1.2 mm. Wall and floor thickness, by contrast, are
free — they do not touch the interface. See *Intentional deviations* in
[models.md](models.md).
