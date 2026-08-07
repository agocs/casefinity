# Printing guide

Practical notes on getting a printable, well-fitting result: which export format
to use, how to fit an oversized frame onto your bed, how the pieces join, and
what clearances to dial in.

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
- **Dovetail clearance** (`dovetailClear`, default `0.2`) opens a slide-fit
  gap between the side-piece tang and the end-piece socket, measured
  **perpendicular to the dovetail flank**. It does not affect the bounding
  box. `0.2` is usually right; increase it if the pieces bind. (Before
  Aug 2026 the same number produced a ~0.15 mm flank gap, so if you had
  dialled this in for your printer, re-check the fit on one seam first.)

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

## How the pieces join

Every seam — the four corner joints and every extra bed-split seam — is closed by
a **bulkhead**: a wall filling the whole U-channel cross-section, one wall
thickness either side of the seam, running the full height of the frame. The
dovetail runs through it as a **vertical prism**: a tang on one piece, a
matching slot on the other. The tang is **folded to one wall thickness**, not
solid — the same ribbon of wall as the rest of the frame, which is what the
original design does. It is a genuine fold rather than a hollow box: the
bulkhead is slit along the dovetail's centreline and the sheet drawn out
through it, so the tang's inside is continuous with the frame's own hollow.
So a thin-walled frame never buries a solid slug in the
middle of a seam, and a seam costs materially less filament the thinner the
wall — at the original 1.2 mm liner thickness the fold removes about 3% of
the model's volume; at the shipped 3 mm default, where the tang's neck starts
out narrower, it's closer to 0.4%. At heavy wall thicknesses the fold has
nothing left to hollow and the tang is simply solid.

`dovetailWidth` is the tang's width **at the seam plane**, and
`dovetailAngle` is the true angle of its flank.

So the joint holds over the frame's full height rather than only down at the
floor, which is what stops a loaded frame splaying apart at the mouth. (An
earlier version of the generator offered optional screw bosses at the seams to
fix exactly that; the full-height joint removes the need for them, and they are
gone.)

### Assembling

**The pieces slide together vertically.** Stand the end cap up, line the rail's
tang up with the cap's slot, and drop the rail down into it. The dovetail then
locks both horizontal directions — the joint cannot be pulled apart in-plane.

Nothing constrains the pieces *vertically*: that is the direction they go
together, and the case itself holds the assembled frame down once it is in.

If the pieces bind or the joint is loose, that is **Dovetail clearance** — see
*Print clearances* above.

Near the very bottom of the frame the joint thins out, because the case's bottom
corner radius rolls the outer wall inward until there is no channel left for a
bulkhead to fill. At the defaults the joint still engages over about 90 mm of the
110 mm height.

## Interoperability warning

**Grid bump width** is the registration interface between bins and the liner. The
generator defaults to **3 mm**, where the originals used 1.2 mm, because a 1.2 mm
rib is a single extrusion wide on a 0.4 mm nozzle.

Everything you print must agree on this one number. A part printed at 3 mm **does
not mate** with one printed at 1.2 mm. Wall and floor thickness, by contrast, are
free — they do not touch the interface. See *Intentional deviations* in
[models.md](models.md).
