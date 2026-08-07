# Reverse-engineering notes

How the models in this repo were reconstructed, and what was learned about the
original geometry along the way. Useful if you want to port another model,
verify a change, or understand why a model is built the way it is.

## Why reverse-engineering was necessary

The original designs are Fusion 360 `.f3d` archives. They are ZIP containers
around a proprietary binary payload, and no open tooling parses their parametric
data — there is no feature tree, no sketch geometry, nothing to convert. So the
models are not *converted*, they are **re-implemented as code** and then
measured against STEP exports of the originals.

Two artifacts made that possible:

- **[f3d-parameters.md](f3d-parameters.md)** — the user parameters (names,
  defaults, driving expressions) recovered by string-mining the
  `FusionDesignSegmentType1/BulkStream.dat` stream inside each archive. User
  parameters are serialized as `<value expression> · "User Parameter" · <NAME>`
  triples in UTF-16LE, so names and inter-parameter formulas survive even though
  the feature tree does not. This is the authoritative reference for parameter
  provenance — derive dimensions from these expressions rather than from magic
  numbers. Rows marked ⚠ are heuristic mispairings (unitless numeric defaults do
  not survive the scan) and need reading from Fusion's *Change Parameters*
  dialog.
- **`hardcase-gridfinity-generator/ground-truth/*.step`** — STEP exports of the
  five original files, produced by `aps_f3d_to_step.py` through the Autodesk
  Platform Services Model Derivative API. These are the measurement target.

## The workflow

The `.f3d` sources are opaque, so ports are reconstructed from the STEP files.
All scripts live in `hardcase-gridfinity-generator/scripts/` and run under Node.

1. **`node scripts/analyze-step.mjs <file.step> [x|y|z]`** — solids, volume,
   bounding box, and quantized vertex-plane histograms. The histograms are the
   workhorse: they reveal wall positions and feature sizes directly.
2. **`node scripts/probe-step.mjs <file.step> <axis> <from> <to> <step>`** — slab
   volume profile along an axis, which localizes features by height.
3. **`node scripts/render-mesh.mjs '<file.step>[#solidIndex] | model:<id>' <out-prefix> [size]`**
   — orthographic depth-map PNGs. The fastest way to actually *see* geometry
   without a GUI, and it works on ports too via `model:<id>`.
4. **Write or adjust the model**, then
   **`node scripts/diff-model.mjs <modelId> <truth.step>`** — the fidelity
   check. Reports boolean excess and missing volume against ground truth, with
   slab profiles that localize any error precisely.
5. **Iterate step 4** until the diff is negligible, then add the expected
   bounding box and volume to `scripts/smoke.mjs` so it cannot regress.

For models whose ground truth lands in the +X/+Y quadrant after the Y-up→Z-up
rotation — the perimeter — use **`scripts/diff-aligned.mjs`** instead. It
recenters both port and truth on XY first, so they actually overlap; plain
`diff-model.mjs` does not.

### Coordinate systems

Ports are modeled **Z-up**, centered on XY, with `z=0` at the bottom. The STEP
ground truth is **Y-up**. To compare, rotate 90° about X:

```js
shape.rotate(90, [0, 0, 0], [1, 0, 0]);
```

`diff-model.mjs` already does this for you.

## OCCT traps

Hard-won, all of them still relevant:

- **`importSTEP` returns a `Compound`** for multi-solid files, and booleans on
  compounds silently misbehave — always explode first via
  `occt-utils.importStepSolids()`.
- **`shell()` fails on tapered rounded-rectangle lofts.** Build an outer and an
  inner loft and cut instead.
- **Extending a cutter past a tapered solid's ends leaves boolean debris.** Use
  coplanar caps — see `perimeter.ts`.
- **Degenerate boolean intersections can throw.** Wrap them in try/catch, as
  `slabVolume` does.
- **A z-slab intersect gives a WRONG bounding box on lofted solids** — it
  returns the top section. It works fine on imported STEP. To check a loft's
  taper use `measureVolume` or the mesh vertices, never the bounding box of a
  slab. (This one cost a long false-alarm debugging chase.)
- **A single multi-section loft with clustered fillet sections corrupts the body
  taper.** Split it: a short fillet loft fused to a straight body loft.
- **The emscripten OCCT build is an ES module that references CJS globals** in
  Node. `scripts/occt-utils.mjs` shims `globalThis.require` and
  `globalThis.__dirname` before importing it — reuse that bootstrap rather than
  importing `replicad-opencascadejs` directly in a new script.

## Recovered geometry

### Perimeter (the flagship)

Ground truth `Hardcase_Gridfinity_Perimeter.step`: total volume ~404,563 mm³ as
**4 dovetailed solids** (2 long side strips + 2 end strips) around a central
cavity.

**Cross-section** is a thin-walled **U-channel open at the top**: a vertical
inner (cavity) wall at `WALL_THICK`, a 2°-tapered outer (case) wall meeting the
outer footprint at the top mouth, hollow between, joined at the bottom by a foot
— a floor band roughly 8 mm wide at the inner wall plus a ~45° gusset ramp up to
the outer wall, reaching it about 16 mm up.

**Key dimensions** at the L350 × W250 × H110 defaults: cavity opening
**285 × 195**, giving a 32.5 mm end border (X) and a 27.5 mm side border (Y).
That let the two unknown ⚠ parameters be recovered:
**`SIDE_BOARDER_BIN_ADD` = 4** and **`FRONT_BOARDER_BIN_ADD` = 3**, since
`SIDE_BOARDER = 350 − 15·(23−4) = 65` and
`FRONT_BOARDER = 250 − 15·(16−3) = 55`. Cavity corner radius is
`WALL_CORNER_RADIUS` 15.5; outer corner radius is `BOTTOM_CORNER_RADIUS` 19.05.

**Grid bumps** sit at every 15 mm grid-cell centre, full height, and — as on the
bins — adjacent walls differ: **ribs (1.5 proud) on the −Y and +X walls**,
**grooves (~1.5 deep) on the +Y and −X walls**. 19 per long side, 13 per end.

**Dovetail split**: the 4 pieces overlap at the corners (end piece x 0..32.5,
side pieces x 28.8..321, so ~3.7 mm of joint overlap). Parameters
`BOARDER_DOVETAIL_WIDTH` 10, `DEPTH` 5, `ANGLE` 30, `CLEAR` 0.2.

**The joints run the full height**, and this was missed on the first pass. Each
piece end is closed by a transverse **bulkhead** spanning the entire U-channel
cross-section at `WALL_THICK`, floor to rim, and the dovetail runs through it as
a straight vertical prism. The STEP is Y-up, so "height" is y:

- Material in the rail's tang band (x 28.7..33.9) is ~230 mm³ per 5 mm of height
  and stays that way from the floor to the rim (rising only with the wall taper).
  A plain wall section of the same footprint holds ~62 mm³ — the band is ~3.7x a
  bare wall all the way up.
- An XZ cross-section of the long rail at mid height (y 54..56) shows a fully
  bridged band at x 32.6..33.8 spanning the whole border (z −27.5..−2.5) — the
  bulkhead — plus a dovetail-shaped wall structure protruding to x ≈ 28.8.
- The same section of the end cap shows a bulkhead at x 31.3..32.5 pierced by a
  dovetail-shaped mouth at z −18..−10, behind which a dovetail chamber widens
  away from the mouth (half-width ≈3.3 at the mouth, ≈5.2 at 3 mm depth — a ~30°
  flank, matching `BOARDER_DOVETAIL_ANGLE`).

The ground truth's tang and socket are thin-walled. At the time this fix landed
that looked like the 1.2 mm liner convention rather than something structural,
so the port built a solid tang, reasoning that at a 3 mm wall a 5 mm-deep
dovetail has no core left to hollow. A closer measurement later proved the fold
structural — see below.

Why the port missed it: building the tang by fusing its 2-D footprint into a
piece's region and intersecting the frame only materialises it where the HOLLOW
U-channel happens to have material in the tang band. At the port's defaults the
corner tang band sits at y 103..119, but at z=0 the outer footprint reaches only
y=102.1 — `BOTTOM_CORNER_RADIUS` pulls the wall in over the whole bottom fillet —
so below z≈19 the band was outside the frame entirely, and the joint measured
exactly **zero** above z=90. The fix intersects the seam footprints with an
explicit channel solid instead, which is also what gives the bulkhead the wall
taper and fillet for free. See
`docs/superpowers/specs/2026-08-07-full-height-dovetails-design.md`.

The correction dominates the model's overall fidelity. Measured at the ground
truth's own 1.2 mm wall / 1 mm floor, against the 404,563 mm³ truth:

| | before | after |
|---|---|---|
| total port volume | 318,579 (21.3% under) | 392,442 (3.0% under) |
| truth-not-port in one corner joint band | 6,829 mm³ | 223 mm³ |

(Band = x 138..150, y 100..124, z 25..105 in the port's centred Z-up frame.) The
port now carries *more* material in that band than the truth does — 12,747 vs
7,855 mm³ — because the truth's tang is a thin-walled shell and the port's was
solid at the time (see below — the port now folds it too). The remaining 3.0%
is the flat-floor foot, unrelated to the joints.

**The tang is a fold, not a solid.** A closer measurement of
`ground-truth/Hardcase_Gridfinity_Perimeter.step` (Y-up, 4 solids: rails at
x 28.79..321.21, caps at x 0..32.51 and 315.99..350.02) confirmed it. A
horizontal section at mid-height (y 55..56), material per 1 mm of x:

| x | 28 | 29 | 30 | 31 | 32 | 33 | 34–38 |
|---|---|---|---|---|---|---|---|
| rail | 1.98 | 9.19 | 2.77 | 2.77 | 10.86 | 19.42 | 2.40 |
| cap | 10.60 | 5.11 | 7.63 | 22.58 | 15.11 | 0 | 0 |

Reading the rail: the bulkhead sits at x ≈ 32.6..33.8 (1.2 mm across the
~25 mm border ⇒ ~25 mm²/mm, matching the 19.42 and 10.86 columns). The tip
face at x 28.79..29.99 reads 9.19 mm²/mm — a 1.2 mm wall about 7.7 mm wide —
and behind it, at x 30..32.6, only 2.77 mm²/mm: two 1.2 mm flanks and nothing
between them. Therefore the tang is hollow: the bulkhead sheet folds out into
the dovetail outline and folds back.

**The fold is also open at its narrow end**, and this table cannot show it —
which is worth recording, because the first reading of these numbers concluded
the opposite. Integrating material across the whole border at x = 33 gives
~24.3 mm of a ~25 mm span, which looks like an unbroken bulkhead and is not.
Profiling the same station cell by cell along z instead reveals a slot on the
dovetail centreline (z ≈ −14.5..−13.0), 1.5 mm wide at the web and widening
outward — 2.5 mm at x = 32, 4.5 at x = 31, 5.5 at x = 30. The sheet is slit and
drawn out; the dovetail's interior is continuous with the channel behind it. A
1.5 mm gap inside a 25 mm total is invisible to an integrated measurement, and
the arithmetic agreeing with the assumption is what stopped the first reading
looking further. **When a section total matches expectation, that is not
evidence the section has no holes in it** — profile the axis you are
integrating over.

The port reproduces both properties via `seamCore`, whose void runs the
profile's whole length rather than stopping at the seam plane. Its slot is wider
than the original's (a constant `dovetailWidth − 2·wallThick·sec(angle)`, ≈7.2 mm
at a 1.2 mm wall) because the port's profile holds constant width behind the
seam plane to keep `dovetailAngle` honest, where the original's pure trapezoid
keeps flaring and so pinches its own void shut. See
`docs/superpowers/specs/2026-08-07-folded-dovetail-tang-design.md`.

**Dividers** (`BOARDER_DIVIDERS`) are sparse full-height ribs that fill the
border channel and project into the cavity. The original's layout is ad-hoc per
edge (one long side at x≈55, 115, 205, 265; the other at 55, 100, 160, 235; ends
differ again), so the port exposes an evenly-spaced count instead of cloning it.

Construction lessons specific to this model, each of which was a bug first:

- The floor **must** span the full border out to the outer footprint, or the
  inner and outer walls stay two disjoint shells — which looks fine by volume and
  diff but breaks the split and printability.
- Apply each wall's grid features to **the piece that owns that wall**. Fusing
  bumps to the whole frame and then splitting orphans the ±X-wall ribs into the
  side pieces as slivers.
- Set the dovetail tang base 2 mm inside the split line so its 2-D union with
  the side rectangle is clean.
- Build dividers as a Y-Z profile extruded per X so they follow the wall taper
  and fillet — no expensive intersect against the outer loft — and apply them
  last, per piece, so grooves cannot slice them.
- Clamp a divider rib's outer edge to stay just outside its inner edge. Near the
  filleted base the tapered wall curves inward past the grid-bump line, which
  otherwise inverts the rib's Y-Z profile into a self-intersecting polygon and
  blows up the fuse. This was the real cause of the split degenerating at narrow
  and square dimensions; both former failure points are now regression variants
  in `npm run scaling`.

### Bin interlock (shared by every bin)

Exterior **ribs** `WALL_THICK` wide and `WALL_BUMP` proud sit at module centres
on two faces. The opposite walls carry **through-slots** (`WALL_THICK + 2·CLEAR`)
backed by **interior bosses** (slot + `2·WALL_THICK` wide), so a neighbour's rib
snaps in. The **pull tab** is the +Y wall extended by `PULL_TAB_HT` with a
drafted pull slot; its gussets are the side walls tapering at 45°.

This is factored into `addInterlockRibs()` and `addPullTab()` in
`src/models/bin-common.ts`, and the registration dimensions live in
`src/models/registration.ts` — deliberately independent of `WALL_THICK`, so
parts printed at different wall thicknesses still interlock.

### Double-sided bin

Ground truth is 3 solids. The **body** is 61.3 × 115 × 61.3 — 4×4 modules
(`4·15 − 0.2 + 1.5 = 61.3`), 110 tall plus a 5 mm pull tab — an open tube (open
at *both* ends) with a **central floor** near mid-height carrying a large
concave "hopper" fillet (r≈18, `BOTTOM_FILLET_FACTOR` 2.3) on its underside
only; the top face is flat. The **2 lids** are 57.4 × 3.3 × 58.4 plates, inset
~2 mm from the tube.

The port approximates that fillet with a loft cut (a truncated pyramid) rather
than a true fillet, which is where its ~0.3% volume difference comes from.

### With-lid retention (a cautionary tale)

The first port of the with-lid bin was retained by nothing at all, and it
measured as a *good* port. `LID_LOCK_OFFSET` had been read as a vertical drop of
the whole lid, so the plate sat 0.3 mm below the rim; the −X edge was a flat 3 mm
tongue driven into the wall rather than a rail bead; and the lid seat was carved
by subtracting the lid *itself* from the body — which machines the groove to a
perfect fit and erases the very interference that holds the lid shut (0 mm³
against the ground truth's 4.71).

Re-measuring the STEP showed that `LID_LOCK_OFFSET` is the **radial swell** of
the bead over the last `LID_LOCK_LENGTH`, that the +X bead runs on a continuous
ledge rather than just the three socket bosses, and that the entry edge does
carry socket notches after all — an earlier reading had concluded it was solid at
every height, and the area that reading attributed to rounded plan corners was
in fact those notches.

The seat is now cut with a deliberately shrunk cutter so the lock survives, and
`npm run smoke` asserts the interference is **present** *and* **confined to the
lock zone** — so a future "fix" for the apparent interpenetration cannot
silently remove it again.

The lesson generalizes: a volume diff alone will not catch a functional feature
that is missing. Assert the feature.

## Adding a model

1. Create `src/models/<name>.ts` exporting a `ModelDef` — copy `perimeter.ts` as
   a template; bins should reuse `bin-common.ts`.
2. Derive dimensions from the Fusion parameter expressions in
   [f3d-parameters.md](f3d-parameters.md) where they are known, not from magic
   numbers.
3. Register it in `src/models/index.ts`.
4. Verify with `diff-model.mjs` against the matching ground-truth STEP.
5. Add the expected bounding box and volume to `scripts/smoke.mjs` and run
   `npm run smoke`.
6. Document the model's form layout and any deliberate gaps in
   [models.md](models.md).
