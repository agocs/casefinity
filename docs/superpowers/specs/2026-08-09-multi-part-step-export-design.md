# Multi-part STEP export

**Date:** 2026-08-09
**Status:** approved

## Problem

A user asked for split perimeter liners that load into Onshape as separate
pieces. Exporting STEP and importing it — into Onshape or into the Bambu
slicer — yields one welded body: the seams are gone and the walls read as a
single plane.

This was suspected to be a STEP limitation, or Onshape and Bambu simplifying
the model on import. It is neither. **We fuse the pieces ourselves before
export.** `src/worker.ts`:

```ts
function fused(modelId: string, params: ParamValues): Shape3D {
  const shapes = buildShapes(modelId, params);
  return shapes.reduce((a, b) => a.fuse(b));   // boolean union
}
```

Both `exportSTL` and `exportSTEP` call it. The split perimeter's seam bulkheads
butt face-to-face — only the dovetail *flanks* carry `dovetailClear` (0.2 mm by
default) — so a boolean union welds the pieces and OCCT merges the now-coplanar
seam faces.

Measured on a 200 x 150 x 60 split perimeter, which `build()` returns as 4
shapes:

| export path | re-imports as | STEP `PRODUCT`s |
| --- | --- | --- |
| `fuse().blobSTEP()` (shipped) | **1 solid** | 1, `Open CASCADE STEP translator 7.6 1` |
| `makeCompound(shapes).blobSTEP()` | 4 solids | 5 (root + 4) |
| `exportSTEP(shapes.map(...{shape, name}))` | 4 solids | 4, `perimeter-part-1..4` |

`docs/printing.md` documents the fuse as intentional. It is the wrong call for
STEP, and for STL it silently welds a bin's lid to its body.

## Format research

For Onshape the split is between formats that import as editable B-rep and
formats that import as mesh (viewable and referenceable, not editable):

- **STEP** (AP203/AP214/AP242) — B-rep. Multi-solid files and assemblies both
  import fine. The import dialog offers a *flatten* option that drops every
  part into one Part Studio in assembly position.
- **Parasolid** (`.x_t`/`.x_b`) — Onshape's own preferred format, but OCCT and
  replicad cannot write it. Out.
- **IGES** — surfaces only, no solid or part structure worth having. Out.
- **3MF** — Onshape imports it, but as **mesh bodies**. Correct for the Bambu
  slicer, which is what we already ship it for; wrong for someone who wants to
  model against the geometry in Onshape.

No new format is needed. The fix is to stop fusing.

## Design

### Exporters converge on named parts

`fused()` is deleted. A new `src/parts.ts` (~20 lines) owns "how a model's
shapes become named parts"; `partNames()` moves there from `three-mf.ts`, since
it is no longer a 3MF concern.

```ts
// src/worker.ts
function namedParts(modelId: string, params: ParamValues) {
  const shapes = buildShapes(modelId, params);
  const names = partNames(modelId, shapes.length);
  return shapes.map((shape, i) => ({ shape, name: names[i] }));
}
```

- **STEP** — replicad's top-level `exportSTEP(namedParts(...))`, which writes an
  XCAF assembly with one named `PRODUCT` per piece.
- **STL** — `makeCompound(shapes).blobSTL({ tolerance: 0.01 })`: disjoint
  shells, no boolean. Still one unnamed triangle soup, but Bambu Studio's
  "split to objects" can separate it and a lid is no longer welded to its body.
- **3MF** — unchanged in behavior; it just reads from the shared helper.

Removing the fuse also removes a boolean union over the largest shapes we build.

### Deliberate tradeoff: assembly, not flat multi-solid

replicad hardcodes `write.step.assembly = 2`, so the output is a product
assembly (root plus N components) rather than one product holding N solids.
Onshape therefore offers its **flatten** checkbox on import, which puts all
pieces in a single Part Studio in assembly position. Forcing a flat file would
mean setting `Interface_Static` behind replicad's back *and* would discard the
part names, since the names live in the assembly structure. Not worth it for
one checkbox.

### Naming

`partNames()` is reused as-is: `perimeter-part-1..4`, `bin-with-lid-part-1/2`,
and the bare model id when a model produces a single shape. STEP and 3MF stay
consistent by construction. Meaningful labels (`body`, `lid`, `rail-+y`) would
need a new `ModelDef` field and, for the perimeter, a *function* — bed-splitting
makes the piece count and roles dynamic. Deferred until someone asks.

### Verification

`scripts/check-3mf.mjs` becomes `scripts/check-exports.mjs`: same five models,
same single expensive build per model, three round-trips instead of one.

- **3MF** — everything it asserts today, unchanged.
- **STEP** — write, re-import via `occt-utils.importStepSolids()`, assert
  `solids.length === shapes.length`, and assert every `partNames()` entry
  appears as a `PRODUCT('...'`. This assertion directly encodes the reported
  bug: today the split perimeter returns 1 where 4 is expected.
- **STL** — assert the file's triangle count equals the sum of the per-shape
  mesh triangle counts at matching tolerance. Cheap, and exactly what a fuse
  breaks: welding the seam merges coplanar faces and changes the count.

`npm run check-3mf` becomes `npm run check-exports`.

**Known risk.** Running several large exports in one Node process produced
`RangeError: Maximum call stack size exceeded` once, when a fuse was also
competing for heap. `check-exports.mjs` does exactly that across five models, so
it may need the `collect()` yield-then-gc pattern from `scaling-test.mjs`
between models. Handle it if it appears rather than pre-engineering.

### Docs

- `docs/printing.md` — the "STL and STEP fuse a model's shapes into a single
  solid" paragraph is now false; rewrite it and add a short **importing into
  CAD** note: use STEP, tick *flatten*, and do not use 3MF for Onshape because
  it arrives as a non-editable mesh body.
- `hardcase-gridfinity-generator/README.md` — script rename and the worker
  export description.
- `docs/models.md` — no change; it does not discuss export formats.

## Out of scope

No new export button, no new file format, no `ModelDef` changes, no geometry
changes. The pieces already exist and are already correct — they were being
destroyed on the way out.
