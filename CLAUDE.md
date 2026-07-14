# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this workspace is

Source material and code for building a browser-based parametric model generator
for the Hardcase Gridfinity system (goal: a site like gridfinitygenerator.com).
The original designs are Fusion 360 archives that no open tooling can parse, so
the models are being re-implemented as replicad code and verified against STEP
exports:

- `1. Template/`, `2. Perimeter/`, `3. Bins/` — original `.f3d` files (ZIP
  containers, proprietary binary payload; treat as read-only reference)
- `f3d-extracted-parameters.md` — user parameters (names, defaults, driving
  expressions) recovered from the `.f3d` binaries; the authoritative reference
  for parameter provenance
- `step_output/` — STEP ground truth converted from the `.f3d` files via the
  APS Model Derivative API (`aps_f3d_to_step.py`; needs `APS_CLIENT_ID` /
  `APS_CLIENT_SECRET` env vars, uploads are transient)
- `hardcase-gridfinity-generator/` — the actual codebase: Vite + TypeScript
  static site running replicad (OCCT WASM) in a web worker; `ground-truth/`
  inside it is a copy of `step_output/`

The designs belong to the Hardcase Gridfinity creator; license for publishing a
public generator is unresolved (see README).

## Commands

All in `hardcase-gridfinity-generator/`. Node is installed via Homebrew; if
`node`/`npm` are not on PATH, use `/home/linuxbrew/.linuxbrew/bin/node` (and
`.../npm`) directly.

- `npm run dev` — dev server
- `npm run build` — type-check (tsc) + production build
- `npm run smoke` — the test suite: builds every registered model headlessly in
  Node with the real OCCT kernel and asserts bounding boxes and volumes against
  ground truth (expected values table at the top of `scripts/smoke.mjs`)

Reverse-engineering/verification scripts (Node, in `scripts/`):

- `node scripts/diff-model.mjs <modelId> <truth.step>` — THE fidelity check:
  boolean excess/missing volumes between a port and ground truth, with slab
  profiles to localize errors
- `node scripts/analyze-step.mjs <file.step> [x|y|z]` — solids, volume, bbox,
  quantized vertex-plane histograms (reveals wall positions, feature sizes)
- `node scripts/probe-step.mjs <file.step> <axis> <from> <to> <step>` — slab
  volume profile along an axis
- `node scripts/render-mesh.mjs '<file.step>[#solidIndex] | model:<id>' <out-prefix> [size]` —
  orthographic depth-map PNGs (fastest way to "see" geometry headlessly)

## Architecture

- `src/models/` — each model is a `ModelDef` (see `types.ts`): a parameter
  schema plus a `build()` returning replicad `Shape3D`(s). The schema drives the
  auto-generated UI form; each param's `fusionName` ties back to the original
  Fusion 360 user parameter in `f3d-extracted-parameters.md`. Bins share
  `bin-common.ts` (`buildBinBody`, `binParams`, `box`, `moduleCenters`).
- `src/worker.ts` — comlink-exposed web worker; loads the OCCT WASM once
  (`replicad-opencascadejs`), builds/meshes models, exports STL/STEP blobs.
  `src/main.ts` wires the model selector, debounced param form (`params-form.ts`),
  three.js viewer (`viewer.ts`, Z-up), and export buttons.
- `scripts/occt-utils.mjs` — shared Node bootstrap for the OCCT kernel plus
  compound-aware STEP import and slab/occupancy helpers. All analysis scripts
  build on it; `render-lib.mjs` holds the pure-JS PNG depth renderer.
- Porting status and the step-by-step reverse-engineering workflow live in the
  README ("Porting status", "Reverse-engineering workflow").

## Conventions and gotchas

- Ports are modeled Z-up, centered on XY, z=0 at the bottom. The STEP ground
  truth is Y-up: rotate `90°` about X (`shape.rotate(90, [0,0,0], [1,0,0])`)
  to compare — `diff-model.mjs` already does this.
- Model sources are imported by both Vite and Node (native type-stripping), so
  intra-`src/models/` imports must use explicit `.ts` extensions
  (`allowImportingTsExtensions` is on) and models must stay free of
  browser-only APIs.
- The emscripten OCCT build is an ES module that references CJS globals in
  Node; `occt-utils.mjs` (and `smoke.mjs`) shim `globalThis.require` /
  `globalThis.__dirname` before importing it. Reuse the existing bootstrap
  rather than importing `replicad-opencascadejs` directly in new scripts.
- `importSTEP` returns a `Compound` for multi-solid files, and booleans on
  compounds silently misbehave — always explode via
  `occt-utils.importStepSolids()` first.
- OCCT geometry traps encountered: `shell()` fails on tapered rounded-rect
  lofts (build outer/inner lofts and cut instead); extending a cutter past a
  tapered solid's ends leaves boolean debris (use coplanar caps — see
  `perimeter.ts`); degenerate boolean intersections can throw (wrap in
  try/catch, as `slabVolume` does).
- New models: derive dimensions from Fusion parameter expressions where known
  (not magic numbers), register in `src/models/index.ts`, verify with
  `diff-model.mjs`, then add expected bbox/volume to `smoke.mjs`. Achieved
  fidelity so far: bin-no-lid 0.02%, bin-double-sided 0.3% volume error;
  all 6 models pass smoke. Document any deliberate gaps (like the with-lid
  lid seat) in the model file's doc comment and the README table.
