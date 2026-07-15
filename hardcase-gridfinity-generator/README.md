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
npm run scaling  # parametric invariant harness (see below)
```

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
  returning replicad shapes.
- `src/worker.ts` — web worker that loads the OCCT WASM kernel once, builds
  models, meshes them for display, and exports STL/STEP blobs.
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
| Perimeter | U-channel border + grid bumps + dovetail 4-piece split + configurable dividers + case bottom-radius + print clearances (Stages 1-5) | bbox exact at nominal; fused volume 306k vs 405k (gap = flat-floor foot vs gusset ramp + design-specific divider layout); prints as 4 dovetailed pieces that seat in the case |
| Bin, no lid | complete | volume within 0.02% |
| Bin with lid | bin complete; lid (plate + ramp + seat cut + configurable engraving + +X rail) | total volume within 0.4% of GT; lock notches and rounded top corners/chamfers TODO |
| Bin, double sided | complete — open tube + central floor with concave hopper fillet + interlock ribs + pull tab + 2 chamfered lids | bbox exact; body 68.3k vs 68.2k, total (body+2 lids) 87.3k vs 87.4k (0.03%) |
| Perimeter template | complete — two 1mm test slices of the case wall, each a closed frame (rounded floor + tapered walls + top cap), across the width and the length | bbox exact; per-slice volume within ~1% |
| Smooth perimeter (42 grid) | complete — reuses perimeter build (42mm grid, smooth/no bumps) | bbox exact; same foot/divider simplifications as perimeter |

## Known limitations

- The with-lid assembly's remaining lid detail (rounded top corners and edge
  chamfers, lock notches) is cosmetic top-face geometry and not yet modelled.
  The +X sliding rail is now modelled (a rounded bead that seats in a wall
  groove); the deeper -X locking tongue was already present.

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
