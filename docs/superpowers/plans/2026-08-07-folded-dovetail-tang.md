# Folded Dovetail Tang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the split perimeter's male dovetail a `wallThick` fold instead of a solid prism, and make its flank angle actually equal `dovetailAngle`.

**Architecture:** Both defects live in one closure, `seamTang` in `splitPieces`
(`src/models/perimeter.ts`). It is replaced by `seamProfile`, a hexagon whose
flank rises at `tan(dovetailAngle)` only *past* the seam plane, taking a signed
perpendicular offset instead of a scalar `grow`. A companion `seamCore` returns
the same shape eroded by `wallThick`, and `splitPieces` cuts those cores out of
the seam bulkheads before fusing them to the frame — so the frame's floor, fused
afterwards, closes the fold at the bottom.

**Tech Stack:** TypeScript, replicad (OCCT WASM), Node ≥ 22.18 with native type
stripping. Tests are `scripts/smoke.mjs`, run via `npm run smoke` — real OCCT,
no mocking framework; assertions are `check(cond, msg)` calls that set a
`failed` flag.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-folded-dovetail-tang-design.md`. It
  amends REQ-2 of `2026-08-07-full-height-dovetails-design.md`.
- **No new parameters.** The joint keeps exactly `dovetailWidth`,
  `dovetailDepth`, `dovetailAngle`, `dovetailClear` (spec REQ-8).
- **Bounding boxes must not move** on `perimeter`, `smooth-perimeter` or
  `perimeter-square-corners` (spec REQ-6). The tip half-width stays
  `w/2 + depth·tan(A)`.
- **A split perimeter build costs ~58 s.** Smoke is ~2 min on the baseline
  commit; this plan adds two builds, so expect ~4 min. Do not add a third —
  reuse the `pieces` the dovetail block already builds.
- All work happens in `hardcase-gridfinity-generator/`; run commands from there.
- Branch `folded-dovetail-tang` is already checked out and already carries the
  spec commit. Do not develop on `main`.
- `src/models/` files are imported by both Vite and Node, so intra-`src/models/`
  imports keep explicit `.ts` extensions and no browser-only APIs.
- Commit after every task.

### Baseline numbers (measured on this branch before any change)

| | |
|---|---|
| `perimeter` split, total volume | 861566 mm³ |
| `perimeter-square-corners` pinned volume | 846992 (`scripts/smoke.mjs:66`) |
| tang flank slope (tan) | 0.4126 — should be 0.5774 |
| tang width at the seam plane | 11.650 mm — should be 10 |
| tang tip width | 15.774 mm — correct, must not move |
| socket flank gap | 0.154 mm — should be 0.2309 (`c·secA`) |
| tang section, x ∈ [splitX+1, splitX+4] × 10 mm high | 387 mm³ at **both** `wallThick` 1.2 and 3.0 |

---

### Task 1: Honest dovetail flank angle

Replace the trapezoid with a hexagon so the flank makes exactly `dovetailAngle`
with the seam axis, `dovetailWidth` is the width at the seam plane, and
`dovetailClear` is a true perpendicular gap.

**Files:**
- Modify: `src/models/perimeter.ts:429-453` (the profile helper and its locals),
  the six call sites at `:538`, `:566`, `:567`, `:583-584`, `:597-598`, and the
  doc-comment reference at `:508`
- Modify: `src/models/perimeter.ts:517` (delete the now-duplicate `wb`)
- Test: `scripts/smoke.mjs`, inside the existing `perimeter full-height dovetail
  joints:` block (lines 172-239) — it already builds the pieces and derives the
  seam, and reusing it saves a 58 s build

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, as closures inside `splitPieces`:
  - `pt(axis: "X" | "Y", a: number, b: number): [number, number]` — seam-local
    to model coordinates, lifted to `splitPieces` scope so Task 2 can use it
  - `seamProfile(axis: "X" | "Y", pos: number, band: number, dir: 1 | -1, d = 0):
    Drawing` — replaces `seamTang`. `d` is a signed perpendicular offset: `0` =
    nominal tang, `c` = socket, `c + wb` = collar
  - locals `tanA`, `secA`, `OVERLAP`, and `wb` hoisted to the top of
    `splitPieces`

- [ ] **Step 1: Write the failing test**

In `scripts/smoke.mjs`, inside the `perimeter full-height dovetail joints:`
block, insert this immediately after the `no interference between pieces` check
(currently line 238) and before the block's closing `}`:

```js
  // --- Profile geometry. Two properties the parameters claim and the old
  // trapezoid did not deliver: the flank makes exactly `dovetailAngle` with
  // the seam axis, and `dovetailWidth` is the tang's width AT THE SEAM PLANE.
  // The old profile ran from pos-2 to pos+depth but flared by only
  // depth*tan(A) across that whole run, so at the defaults the flank came out
  // at 22.4 deg (tan 0.4126) where the parameter said 30, and the neck
  // measured 11.65 mm where it said 10. The TIP half-width was and stays
  // w/2 + depth*tan(A) -- which is why no bounding box moves.
  //
  // Measured on the RAIL piece: past the seam plane a rail carries nothing but
  // its tang, so the outermost y of a thin x-sliver IS the flank. Taken over
  // 10 mm of height at mid-frame, where the tang is ~0.8 mm clear of the
  // tapered outer wall, so nothing clips it.
  const rail = pieces.find((s) => s.boundingBox.bounds[0][1] > 0); // the +Y long rail
  const cap = pieces.find((s) => s.boundingBox.bounds[1][0] > p.overallLength / 2 - 1); // +X end cap

  // Tang half-width at x. The sliver ENDS at x and maxY picks its far edge, so
  // the reading is the flank exactly at x.
  const tangHalfWidthAt = (x) => {
    const tool = drawRectangle(0.5, 40).translate(x - 0.25, yc).sketchOnPlane("XY", 50).extrude(10);
    const { vertices } = rail.clone().intersect(tool).mesh({ tolerance: 0.01, angularTolerance: 5 });
    let maxY = -Infinity;
    for (let i = 1; i < vertices.length; i += 3) maxY = Math.max(maxY, vertices[i]);
    return maxY - yc;
  };
  // Socket half-width at x: the cap's nearest material above the band centre.
  // The sliver STARTS at x and the socket widens outward, so minY reads at x.
  const socketHalfWidthAt = (x) => {
    const tool = drawRectangle(0.5, 20).translate(x + 0.25, yc + 10).sketchOnPlane("XY", 50).extrude(10);
    const { vertices } = cap.clone().intersect(tool).mesh({ tolerance: 0.01, angularTolerance: 5 });
    let minY = Infinity;
    for (let i = 1; i < vertices.length; i += 3) minY = Math.min(minY, vertices[i]);
    return minY - yc;
  };

  const hw2 = tangHalfWidthAt(splitX + 2);
  const hw4 = tangHalfWidthAt(splitX + 4);
  const slope = (hw4 - hw2) / 2;
  const neck = 2 * (hw2 - 2 * slope);
  const wantSlope = Math.tan((p.dovetailAngle * Math.PI) / 180);
  check(
    Math.abs(slope - wantSlope) < 0.01,
    `flank angle equals dovetailAngle (tan ${slope.toFixed(4)} vs ${wantSlope.toFixed(4)}; was 0.4126)`,
  );
  check(
    Math.abs(neck - p.dovetailWidth) < 0.05,
    `tang is dovetailWidth at the seam plane (${neck.toFixed(3)} vs ${p.dovetailWidth}; was 11.650)`,
  );
  // The tip must NOT move: it is what fixes the tang's reach and the bbox.
  const wantTip = p.dovetailWidth + 2 * p.dovetailDepth * wantSlope;
  const tipWidth = 2 * tangHalfWidthAt(splitX + p.dovetailDepth);
  check(
    Math.abs(tipWidth - wantTip) < 0.05,
    `tang tip width unchanged (${tipWidth.toFixed(3)} vs ${wantTip.toFixed(3)})`,
  );
  // dovetailClear is a PERPENDICULAR gap: the socket is the tang offset normal
  // to each face, so the flank gap is c*sec(A). The old profile widened the
  // socket across the band AND stretched its flank over a longer run, which
  // left 0.154 mm where 0.2 was nominally asked for.
  const gap = socketHalfWidthAt(splitX + 2) - hw2;
  const wantGap = p.dovetailClear / Math.cos((p.dovetailAngle * Math.PI) / 180);
  check(
    Math.abs(gap - wantGap) < 0.02,
    `dovetailClear is a perpendicular gap (${gap.toFixed(3)} vs ${wantGap.toFixed(3)}; was 0.154)`,
  );
```

Then extend the block's header comment (currently ending "…any interference
means that clearance was lost and the parts will not assemble.") with:

```
//   - the profile is what the parameters say: flank angle = dovetailAngle,
//     width at the seam plane = dovetailWidth, socket gap = dovetailClear
//     measured perpendicular to the flank.
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run smoke 2>&1 | grep -A12 "full-height dovetail joints"`

Expected: the six pre-existing checks and the tip check pass; these three FAIL:
```
FAIL: flank angle equals dovetailAngle (tan 0.4126 vs 0.5774; was 0.4126)
FAIL: tang is dovetailWidth at the seam plane (11.650 vs 10; was 11.650)
FAIL: dovetailClear is a perpendicular gap (0.154 vs 0.231; was 0.154)
```

- [ ] **Step 3: Hoist the profile locals**

In `src/models/perimeter.ts`, replace lines 429-433:

```ts
  const w = p.dovetailWidth;
  const depth = p.dovetailDepth;
  const flare = depth * Math.tan((p.dovetailAngle * Math.PI) / 180);
  const c = p.dovetailClear; // socket grown by this; tang stays nominal
  const big = Math.max(p.overallLength, p.overallWidth); // generous half-plane bound
```

with:

```ts
  const w = p.dovetailWidth;
  const depth = p.dovetailDepth;
  const tanA = Math.tan(deg(p.dovetailAngle));
  const secA = 1 / Math.cos(deg(p.dovetailAngle));
  const c = p.dovetailClear; // socket offset by this; tang stays nominal
  const wb = p.wallThick; // the bulkhead's thickness, and the fold's own
  const OVERLAP = 2; // how far a profile's base sits inside its owning piece
  const big = Math.max(p.overallLength, p.overallWidth); // generous half-plane bound
```

Then delete the now-duplicate `const wb = p.wallThick;` at what is currently
line 517, just above `const seams: Seam[] = [];`.

- [ ] **Step 4: Replace the profile helper**

Replace the whole `seamTang` closure — lines 435-453, its comment included —
with:

```ts
  /** Seam-local (along-axis, across-axis) to model (x, y). */
  const pt = (axis: "X" | "Y", a: number, b: number): [number, number] =>
    axis === "X" ? [a, b] : [b, a];

  // Dovetail profile crossing a seam. `axis` is the direction the tang
  // protrudes (and along which the joint locks): "X" for a seam cutting a long
  // rail, "Y" for one cutting an end cap. `pos` is the seam coordinate on that
  // axis, `band` the centre coordinate on the other axis, `dir` = +/-1 the
  // protrusion direction.
  //
  // A hexagon, not a trapezoid: behind the seam plane it is a constant-width
  // rectangle, and only past the seam does the flank rise at tan(angle). That
  // is what makes `dovetailAngle` the true flank angle and `dovetailWidth` the
  // true width at the seam plane. An earlier trapezoid ran the flare across
  // the base overlap as well, flattening the flank to 22.4 deg at the
  // defaults. The base sits OVERLAP inside the owning piece so the fuse
  // overlaps with no coincident-face sliver; the flared tip is what locks.
  //
  // `d` is a SIGNED PERPENDICULAR offset, which is what makes `dovetailClear`
  // a real normal gap: offsetting a flank by `d` moves it `d * secA` across the
  // band, while the tip face moves `d` along the axis. The base face does not
  // move -- it lives inside the owning piece and exists only to avoid that
  // sliver.
  const seamProfile = (axis: "X" | "Y", pos: number, band: number, dir: 1 | -1, d = 0): Drawing => {
    const hwBase = w / 2 + d * secA;
    const reach = depth + d;
    const hwTip = hwBase + reach * tanA;
    const a0 = pos - dir * OVERLAP;
    const a1 = pos + dir * reach;
    const q = (a: number, b: number) => pt(axis, a, b);
    return draw(q(a0, band - hwBase))
      .lineTo(q(a0, band + hwBase))
      .lineTo(q(pos, band + hwBase))
      .lineTo(q(a1, band + hwTip))
      .lineTo(q(a1, band - hwTip))
      .lineTo(q(pos, band - hwBase))
      .close();
  };
```

- [ ] **Step 5: Update the call sites**

Rename `seamTang` → `seamProfile` at each; no argument changes.

- line 538 (in `footprint`): `web(s).fuse(seamProfile(s.axis, s.pos, s.band, s.dir, c + wb))`
- line 566: `region = region.fuse(seamProfile(axis, cuts[i], band, 1));`
- line 567: `region = region.cut(seamProfile(axis, cuts[i - 1], band, 1, c));`
- lines 583-584: `.fuse(seamProfile("X", splitX, sy * yc, 1))` and `.fuse(seamProfile("X", -splitX, sy * yc, -1))`
- lines 597-598: `.cut(solid(seamProfile("X", ex * splitX, yc, ex, c)))` and `.cut(solid(seamProfile("X", ex * splitX, -yc, ex, c)))`

And the doc-comment reference at line 508, which reads ``the socket footprint
dilated by one wall thickness, `seamTang(...,`` — change `seamTang` to
`seamProfile`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run smoke 2>&1 | grep -A12 "full-height dovetail joints"`

Expected: all ten checks OK, reporting `tan 0.5774`, neck `10.000`, tip
`15.774`, gap `0.231`.

- [ ] **Step 7: Re-pin the self-derived volume**

`perimeter-square-corners` carries a self-derived volume at
`scripts/smoke.mjs:66` (currently `846992`). Run `npm run smoke 2>&1 | grep -A3
"^perimeter-square-corners"` and read the volume the run reports — the line
prints the actual whether it passes or fails. Set the pin to that number, and
append one sentence to the comment block above it in the style of the sentences
already there, filling in the real delta:

```
  // The honest flank angle then removed <delta>: the hexagonal profile holds
  // the tang at dovetailWidth back to the base overlap instead of letting the
  // flare widen it there, so tang and collar both lose a sliver at the neck.
```

Re-run `npm run smoke` and confirm the model reports OK.

- [ ] **Step 8: Type-check**

Run: `npm run build`
Expected: no TypeScript errors. `flare` is gone — if `tsc` reports it still
referenced, a call site was missed in Step 5.

- [ ] **Step 9: Commit**

```bash
git add src/models/perimeter.ts scripts/smoke.mjs
git commit -m "Dovetail flank angle is now dovetailAngle

The seam profile was a trapezoid from pos-2 to pos+depth that flared by
only depth*tan(A) over that whole run, so the flank came out at 22.4 deg
where the parameter said 30, and dovetailWidth was the width nowhere in
particular. It is now a hexagon: constant width back to the base overlap,
flaring only past the seam plane. The tip is unchanged, so no bbox moves.

grow becomes a signed perpendicular offset, which also makes dovetailClear
a true normal gap (0.231 mm at the defaults) rather than a widening across
the band that measured 0.154.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WLZHgSskjzVEpeXFCAqiQ6"
```

---

### Task 2: Fold the tang to one wall thickness

**Files:**
- Modify: `src/models/perimeter.ts` — add `seamCore` after `seamProfile`; change
  the `joined` construction (currently line 540)
- Modify: `src/models/perimeter.ts:39` and `:486-516` (doc comments)
- Test: `scripts/smoke.mjs`, same block Task 1 extended

**Interfaces:**
- Consumes: `seamProfile`, `pt`, `wb`, `tanA`, `secA`, `w`, `depth` from Task 1;
  `wantSlope` from Task 1's test code, and `pieces`, `splitX`, `yc`, `p`,
  `model`, `check`, `drawRectangle` from the enclosing smoke block.
- Produces: `seamCore(axis: "X" | "Y", pos: number, band: number, dir: 1 | -1):
  Drawing | null` — the tang's void, or `null` where the erosion degenerates.

- [ ] **Step 1: Write the failing test**

Append to the same smoke block, immediately after Task 1's `dovetailClear is a
perpendicular gap` check:

```js
  // --- The fold. The tang is a wallThick shell, not a solid prism, so its
  // section area must DEPEND on wallThick. Before this it was identical at 1.2
  // and 3.0 -- 12.47 / 13.30 / 14.12 / 14.95 mm2 per mm of x at x = 143..146,
  // in both cases exactly the nominal trapezoid width -- because the tang
  // footprint was materialised solid and wallThick entered only the socket's
  // collar. Section taken over x in [splitX+1, splitX+4], 10 mm of height at
  // mid-frame. One extra build (~58 s); the 3.0 case reuses `pieces`.
  const sectionOf = (built, x0, dx) => {
    const r = built.find((s) => s.boundingBox.bounds[0][1] > 0);
    const tool = drawRectangle(dx, 40).translate(x0 + dx / 2, yc).sketchOnPlane("XY", 50).extrude(10);
    return measureVolume(r.clone().intersect(tool));
  };
  const thick = sectionOf(pieces, splitX + 1, 3);
  const thin = sectionOf(model.build({ ...p, wallThick: 1.2 }), splitX + 1, 3);
  check(
    thin < thick * 0.5,
    `tang folds to wallThick (section ${thin.toFixed(0)} mm3 at 1.2 vs ${thick.toFixed(0)} at 3.0; ` +
      `both were 387 before)`,
  );

  // Degeneracy (spec REQ-4): once wallThick*secA exceeds the tang's half-width
  // there is no core left to remove, and the tang must come out solid with no
  // branch in the caller and no throw. At wallThick 4.5 the eroded half-width
  // 5 - 4.5*secA is negative. Measured over [splitX+1, splitX+2] only --
  // further out, a wall that thick clips the tang. This one passes before the
  // change too: it guards the new branch, it does not drive it.
  const stout = sectionOf(model.build({ ...p, wallThick: 4.5 }), splitX + 1, 1);
  const wantStout = 10 * (p.dovetailWidth + 2 * 1.5 * wantSlope); // solid, 1 mm of x, 10 mm high
  check(
    Math.abs(stout - wantStout) / wantStout < 0.05,
    `tang stays solid where the fold degenerates (${stout.toFixed(0)} vs ${wantStout.toFixed(0)} mm3)`,
  );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run smoke 2>&1 | grep -A16 "full-height dovetail joints"`

Expected: the degeneracy check passes, and the fold check FAILS with the two
sections roughly equal:
```
FAIL: tang folds to wallThick (section 387 mm3 at 1.2 vs 387 at 3.0; both were 387 before)
```

- [ ] **Step 3: Add the core helper**

In `src/models/perimeter.ts`, immediately after the `seamProfile` closure:

```ts
  // The tang's void. `seamProfile` eroded by one wall thickness, with its base
  // face ON the seam plane rather than at the base overlap: the piece's end web
  // occupies [pos - wb, pos] and has to survive as the fold's back wall, so the
  // hollow starts where that web ends. Cutting this from the seam bulkheads is
  // what turns a solid dovetail prism into a wall-thickness fold -- which is
  // what the ground truth does (its rail shows two 1.2 mm flanks and nothing
  // between them across the tang band) and what a thin-walled frame obviously
  // wants: at wallThick 1.2 the solid tang was a 110 x 14 x 5 mm slug hanging
  // off a 1.2 mm ribbon.
  //
  // Returns null once the erosion eats the profile: past that thickness there
  // is no core to remove and the tang is simply solid -- no caller branch, no
  // new parameter. Both degeneracies are checked: the flanks meeting in the
  // middle, and the tip face reaching back past the seam plane.
  const seamCore = (axis: "X" | "Y", pos: number, band: number, dir: 1 | -1): Drawing | null => {
    const hwBase = w / 2 - wb * secA;
    const reach = depth - wb;
    if (hwBase < 0.05 || reach < 0.05) return null;
    const hwTip = hwBase + reach * tanA;
    const a1 = pos + dir * reach;
    const q = (a: number, b: number) => pt(axis, a, b);
    return draw(q(pos, band - hwBase))
      .lineTo(q(pos, band + hwBase))
      .lineTo(q(a1, band + hwTip))
      .lineTo(q(a1, band - hwTip))
      .close();
  };
```

- [ ] **Step 4: Cut the cores out of the bulkheads**

Replace line 540, currently:

```ts
  const joined = frame.fuse(channelSolid(p, wallInner, footprint));
```

with:

```ts
  // Hollow the tangs BEFORE the frame is fused in: the floor lives in `frame`,
  // so fusing afterwards closes the fold at the bottom and leaves it open at
  // the top -- it prints without support and still assembles by sliding down.
  // The socket piece's region already subtracts the clearance-grown tang, so it
  // never owned the material being removed here and needs no change.
  const bulkheads = channelSolid(p, wallInner, footprint);
  const cores = seams
    .map((s) => seamCore(s.axis, s.pos, s.band, s.dir))
    .filter((d): d is Drawing => d !== null);
  const joined = frame.fuse(
    cores.length ? (bulkheads.cut(solid(cores.reduce((a, b) => a.fuse(b)))) as Shape3D) : bulkheads,
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run smoke 2>&1 | grep -A16 "full-height dovetail joints"`

Expected: all twelve checks OK. The fold check should report roughly
`section 107 mm3 at 1.2 vs 339 at 3.0`.

- [ ] **Step 6: Confirm the joint checks still hold**

Two of the pre-existing checks in that block are the ones this change could
break, so read them rather than skim:

- `no interference between pieces` — the fold must not have opened a path for
  tang and socket to overlap.
- `tang-side material at the seam (600 mm3)` — the threshold `railSide > 300`
  was written against a solid tang. If it now fails, the fold removed more than
  intended; check that `seamCore`'s base face is on the seam plane and not at
  the base overlap, which would eat into the end web.

- [ ] **Step 7: Check dividers have not refilled the fold**

The spec flags this: dividers are fused per piece *after* the joint is built,
and at the defaults `splitX` is a grid-module boundary, so a divider can land
near a seam.

Run: `node scripts/render-mesh.mjs model:perimeter /tmp/fold 900`

Read `/tmp/fold-z.png` and confirm the four corner dovetails read as outlines
rather than filled blocks. Step 5's check is the real assertion; this is a look
at what it means.

- [ ] **Step 8: Re-pin the self-derived volume**

As in Task 1 Step 7: run `npm run smoke 2>&1 | grep -A3
"^perimeter-square-corners"`, read the reported volume, update the pin at
`scripts/smoke.mjs:66`, and append a sentence recording the cause with the real
number:

```
  // Folding the tangs then removed <delta>: four seam dovetails hollowed to
  // one wall thickness.
```

- [ ] **Step 9: Update the doc comments**

Two places in `src/models/perimeter.ts` state the tang is solid.

Line 39, in the model's top doc comment, reads:
```
 * dovetail runs through it as a vertical prism — solid tang on one piece, matching
```
Change `solid tang on one piece` to `a `wallThick` fold on one piece`.

In the "Full-height joint" block (from line 486), the table line
```
   *                -> end web + a SOLID dovetail prism
```
becomes `-> end web + a dovetail folded to wallThick`, and add to that block:

```
   * The tang is a FOLD, not a solid: seamCore removes its interior, so the
   * dovetail is one wall thick all round — like the rest of the frame, and like
   * the ground truth. Above roughly wallThick = w/2 * cos(angle) the erosion
   * degenerates and it comes out solid again on its own.
```

- [ ] **Step 10: Type-check and commit**

```bash
npm run build
git add src/models/perimeter.ts scripts/smoke.mjs
git commit -m "Fold the dovetail tang to one wall thickness

The male dovetail was a solid prism whose size never changed with
wallThick -- at 1.2 mm walls, a 110x14x5 mm slug hanging off a 1.2 mm
ribbon, four times over. The ground truth folds the bulkhead sheet into a
hollow dovetail instead, and so does this now.

seamCore erodes the profile by wallThick and splitPieces cuts it from the
seam bulkheads before the frame is fused, so the floor closes the fold at
the bottom and it prints without support. Where the erosion degenerates
the tang stays solid, which keeps the shipped 3 mm default sensible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WLZHgSskjzVEpeXFCAqiQ6"
```

---

### Task 3: Whole-model verification sweep

No code changes expected. This is the gate that says the change is sound beyond
the two properties Tasks 1-2 asserted.

**Files:**
- Modify (only if a check fails): `src/models/perimeter.ts`

**Interfaces:**
- Consumes: the finished geometry from Tasks 1-2.
- Produces: measurements Task 4 writes into the docs.

- [ ] **Step 1: Full smoke**

Run: `npm run smoke`
Expected: every model OK. Specifically `perimeter` and `smooth-perimeter`
bboxes still `350.00 x 250.00 x 110.00` (spec REQ-6), and
`perimeter-square-corners` matching its re-pinned volume.

- [ ] **Step 2: Fidelity against the ground truth**

Run:
```bash
node scripts/diff-model.mjs perimeter ground-truth/Hardcase_Gridfinity_Perimeter.step
```

The ground truth is a 1.2 mm liner, the configuration the fold was designed for.
Record excess and missing volume. Expected: excess volume **falls** relative to
`main` — the solid tangs were material the ground truth does not have. For the
before number, run the same command against a `git stash`ed tree or a second
checkout of `main`; record both.

- [ ] **Step 3: Bed-split configurations**

Run: `npm run scaling perimeter`
Expected: every piece one clean solid and inside the bed, as before. Each seam
now carries one extra boolean, so this is also the check that the WASM heap
still holds on the heaviest splits.

- [ ] **Step 4: The other two variants build**

```bash
node scripts/render-mesh.mjs model:smooth-perimeter /tmp/sp 600
node scripts/render-mesh.mjs model:perimeter-square-corners /tmp/psc 600
```
Expected: both complete without throwing. They share `splitPieces`, and
`perimeter-square-corners` has a narrower channel at the corner seams, where an
over-eager core cut would show up first.

- [ ] **Step 5: Export path**

```bash
npm run test:session
npm run check-3mf
```
Expected: both pass. `check-3mf` builds several models, generates the 3MF, and
asserts each part's mesh is watertight and wound outward — the fold adds
interior faces, so this is the check that they came out consistently oriented.

- [ ] **Step 6: Commit any fixes**

If Steps 1-5 required changes, commit them with a message naming the check that
caught the problem. If nothing changed, record the recorded numbers in the task
notes and make no commit.

---

### Task 4: Documentation

**Files:**
- Modify: `docs/models.md` (perimeter paragraph at :30, Known limitations at :216)
- Modify: `docs/printing.md` (Dovetail clearance at :32, How the pieces join at :65)
- Modify: `docs/reverse-engineering.md` ("Perimeter (the flagship)", from :93)
- Modify: `docs/superpowers/specs/2026-08-07-full-height-dovetails-design.md` (REQ-2)

- [ ] **Step 1: `docs/models.md`**

In the perimeter paragraph, this sentence:

> Every seam is closed by a full-height bulkhead with the dovetail running
> through it as a vertical prism, so the pieces lock together from the floor to
> the rim and assemble by sliding together vertically.

becomes:

> Every seam is closed by a full-height bulkhead with the dovetail running
> through it as a vertical prism — folded to one wall thickness, like the rest
> of the frame — so the pieces lock together from the floor to the rim and
> assemble by sliding together vertically.

Then add to "Known limitations":

> - **Thick walls give a solid tang.** The dovetail is folded to `wallThick`,
>   but above roughly `dovetailWidth/2 · cos(dovetailAngle)` the erosion has
>   nothing left to remove and the tang comes out solid. That is the intended
>   degradation, not a gap — a fold thinner than the wall would be the defect.

- [ ] **Step 2: `docs/printing.md`**

Replace the "Dovetail clearance" bullet:

> - **Dovetail clearance** (`dovetailClear`, default `0.2`) opens a slide-fit
>   gap between the side-piece tang and the end-piece socket, measured
>   **perpendicular to the dovetail flank**. It does not affect the bounding
>   box. `0.2` is usually right; increase it if the pieces bind. (Before
>   Aug 2026 the same number produced a ~0.15 mm flank gap, so if you had
>   dialled this in for your printer, re-check the fit on one seam first.)

In "How the pieces join", replace:

> The dovetail runs through it as a **vertical prism**: a solid tang on one
> piece, a matching slot on the other.

with:

> The dovetail runs through it as a **vertical prism**: a tang on one piece, a
> matching slot on the other. The tang is **folded to one wall thickness**, not
> solid — the same ribbon of wall as the rest of the frame, which is what the
> original design does. So a seam costs little extra filament and never buries a
> solid slug in the middle of a thin-walled part. At heavy wall thicknesses the
> fold has nothing left to hollow and the tang is simply solid.

Add to the same section:

> `dovetailWidth` is the tang's width **at the seam plane**, and
> `dovetailAngle` is the true angle of its flank.

- [ ] **Step 3: `docs/reverse-engineering.md`**

Under "Perimeter (the flagship)", add a subsection recording the ground-truth
measurement that drove this. Copy the numbers from the spec's "What the ground
truth does": the 4 solids and their extents, the per-mm-of-x section table at
mid-height, and the reading — bulkhead at x ≈ 32.6…33.8 (1.2 mm across the
~25 mm border ⇒ ~25 mm²/mm); tip face at 28.79…29.99 (9.19 mm²/mm, i.e. a 1.2 mm
wall ~7.7 mm wide); flanks only at 30…32.6 (2.77 mm²/mm) — therefore the tang is
hollow. Note the port reproduces it via `seamCore`.

- [ ] **Step 4: Point the superseded requirement at its amendment**

In `docs/superpowers/specs/2026-08-07-full-height-dovetails-design.md`, REQ-2
says thin-walling the tang "is not reproduced". Add a parenthetical directly
under it pointing at `2026-08-07-folded-dovetail-tang-design.md`, which amends
it. Do not rewrite the requirement — the spec is history.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "Docs: the dovetail tang is a fold, and the angle is honest

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WLZHgSskjzVEpeXFCAqiQ6"
```

---

## Done when

- `npm run smoke` passes, including the six new checks in the dovetail block
  (flank angle, seam-plane width, tip unchanged, perpendicular clearance, the
  fold, and the degeneracy guard).
- `npm run build`, `npm run test:session` and `npm run check-3mf` are clean.
- `perimeter` / `smooth-perimeter` bboxes unmoved; `perimeter-square-corners`
  volume re-pinned with its delta explained in the comment.
- `docs/models.md`, `docs/printing.md`, `docs/reverse-engineering.md` and the
  amended spec all reflect the fold.
- Branch `folded-dovetail-tang` merged to `main` and pushed — see
  `superpowers:finishing-a-development-branch`.
