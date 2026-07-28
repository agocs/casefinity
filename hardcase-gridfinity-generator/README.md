# Hardcase Gridfinity Generator

Browser-based parametric model generator for the Hardcase Gridfinity system.
Models are defined as code against the [replicad](https://replicad.xyz/) API
(OpenCascade B-rep kernel compiled to WASM) and built in a web worker; the
site is fully static — no backend.

## Run

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build (dist/)
npm run smoke    # build all models in Node, verify against ground truth
npm run test:session # CadSession concurrency unit test (no OCCT, ~1 s)
npm run check-3mf # verify .3mf export: package structure + watertight, outward-wound meshes
npm run scaling  # parametric invariant harness (see below)
```

## Exports

The UI offers **STL**, **STEP**, and **3MF** downloads. STL and STEP fuse a
model's shapes into a single solid. **3MF** keeps them separate: each build
shape becomes its own `<object>` in the package (see `src/three-mf.ts`), so a
multi-part model — the four dovetailed perimeter pieces, or a bin body plus its
lids — imports as individually selectable parts on the slicer plate. Geometry
is the model's own Z-up space in millimetres (identical to STL), so z=0 sits on
the plate. `npm run check-3mf` validates every model's package structure and
confirms each part's mesh is watertight and outward-wound (3MF stores no facet
normals — orientation is winding-only).

`npm run scaling` builds every model across a spread of parameter values and
asserts invariants that must hold at *any* parameters — catching hardcoded
constants and non-scaling logic without a Fusion round-trip (e.g. "the
double-sided floor tracks OVERALL_HT/2", "every perimeter piece is one clean
solid", "bbox = the parameter formula"). Each model runs in its own process
(the OCCT WASM heap is small). It's a regression gate: green unless a *new*
invariant breaks; a couple of pre-existing fragilities are marked `XFAIL`
(see Known limitations).

## Architecture

- `src/models/` — one file per model. Each exports a `ModelDef`: a parameter
  schema (used to auto-generate the UI form; `fusionName` ties each parameter
  back to the original Fusion 360 user parameter) and a `build()` function
  returning replicad shapes. A `ModelDef` may also declare optional `groups`
  (collapsible form sections, in display order) and `presets` (a dropdown that
  fills in a set of parameter values); see `src/models/types.ts` and
  `all_options.md` for the per-model form layout.
- `src/worker.ts` — web worker that loads the OCCT WASM kernel once, builds
  models, meshes them for display, and exports STL/STEP/3MF blobs.
- `src/three-mf.ts` — dependency-light 3MF writer (meshes → OPC ZIP via
  `fflate`); one `<object>` per shape so multi-part models split into parts.
- `src/viewer.ts` — three.js viewport (Z-up, orbit controls).
- `src/cad-session.ts` — owns the CAD worker and serializes work on it: a newer
  build terminates and respawns the worker rather than queueing behind the
  in-flight one (OCCT builds are synchronous WASM, so `terminate()` is the only
  way to stop one). Exports are never cancelled; a build requested mid-export
  waits in a single latest-wins slot. Takes an injected spawn function, so it
  holds no browser globals and is unit-tested in Node.
- `src/main.ts` — UI wiring: model selector, debounced parameter form,
  export buttons.
- `scripts/smoke.mjs` — builds every model headlessly in Node and checks
  bounding boxes against the STEP ground truth.
- `ground-truth/` — STEP exports of the original `.f3d` files (converted via
  the APS Model Derivative API; see `../aps_f3d_to_step.py`). Use these to
  validate ports. `../f3d-extracted-parameters.md` has the full recovered
  parameter tables.

## Porting status

| Model | Status | Fidelity vs ground truth |
|---|---|---|
| Perimeter | U-channel border + grid bumps + dovetail split (4 pieces, or auto-subdivided to fit a printer bed) + optional screw bosses at every seam (see *Screwing the pieces together*) + configurable dividers + case bottom-radius + print clearances (Stages 1-5) | bbox exact at nominal; geometry fidelity measured at the original 1.2 mm wall / 1 mm floor (the shipped defaults are intentionally heavier — see *Intentional deviations* below); prints as dovetailed pieces that seat in the case |
| Bin, no lid | complete | volume within 0.02% |
| Bin with lid | complete — plate flush with the rim, a half-round rail bead on each edge running in a wall groove (-X) and a continuous rail ledge (+X), the interference lock over the last `LID_LOCK_LENGTH`, the finger-pull scoop, the entry-edge socket notches and a configurable engraving | body within 0.014%, lid within 0.03% (excluding the engraving, which uses a different font), total 33754 vs GT 33722 (0.09%); `npm run smoke` asserts the retention features directly |
| Bin, double sided | complete — open tube + central floor with concave hopper fillet + interlock ribs + pull tab + 2 chamfered lids | bbox exact; body 68.3k vs 68.2k, total (body+2 lids) 87.3k vs 87.4k (0.03%) |
| Perimeter template | complete — two 1mm test slices of the case wall, each a closed frame (rounded floor + tapered walls + top cap), across the width and the length | bbox exact; per-slice volume within ~1% |
| Smooth perimeter (42 grid) | complete — reuses perimeter build (42mm grid, smooth/no bumps) | bbox exact; same foot/divider simplifications as perimeter |
| Perimeter, square corners (beta) | new design, not a port — reuses perimeter build with a squared (not rounded) cavity corner, so a bin can occupy the corner-most grid cell flush; outer wall unchanged (still fits the case's rounded corner/bottom) | no ground truth (not an original `.f3d`, no such variant exists); smoke locks self-derived bbox 350×250×110 and volume 757113 (at the 3 mm wall / 4 mm floor / 3 mm grid bump defaults, including the near-floor wall thickening — see "Extend FLOOR_THICK" in perimeter.ts); `npm run scaling perimeter-square-corners` guards the squared-corner invariant |
| Solid block | complete — the Bin (no lid) body with the interior cavity left uncut (`buildBinBody(p, true)`); keeps footprint, interlock ribs/sockets and pull tab. Stock for subtracting custom tool-holder pockets in CAD | no ground truth (not an original `.f3d`); smoke locks self-derived bbox 46.3×46.3×115 and volume 220848 |

## Intentional deviations from the ground truth

The ports reproduce the original geometry, but a few **defaults** are set richer
than the Fusion 360 originals on purpose — the generated parts are meant to be
printed and used standalone, not to round-trip the source file:

- **Perimeter wall / floor thickness.** The Fusion originals use a 1.2 mm wall
  and a 1 mm floor — a thin liner glued into a rigid case. The generator defaults
  to a **3 mm wall** and **4 mm floor** so the frame is self-supporting and prints
  robustly on its own. This applies to every perimeter variant (they share
  `perimeterParams`). Set them back to 1.2 / 1 mm to reproduce the source
  geometry. The fidelity figures in the porting table are measured at the
  original thicknesses; the shipped defaults deliberately enclose more material
  (e.g. the square-corners smoke volume is locked at the 3/4 mm defaults).

- **Grid bump width.** The originals make every rib, socket and groove 1.2 mm
  wide (`RIB_WIDTH`, exposed as **Grid bump width** under *Module features*). At
  that size a rib is a single extrusion wide on a 0.4 mm nozzle — fragile, and
  the matching slot is a single-pass gap — so the generator defaults to **3 mm**.
  The parameter is capped at 4.5 mm: a socket's backing boss is `3w + 2c` wide
  and sits on the outermost module centre, so above ~4.87 mm it overhangs the
  footprint and bins stop tiling at the 15 mm pitch.

Wall and floor thickness do not touch the registration interface (rib/socket
widths, grid pitch and bumps derive from `RIB_WIDTH`/`GRID_BUMP`, never
`WALL_THICK`; see `src/models/registration.ts`), so parts built at either
thickness still interlock. Grid bump width **is** that interface: bins and the
liner read the one parameter, so they agree at any setting, but a part printed
at 3 mm does not mate with one printed at the original 1.2 mm. `npm run smoke`
therefore pins `ribWidth: 1.2` for the models whose expected volumes come from
the STEP ground truth, so those stay true fidelity measurements.

## Fitting the perimeter to your printer

A full-size case frame (350 × 250 mm default) is larger than most print beds
even after the standard 4-way dovetail split. The perimeter takes three optional
parameters — **Printer bed width**, **Printer bed depth**, and **Bed margin**
(per side, for brim/adhesion) — that auto-subdivide the frame so no piece
exceeds the usable area (`bed − 2·margin`). Each long rail is cut into in-line
segments and each end cap into stacked segments, with an extra dovetail seam at
every cut; the pieces still assemble into the same frame. The bed fields default
to `0` (= no limit), which reproduces the original four pieces. Every export
format works — 3MF names each piece separately. `splitPieces` in
`src/models/perimeter.ts` is the single source; `npm run scaling` asserts that
across bed sizes every piece is one clean solid and fits the bed.

## Screwing the pieces together

The dovetails join the pieces only at floor level — the tang band lies between the
cavity wall and the case wall, where the frame is just the floor slab — so a tall
assembled frame can still splay apart at the mouth. Ticking **Screw bosses at
split lines** (off by default) adds a pad either side of every seam, at the rim on
the inside of the case wall: a **clearance hole** on the piece that carries the
tang and a concentric **thread-forming pilot hole** on its mate, so tightening a
plastic screw pulls the tang home and closes the joint at the top.

Hole sizes follow the [REMFORM® II brochure](https://taptite.com/assets/files/REMFORM-II-BROCHURE-CONTI-REMINC-2023.pdf)
(REMINC/CONTI, pp. 2–3): the clearance hole is the screw's **maximum major
diameter** and the pilot hole is the **recommended hole size**, a material factor
times the minimum major diameter. The factor defaults to **0.80**, the brochure's
value for PET / PBT / PC / PS — PETG is not listed and PET and PC are its closest
relatives. Printing something else, use your own row: 0.75 for PP, PE, PA 6/6.6,
ABS, ASA; 0.82–0.85 for 30 % glass-filled. At the M3 default that is a 3.10 mm
clearance hole and a 2.40 mm pilot, in a 7.9 mm pad (≈ 2.6 × nominal, heavier than
the 2 × moulding rule of thumb because the boss prints with its axis horizontal,
so hoop stress at the hole runs partly across layer lines). 6 mm of engagement per
side means the defaults want an **M3 × 12 thread-forming screw for plastics**
(REMFORM, Plastite, PT or similar — not a machine screw). The pad's whole
underside is a 45° ramp to the wall, so it prints without support.

Three things to know before you print:

- The screw drives **along** the channel, so a straight driver run has to fit
  between the boss and the nearest full-height obstruction. At the default divider
  spacing that is about 57 mm of clear channel — fine for a stubby driver or a
  ball-end key, tight for an inline bit and handle. Fewer **dividers per long
  side** gives more room. No other screw axis would cross the seam, so this is
  inherent, not a bug.
- On a case too shallow for the full 45° gusset (roughly under 20 mm of depth at
  the M3 defaults) the ramp is clamped to land on the floor slab and becomes
  steeper than 45°, which wants support. Bosses are dropped entirely if the pad
  cannot fit between the rim and the floor, or across the border width.
- **Absurdly shallow cases: the gusset clips out through the wall.** The pad's
  outer face is flat and placed where the wall runs at the *rim*, sunk 0.4 mm into
  it, while the boss feature is about `2 × pad` tall (15.8 mm at the M3 defaults).
  Over that height the wall leans inward — by the taper, and much faster once the
  case's bottom corner radius (19.05 mm) starts rolling it in — so the pad sits
  progressively deeper in the wall toward its foot, and breaks out through the far
  side once that exceeds the wall thickness. Measured at the defaults: nothing at
  27 mm of case depth, **0.7 mm proud at 25 mm, 5.1 mm proud at 20 mm** — so the
  threshold is around 26 mm, and such a piece would not seat in the real case.
  **Not fixed on purpose**: every real hard case is 100 mm-plus deep, and having
  the boss follow the fillet would trade a flat, drillable face for a curved one on
  geometry nobody prints. On a genuinely shallow liner, either leave the bosses off
  or shrink the pad — a smaller **Boss screw size** or **Boss material around
  hole** lowers the whole feature, and a thicker wall gives it more to hide in.

## Known limitations

- **Screw-boss gussets clip out through the wall on absurdly shallow cases** —
  around 26 mm of case depth and below at the M3 defaults (0.7 mm proud at 25 mm,
  5.1 mm at 20 mm), because the boss feature is taller than the clean run between
  the rim and the case's bottom corner radius. Accepted, not fixed — see
  *Screwing the pieces together* above for the mechanism and the ways around it.

Previously flagged and now fixed: **the with-lid lid was retained by nothing.**
`LID_LOCK_OFFSET` had been read as a vertical drop of the whole lid, so the plate
sat 0.3 mm below the rim; the -X edge was a flat 3 mm tongue driven into the wall
rather than a rail bead; and the seat was carved by subtracting the lid itself
from the body, which machines the groove to a perfect fit and erases the very
interference that holds the lid shut (0 mm³ against the ground truth's 4.71).
Re-measuring the STEP showed `LID_LOCK_OFFSET` is the *radial swell* of the bead
over the last `LID_LOCK_LENGTH`, that the +X bead runs on a continuous ledge (not
just the three socket bosses), and that the entry edge does carry socket notches
after all — an earlier reading had concluded it was solid at every height, and
the area that reading attributed to rounded plan corners was those notches. The
seat is now cut with a deliberately shrunk cutter so the lock survives, and
`npm run smoke` asserts the interference is present *and* confined to the lock
zone, so a future "fix" for the interpenetration cannot silently remove it again.

Previously flagged and now fixed: the perimeter dovetail split used to degenerate
at narrow/square dimensions (a zero-volume flake at `250×180`, two *empty*
long-side pieces at 42-grid `300×300`). Root cause was not the boolean but the
divider ribs — near the filleted base the tapered wall curves inward past the
grid-bump line, which inverted the rib's Y-Z profile into a self-intersecting
polygon and blew up the fuse. `addDividers` now clamps the rib's outer edge to
stay just outside the inner edge, so the profile is always valid; the two former
failure points are regression variants in `npm run scaling`.

## Reverse-engineering workflow (how the ports were made)

The `.f3d` sources are unreadable, so ports are reconstructed from the
`ground-truth/` STEP files:

1. `node scripts/analyze-step.mjs <step>` — solids, volumes, bboxes, and
   plane histograms (reveals wall positions and feature dimensions).
2. `node scripts/probe-step.mjs <step> <axis> <from> <to> <step>` — slab
   volume profile along an axis (localizes features by height).
3. `node scripts/render-mesh.mjs '<step>[#solid]' <prefix>` — orthographic
   depth-map PNGs; also works on ports via `model:<id>`.
4. Write/adjust the model, then `node scripts/diff-model.mjs <id> <step>` —
   boolean excess/missing volumes localize any error precisely. For models
   whose ground truth lands in the +X/+Y quadrant after the Y-up→Z-up rotation
   (the perimeter), use `scripts/diff-aligned.mjs` instead — it recenters both
   port and truth on XY first so they actually overlap.
5. Iterate 4 until the diff is negligible; add the expected volume to
   `scripts/smoke.mjs`.

## Adding a model

1. Create `src/models/<name>.ts` exporting a `ModelDef` (copy `perimeter.ts`;
   bins should reuse `bin-common.ts`).
2. Register it in `src/models/index.ts`.
3. Add its expected bounding box/volume to `scripts/smoke.mjs` and run
   `npm run smoke` against the matching file in `ground-truth/`.

## License note

The original Hardcase Gridfinity designs are not ours; check the license
terms with the original creator before publishing generated models or a
public generator site.
