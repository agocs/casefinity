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
| Perimeter | U-channel border + grid bumps + dovetail split (4 pieces, or auto-subdivided to fit a printer bed) + configurable dividers + case bottom-radius + print clearances (Stages 1-5) | bbox exact at nominal; geometry fidelity measured at the original 1.2 mm wall / 1 mm floor (the shipped defaults are intentionally heavier — see *Intentional deviations* below); prints as dovetailed pieces that seat in the case |
| Bin, no lid | complete | volume within 0.02% |
| Bin with lid | bin complete; lid (plate + ramp + seat cut + configurable engraving + +X rail + rounded top edge/corners) | total volume within 0.4% of GT; GT has no lock notches (see below); an edge lip+groove is not yet ported |
| Bin, double sided | complete — open tube + central floor with concave hopper fillet + interlock ribs + pull tab + 2 chamfered lids | bbox exact; body 68.3k vs 68.2k, total (body+2 lids) 87.3k vs 87.4k (0.03%) |
| Perimeter template | complete — two 1mm test slices of the case wall, each a closed frame (rounded floor + tapered walls + top cap), across the width and the length | bbox exact; per-slice volume within ~1% |
| Smooth perimeter (42 grid) | complete — reuses perimeter build (42mm grid, smooth/no bumps) | bbox exact; same foot/divider simplifications as perimeter |
| Perimeter, square corners (beta) | new design, not a port — reuses perimeter build with a squared (not rounded) cavity corner, so a bin can occupy the corner-most grid cell flush; outer wall unchanged (still fits the case's rounded corner/bottom) | no ground truth (not an original `.f3d`, no such variant exists); smoke locks self-derived bbox 350×250×110 and volume 725903 (at the 3 mm wall / 4 mm floor defaults); `npm run scaling perimeter-square-corners` guards the squared-corner invariant |
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

The registration interface — rib/socket widths, grid pitch, bumps — is unchanged
(it derives from `RIB_WIDTH`/`GRID_BUMP`, never `WALL_THICK`; see
`src/models/registration.ts`), so parts built at either thickness still interlock.

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

## Known limitations

- The with-lid lid now models the +X sliding rail (a rounded bead that seats in
  a wall groove; the deeper -X locking tongue was already present) and the
  rounded top corners / softened top edge. Cross-sectioning the ground truth
  showed the once-assumed **lock notches do not exist** — the entry edge is
  solid at every height, module centres included — so they were not modelled.
  The ground truth does have a transverse lip+groove near one edge that is not
  yet ported.

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
