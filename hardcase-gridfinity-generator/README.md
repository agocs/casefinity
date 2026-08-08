# Developer guide

The Casefinity app: a Vite + TypeScript static site running replicad (an
OpenCascade B-rep kernel compiled to WASM) in a web worker. No backend.

For what the models are and how faithful they are, see
[docs/models.md](../docs/models.md). For how they were reconstructed, see
[docs/reverse-engineering.md](../docs/reverse-engineering.md). For print advice,
see [docs/printing.md](../docs/printing.md).

## Commands

```bash
npm install
npm run dev          # dev server
npm run build        # type-check (tsc) + production build → dist/
npm run smoke        # build every model in Node, verify against ground truth
npm run test:session # CadSession concurrency unit test (no OCCT, ~1 s)
npm run check-3mf    # verify .3mf exports: package structure + watertight,
                     # outward-wound meshes
npm run scaling      # parametric invariant harness
npm run build-spec   # re-render docs/casefinity-spec.md → public/casefinity-spec.html
```

**Requires Node 22.18 or newer** (or 23.6+). The test and analysis scripts import
the TypeScript model sources directly and rely on Node's built-in type stripping,
which is only enabled by default from those versions on.

### What the test suites check

**`npm run smoke`** is the main gate. It builds every registered model headlessly
in Node with the real OCCT kernel and asserts bounding boxes and volumes against
the ground truth. Expected values live in a table at the top of
`scripts/smoke.mjs`. It also asserts specific *features* where a volume check
alone would not catch a functional regression — notably the with-lid retention
interference, which must be present **and** confined to the lock zone.

It runs as a pool of child processes, one per *unit* (`node scripts/smoke.mjs`
with no argument is the pool; `node scripts/smoke.mjs <unit>` runs one in the
foreground, and `SMOKE_JOBS` caps the pool, default 6). The split is not only
for wall clock — 95 s instead of ~7 min here — but for memory: the OCCT WASM
module hard-codes a 2 GiB maximum heap **per process**, and three
perimeter-scale builds in one process used to abort. No unit holds more than one
of them, so each gets a fresh 2 GiB and a new check need not budget against a
shared heap. Every registered model must be assigned to a unit in `MODEL_UNITS`;
the `bins` unit fails the suite if one is not.

**`npm run scaling`** builds every model across a spread of parameter values and
asserts invariants that must hold at *any* parameters, catching hardcoded
constants and non-scaling logic without a Fusion round-trip. For example: the
double-sided floor tracks `OVERALL_HT/2`; every perimeter piece is one clean
solid; the bounding box matches the parameter formula. Each model runs in its own
process, because the OCCT WASM heap is small. Treat it as a regression gate —
green unless a *new* invariant breaks. A couple of pre-existing fragilities are
marked `XFAIL`.

**`npm run check-3mf`** validates every model's 3MF package structure and confirms
each part's mesh is watertight and outward-wound. 3MF stores no facet normals, so
orientation is winding-only.

## Architecture

- **`src/models/`** — one file per model, each exporting a `ModelDef`: a parameter
  schema plus a `build()` returning replicad shapes. The schema drives the
  auto-generated UI form, and each parameter's `fusionName` ties it back to the
  original Fusion 360 user parameter in
  [docs/f3d-parameters.md](../docs/f3d-parameters.md). A `ModelDef` may also
  declare optional `groups` (collapsible form sections, in display order) and
  `presets` (a dropdown that fills in a set of values). An individual parameter
  may carry a `hint(values)` — a live annotation rendered beside a narrowed
  input, re-evaluated on every edit, so it can derive from other parameters (the
  bins' `= NN mm` module conversion). See `src/models/types.ts`.
- **`src/models/bin-common.ts`** — shared bin construction: `buildBinBody`,
  `binParams`, `box`, `moduleCenters`, `addInterlockRibs`, `addPullTab`.
- **`src/models/registration.ts`** — the interlock interface dimensions, kept
  deliberately independent of wall thickness so parts printed at different wall
  thicknesses still mate.
- **`src/worker.ts`** — comlink-exposed web worker. Loads the OCCT WASM kernel
  once (`replicad-opencascadejs`), builds and meshes models, and exports
  STL/STEP/3MF blobs.
- **`src/cad-session.ts`** — owns the CAD worker and serializes work on it. A newer
  build **preempts** the in-flight one by terminating and respawning the worker,
  rather than queueing behind it: OCCT builds are synchronous WASM with no
  cancellation point, so `terminate()` is the only way to stop one. Exports are
  never preempted; a build requested during an export parks in a single
  latest-wins slot. It takes an injected spawn function, so it holds no browser
  globals and is unit-testable in Node (`npm run test:session`).
- **`src/three-mf.ts`** — dependency-light 3MF writer (meshes → OPC ZIP via
  `fflate`), one `<object>` per shape so multi-part models split into parts.
- **`src/viewer.ts`** — three.js viewport, Z-up, orbit controls.
- **`src/params-form.ts`** — renders the parameter form from a `ModelDef` schema.
- **`src/main.ts`** — UI wiring: model selector, debounced parameter form, viewer,
  export buttons.

## Analysis tooling

`scripts/occt-utils.mjs` is the shared Node bootstrap for the OCCT kernel, plus
compound-aware STEP import and slab/occupancy helpers. Every analysis script
builds on it, and `render-lib.mjs` holds the pure-JS PNG depth renderer.

```bash
node scripts/diff-model.mjs <modelId> <truth.step>          # THE fidelity check
node scripts/diff-aligned.mjs <modelId> <truth.step>        # same, recentered
node scripts/analyze-step.mjs <file.step> [x|y|z]           # solids, bbox, planes
node scripts/probe-step.mjs <file.step> <axis> <from> <to> <step>
node scripts/render-mesh.mjs '<file.step>[#i] | model:<id>' <prefix> [size]
```

See [docs/reverse-engineering.md](../docs/reverse-engineering.md) for how these fit
together into a porting workflow.

## Conventions and gotchas

- **Ports are modeled Z-up**, centered on XY, `z=0` at the bottom. The STEP ground
  truth is Y-up — rotate 90° about X to compare
  (`shape.rotate(90, [0,0,0], [1,0,0])`). `diff-model.mjs` already does this.
- **Model sources are imported by both Vite and Node** (native type-stripping), so
  intra-`src/models/` imports must use explicit `.ts` extensions
  (`allowImportingTsExtensions` is on), and models must stay free of browser-only
  APIs.
- **The emscripten OCCT build is an ES module that references CJS globals** in
  Node. `occt-utils.mjs` and `smoke.mjs` shim `globalThis.require` and
  `globalThis.__dirname` before importing it — reuse that bootstrap rather than
  importing `replicad-opencascadejs` directly.
- **`importSTEP` returns a `Compound`** for multi-solid files, and booleans on
  compounds silently misbehave — always explode via
  `occt-utils.importStepSolids()` first.
- A `key` listed in a `ModelDef` group **must exist in `params` and appear in
  exactly one group**, or `params-form.ts` renders it twice or drops it to the top.
- More OCCT geometry traps are collected in
  [docs/reverse-engineering.md](../docs/reverse-engineering.md#occt-traps).

## Adding a model

1. Create `src/models/<name>.ts` exporting a `ModelDef` — copy `perimeter.ts`;
   bins should reuse `bin-common.ts`.
2. Derive dimensions from the Fusion parameter expressions in
   [docs/f3d-parameters.md](../docs/f3d-parameters.md) where known, not from magic
   numbers.
3. Register it in `src/models/index.ts`.
4. Verify with `node scripts/diff-model.mjs <id> <truth.step>`.
5. Add the expected bounding box and volume to `scripts/smoke.mjs` and assign
   the model to a unit in that file's `MODEL_UNITS` — a perimeter-scale model
   gets its own, a cheap one joins `bins` — then run `npm run smoke`.
6. Document it in [docs/models.md](../docs/models.md) — including its form layout
   and any deliberate gaps.

## The spec page

`docs/casefinity-spec.md` is rendered to a self-contained, theme-aware HTML page
served at `/casefinity-spec.html`. The output is committed, so a plain
`npm run build` does not need the source. Re-run `npm run build-spec` after
editing the spec.

## Deployment

The app is fully static, so `wrangler.toml` declares an assets-only Cloudflare
Worker: no `main` script, just `dist/`. The deploy command configured in the
Cloudflare build settings is:

```bash
npx wrangler deploy
```
