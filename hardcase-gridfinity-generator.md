---
name: hardcase-gridfinity-generator
description: "Chris's project to turn Hardcase Gridfinity Fusion 360 models into a browser-based parametric generator website"
metadata: 
  node_type: memory
  type: project
  originSessionId: f15b0a98-c88e-4314-99b8-94b379279470
---

Goal: build a parametric model generator website (like gridfinitygenerator.com / gridfinity.perplexinglabs.com) from five Hardcase Gridfinity `.f3d` files in ~/Downloads/drive-download-20260714T004100Z-1-001 (1. Template, 2. Perimeter ×2, 3. Bins ×3).

Decisions/findings (as of 2026-07-13):
- No open tooling reads .f3d parametric data; plan is to re-implement the 5 models as code, not convert.
- Recommended stack: Replicad (OCCT WASM) for the browser kernel; static site, web worker, STL+STEP export. OpenSCAD-wasm+Manifold is the fallback.
- Intermediate format: JSON parameter schema per model + one TS modeling function per model; STEP files as regression ground truth.
- Full user-parameter tables (names, defaults, expressions) were string-mined from the .f3d binaries → saved in `f3d-extracted-parameters.md` in the models dir. A few unitless defaults (e.g. LENGTH_MODULE_NUMBER) couldn't be paired and need checking in Fusion.
- STEP ground truth obtained via APS Model Derivative API (`aps_f3d_to_step.py` in models dir) → `step_output/*.step`, all 5 verified (perimeter bbox exactly 350×250×110 mm matching params). Chris has an APS app; the client secret he pasted in chat on 2026-07-13 should be treated as compromised/rotated.
- Chris is on Linux; Fusion 360 has no Linux version (VM or cryinkfly Wine installer if the timeline view is ever needed).
- Open question: license of the Hardcase Gridfinity designs (not Chris's own?) before publishing a generator site.
- Scaffold built 2026-07-13 in `hardcase-gridfinity-generator/` (inside the models dir): Vite 8 + TS + replicad 0.23 in a comlink web worker, three.js viewer, auto-generated param form, STL/STEP export. `npm run smoke` builds models in Node (native TS type-stripping; needs `.ts` import extensions + globalThis.__dirname/require shim for the emscripten ESM) and checks bbox vs ground truth — perimeter shell passes exact 350×250×110.
- Machine notes: Bazzite (immutable Fedora); node v26 installed via Homebrew (/home/linuxbrew/.linuxbrew/bin not on PATH in fresh shells for this harness — prefix commands).
- Geometry gotchas learned: OCCT shell() fails on tapered rounded-rect lofts; overshooting a tapered cutter past the solid leaves boolean debris — use coplanar-capped cutters instead.
- Porting state (2026-07-14): DONE — bin-no-lid (0.02% vol), bin-with-lid v1, **perimeter** (full: U-channel border + grid bumps + dovetail 4-piece split + configurable dividers + case bottom-radius + print clearances — see [[perimeter-geometry]]), **smooth-perimeter** (reuses perimeter build at 42mm grid, bumps off). IN PROGRESS — **double-sided bin** (measurements + plan in [[bin-double-sided]]; bin-common refactored to export `addInterlockRibs`/`addPullTab`, verified). TODO — perimeter template (2 thin 1mm test cross-section strips, lowest value). Repo is clean/green: `npm run smoke` passes all 4 registered models; tsc 0.
- New tooling this round: `scripts/diff-aligned.mjs` (recenters port+truth on XY before diffing — needed for the perimeter, which lands in +X/+Y quadrant after the Y-up→Z-up rotation). GOTCHA: the shared `slab()` intersect gives a WRONG bbox on lofted solids (returns the top section); works on imported STEP. Use measureVolume/mesh to check a loft's taper, not slab-bbox.
- `src/models/perimeter.ts` now exports `perimeterParams` + `buildPerimeter` so variants (smooth-perimeter.ts) reuse them via bin-common's `withDefaults`.
- Reverse-engineering harness in scripts/: analyze-step (plane histograms), probe-step (slab volumes), render-mesh (depth-map PNGs — the fastest way to "see" STEP geometry), diff-model (boolean excess/missing vs truth), occt-utils (compound explode via TopExp; importSTEP returns Compound for multi-solid files and booleans on compounds silently misbehave — always explode first!).
- Bin interlock design decoded: exterior ribs (WALL_THICK wide, WALL_BUMP proud) at module centers on two faces; opposite walls have through-slots (WALL_THICK+2*CLEAR) backed by interior bosses (slot+2*WALL_THICK wide) — neighbor's rib snaps in. Tab = +Y wall extended PULL_TAB_HT with drafted pull slot; gussets = side walls tapering 45°.
- Harness quirk seen: Bash tool intermittently fails with "undefined is not an object (evaluating 'e.length')" on commands with export/env-prefix/double-quoted -e args; workaround = absolute paths (/home/linuxbrew/.linuxbrew/bin/node) and single quotes.
