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
```

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
| Bin with lid | bin complete; lid v1 (plate + ramp) | fused volume within 0.2%; lid seat cut, scalloped rail, lock notches and "TOP" engraving TODO |
| Bin, double sided | IN PROGRESS — bin-common refactored (`addInterlockRibs`, `addPullTab` extracted). Next: open tube + central floor with hopper fillet (BOTTOM_FILLET_FACTOR≈2.3, r≈18) + 2 lids. GT: 4×4 body 61.3² + 2 lids 57.4×58.4×3.3 | — |
| Perimeter template | TODO — 2 thin 1mm test cross-section strips of the wall profile (lowest value) | — |
| Smooth perimeter (42 grid) | complete — reuses perimeter build (42mm grid, smooth/no bumps) | bbox exact; same foot/divider simplifications as perimeter |

Known gap: the with-lid assembly renders the lid in place, but since the lid
seat is not yet cut into the bin, lid and bin slightly interpenetrate
(~200 mm^3). Exports should eventually offer one file per part anyway.

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
