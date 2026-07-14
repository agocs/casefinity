---
name: bin-double-sided
description: DONE — ported to src/models/bin-double-sided.ts (volume 0.3% off, smoke passes)
metadata: 
  node_type: memory
  type: project
  originSessionId: 842fd133-22d2-4572-b373-1785271c3077
---

✅ **DONE.** Ported to `src/models/bin-double-sided.ts`. All 5 models pass smoke.

The hopper is approximated with a loft cut (truncated pyramid) instead of a true fillet; volume is within 0.3% of ground truth. The original plan below is preserved for reference.

---

## Original plan (for reference)

Porting `Hardcase_Gridfinity_Bin Double Sided.step` (part of [[hardcase-gridfinity-generator]]). NOT started as a file yet; the `bin-common` refactor that enables it IS done and verified.

## Ground-truth structure (3 solids)
- **Body** (solid 1): 61.3 × 115 × 61.3, i.e. **4×4 modules** (4·15 − 0.2 + 1.5 = 61.3), 110 tall + 5 pull tab. An open tube (open at BOTH ends), with a **central floor** and interlock ribs.
- **2 lids** (solids 0, 2): 57.4 × 3.3 × 58.4 plates. Bottom lid at y=0–3.3, top lid at y=106.7–110 (Y-up frame). Inset ~2 mm from the tube; LID_THICK≈3.3.
- Body vol 68178; each lid ~9.6k.

## Body detail
- **Interlock ribs**: same pattern as the other bins — ribs (WALL_BUMP proud) on the -X and -Z faces, sockets (slot + interior boss) on +X and +Z. Reuse `addInterlockRibs`.
- **Central floor**: a thin slab fully solid at y≈53–56, with a big **concave "hopper" fillet (r≈18, BOTTOM_FILLET_FACTOR=2.3)** on its BOTTOM face ramping from y≈35 up to y≈53 (fillet on the bottom-compartment side only; top side is ~flat). Floor is near the mid-height (bin center y=55).
- **Pull tab** at y=110 (top), like the regular bin. Reuse `addPullTab`.

## bin-common refactor (DONE, verified — bins still pass smoke)
Extracted from the monolithic buildBinBody, both exported:
- `addInterlockRibs(bin, w, d, h, p, bossZ0)` — ribs + sockets; bossZ0 = where interior bosses start (floorThick for the normal bin; use 0 or the floor band for double-sided).
- `addPullTab(bin, w, d, h, p)` — +Y wall tab + gussets + drafted finger slot.
buildBinBody now = open/floored tube + addInterlockRibs + addPullTab.

## Plan (next steps)
1. New `src/models/bin-double-sided.ts`:
   - open tube: `box(w,d,0,h).cut(box(w-2t,d-2t,-1,h+1))` (through, no bottom floor);
   - `addInterlockRibs(bin,w,d,h,p,0)`;
   - central floor: a solid slab across the full cross-section around y=center ± ~2, plus a hopper cut — approximate the r≈18 concave fillet (try replicad `.fillet()` on the floor-to-wall edge; fallback: a cone/loft cut, documented like the perimeter foot);
   - `addPullTab` (widthModules/lengthModules default 4);
   - 2 lids as inset plates (57.4×58.4×3.3) at bottom and top.
2. Register in `src/models/index.ts`; add expected bbox 61.3×61.3×115 to `scripts/smoke.mjs`.
3. Verify with `diff-model.mjs` (centered like the other bins — plain diff works, not diff-aligned).
BOTTOM_FILLET_FACTOR=2.3 is the only new param (from f3d-extracted-parameters.md).
