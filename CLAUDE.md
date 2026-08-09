# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this workspace is

Source material and code for building a browser-based parametric model generator
for the Hardcase Gridfinity system (goal: a site like gridfinitygenerator.com).
The original designs are Fusion 360 archives that no open tooling can parse, so
the models are being re-implemented as replicad code and verified against STEP
exports:

- `1. Template/`, `2. Perimeter/`, `3. Bins/` — original `.f3d` files (ZIP
  containers, proprietary binary payload; treat as read-only reference).
  **Gitignored** — nothing in the build reads them and they are large opaque
  binaries. Present on the author's disk only; a fresh clone will not have them,
  so `aps_f3d_to_step.py` is an author-only operation.
- `docs/f3d-parameters.md` — user parameters (names, defaults, driving
  expressions) recovered from the `.f3d` binaries; the authoritative reference
  for parameter provenance
- `hardcase-gridfinity-generator/ground-truth/` — STEP ground truth converted
  from the `.f3d` files via the APS Model Derivative API (`aps_f3d_to_step.py`;
  needs `APS_CLIENT_ID` / `APS_CLIENT_SECRET` env vars, uploads are transient).
  This is the single tracked copy and what the tests measure against.
- `hardcase-gridfinity-generator/` — the actual codebase: Vite + TypeScript
  static site running replicad (OCCT WASM) in a web worker
- `docs/` — all prose documentation; see the doc map below

The designs belong to the Hardcase Gridfinity creator (the Unemployed Architect).
Casefinity has his **written permission** to reimplement them; the MIT license
covers this repo's code only, not his designs. The site is live at
**casefinity.net**. The root README's "Design provenance" section states the
boundary — keep it accurate.

## Documentation map

Keep these in sync when behavior changes; don't create new top-level docs.

- root `README.md` — the public front door: what Casefinity is, quick start,
  repo layout, design provenance, contributing
- `hardcase-gridfinity-generator/README.md` — developer guide: commands,
  architecture, analysis tooling, conventions, deployment
- `docs/models.md` — per-model catalog: fidelity vs ground truth, **form
  layout for every model**, intentional deviations, known limitations
- `docs/printing.md` — user-facing print guide: export formats, clearances,
  bed fitting, how the split pieces join
- `docs/reverse-engineering.md` — porting workflow, OCCT traps, recovered
  geometry findings per model
- `docs/casefinity-spec.md` — the proposed interop spec; rendered to
  `public/casefinity-spec.html` by `npm run build-spec` (output is committed)
- `docs/case-dimensions.md` — measured hard case interiors
- `docs/superpowers/{specs,plans}/` — historical design docs, append-only

## Git workflow

Before starting a new feature: pull the latest `main` and branch off of it.
Do the work on that branch. When it's ready, merge the branch into `main` and
push `main` — don't develop directly on `main`.

## Commands

All in `hardcase-gridfinity-generator/`. Needs Node 22.18+ / 23.6+ (the scripts
import the `.ts` model sources directly and rely on built-in type stripping).
Node is usually on PATH as `/usr/bin/node`; on some of the author's machines it
is installed via Homebrew instead, at `/home/linuxbrew/.linuxbrew/bin/node` —
check both before concluding it is missing.

- `npm run dev` — dev server
- `npm run build` — type-check (tsc) + production build
- `npm run smoke` — the test suite: builds every registered model headlessly in
  Node with the real OCCT kernel and asserts bounding boxes and volumes against
  ground truth (expected values table at the top of `scripts/smoke.mjs`). Runs
  as a pool of child processes, one per *unit*, because the OCCT WASM heap is
  capped at 2 GiB per process and no unit may hold more than one
  perimeter-scale build; ~95 s wall clock for ~455 s of work. Run one unit in
  the foreground with `node scripts/smoke.mjs <unit>`, cap the pool with
  `SMOKE_JOBS`
- `npm run test:session` — unit-tests the `CadSession` build/export concurrency
  state machine with a fake worker (no OCCT; runs in ~1 s)
- `npm run check-exports` — round-trips every format through the real kernel and
  asserts a model's pieces stay *separate* (STEP re-imports as one named solid
  per part; the binary STL's triangle count and signed volume account for every
  part). One model per child process. Run one with
  `node scripts/check-exports.mjs <modelId>`

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
  Fusion 360 user parameter in `docs/f3d-parameters.md`. A `ModelDef` may
  also declare optional `groups` (collapsible form sections referencing param
  `key`s, rendered by `params-form.ts`) and `presets` (a dropdown that fills a
  set of values); `docs/models.md` documents each model's form layout — keep it
  in sync. A `key` listed in a group must exist in `params` and appear in only
  one group, or `params-form.ts` renders it twice / drops it to the top. Bins
  share `bin-common.ts` (`buildBinBody`, `binParams`, `box`, `moduleCenters`).
- `src/cad-session.ts` — worker lifecycle + build concurrency. A new build
  preempts the in-flight one by terminating and respawning the worker (OCCT
  builds are synchronous WASM with no cancellation point); exports are never
  preempted, and a build requested during one parks in a single latest-wins
  slot. A STEP export also retires the worker once the blob is delivered (see
  the export note below). The worker arrives via an injected spawn function,
  keeping the module browser-global-free and testable in Node.
- `src/worker.ts` — comlink-exposed web worker; loads the OCCT WASM once
  (`replicad-opencascadejs`), builds/meshes models, and delegates every export
  format to `src/exports.ts` (kept outside the worker and browser-API-free so
  `npm run check-exports` tests the shipped path). `src/stl.ts` and
  `src/three-mf.ts` are the STL and 3MF writers.
  `src/main.ts` wires the model selector, debounced param form (`params-form.ts`),
  three.js viewer (`viewer.ts`, Z-up), and export buttons.
- `scripts/occt-utils.mjs` — shared Node bootstrap for the OCCT kernel plus
  compound-aware STEP import and slab/occupancy helpers. All analysis scripts
  build on it; `render-lib.mjs` holds the pure-JS PNG depth renderer.
- Porting status lives in `docs/models.md`; the step-by-step
  reverse-engineering workflow and the recovered geometry findings live in
  `docs/reverse-engineering.md`.

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
- Freeing OCCT memory in Node needs a **yield**, not just `gc()`. replicad
  releases handles from a `FinalizationRegistry`, and V8 runs those callbacks as
  a scheduled task, so a synchronous loop never actually frees anything however
  often it calls `gc()` — this is what made `scaling-test.mjs` abort on its
  heaviest variant. Use its `collect()` pattern (gc → `setImmediate` → gc).
  Measured over 300 identical probes: 515 MiB heap with gc alone, 69 MiB with
  the yield. Deleting your own temporaries is good hygiene but does **not**
  substitute — most of the memory belongs to intermediates inside replicad's
  own helpers, which only the registry can reach.
- **Never fuse a model's build shapes on the way out.** They touch (the
  perimeter's seam bulkheads butt face-to-face; a bin's lid sits on its body), so
  a boolean union welds them into one solid and merges the coplanar seam faces
  away — a split liner then opens in Onshape or a slicer as a single body with no
  seams. `src/exports.ts` keeps every format multi-part; `npm run check-exports`
  guards it.
- replicad shape lifetimes are sharp: `makeCompound`/`compoundShapes` calls
  `delete()` on every input, and `clone()` returns a new wrapper around the
  **same** OCCT handle — so cloning before compounding frees geometry the caller
  still holds and faults the kernel nondeterministically later. `exportSTEP` also
  double-frees its `XSControl_WorkSession` (registered for deletion *and* handed
  to a smart pointer), which faults the kernel around the 5th call in a process;
  `cad-session.ts` retires the worker after each STEP export to contain it. Both
  are replicad 0.23.1, the current release.
- OCCT geometry traps encountered: `shell()` fails on tapered rounded-rect
  lofts (build outer/inner lofts and cut instead); extending a cutter past a
  tapered solid's ends leaves boolean debris (use coplanar caps — see
  `perimeter.ts`); degenerate boolean intersections can throw (wrap in
  try/catch, as `slabVolume` does).
- New models: derive dimensions from Fusion parameter expressions where known
  (not magic numbers), register in `src/models/index.ts`, verify with
  `diff-model.mjs`, then add expected bbox/volume to `smoke.mjs` and assign the
  model to one of its `MODEL_UNITS` (its own unit if it is perimeter-scale,
  `bins` if it builds in a few seconds; an unassigned model fails the suite
  rather than going untested). Achieved
  fidelity so far: bin-no-lid 0.02%, bin-double-sided 0.3% volume error;
  all 8 models pass smoke. Document any deliberate gaps (like the with-lid
  lid seat) in the model file's doc comment and the `docs/models.md` table.
- Model *defaults* may intentionally deviate from the Fusion originals for
  printability — the perimeter ships a 3 mm wall / 4 mm floor vs the source's
  1.2 mm / 1 mm liner (see `perimeter.ts` and `docs/models.md` "Intentional
  deviations"). Ground-truth fidelity is asserted at the original thicknesses;
  `smoke.mjs` checks the perimeter by bbox only (no volume), so a default
  thickness change does not regress it. Record such deviations in the model doc
  comment and `docs/models.md`, and if the default drives a self-derived smoke
  volume (e.g. perimeter-square-corners) update that expected value too.
