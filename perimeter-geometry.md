---
name: perimeter-geometry
description: "Reverse-engineered geometry + port progress of the Hardcase Gridfinity Perimeter (U-channel border, bumps, dividers, dovetail)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 842fd133-22d2-4572-b373-1785271c3077
---

Ground-truth structure of `Hardcase_Gridfinity_Perimeter.step` (part of [[hardcase-gridfinity-generator]]), recovered by slab/occupancy analysis. Total volume ~404,563 mm³, 4 dovetailed solids (2 long side strips + 2 end strips) around a central cavity. Ports are centered on XY; truth lands in the +X/+Y quadrant after the Y-up→Z-up rotation, so use `scripts/diff-aligned.mjs` (recenters both) — plain `diff-model.mjs` does NOT overlap them.

**Cross-section** = thin-walled U-channel open at the top: vertical inner (cavity) wall WALL_THICK=1.2; outer (case) wall tapered 2°, meeting the outer footprint (350×250) at the top mouth; hollow between; joined at the bottom by a foot (floor band ~8 mm at the inner wall + a ~45° gusset ramp up to the outer wall, reaching it ~16 mm up).

**Key dims** (defaults L350×W250×H110): cavity opening **285 × 195** → end border 32.5 (X), side border 27.5 (Y). Recovered the two ⚠ unknown params: **SIDE_BOARDER_BIN_ADD = 4, FRONT_BOARDER_BIN_ADD = 3** (SIDE_BOARDER = 350−15·(23−4)=65; FRONT_BOARDER = 250−15·(16−3)=55). Cavity corner radius = WALL_CORNER_RADIUS 15.5; outer corner radius = BOTTOM_CORNER_RADIUS 19.05.

**Grid bumps** (at every 15 mm grid-cell centre, full height): like the bins, adjacent walls differ — **ribs (1.5 proud) on the −Y and +X walls**, **grooves (cut ~1.5 deep) on the +Y and −X walls**. 19 per long side, 13 per end.

**Dividers** (BOARDER_DIVIDERS): sparse full-height ribs — this design has 4 per long side at grid positions x≈55,115,205,265 (irregular subset) — that fill the border channel and project into the cavity. NOT modelled yet.

**Dovetail split**: 4 pieces overlap at the corners (end piece x 0..32.5, side pieces x 28.8..321 → ~3.7 mm joint overlap). Params BOARDER_DOVETAIL_WIDTH 10, DEPTH 5, ANGLE 30, CLEAR 0.2. NOT modelled yet.

## Port progress (src/models/perimeter.ts)
- **Stage 1 DONE**: U-channel walls + floor. NOTE: the floor MUST span the full border out to the outer footprint (`outerAt(0,0)`) so inner+outer walls fuse into ONE connected solid — a narrow floor band left them as 2 disjoint shells (looked fine in volume/diff but broke the split & printability). The real foot's gusset ramp is approximated by this flat floor (a ~12k-excess simplification). Centered on XY.
- **Stage 2 DONE**: grid ribs (−Y/+X) + grooves (+Y/−X) at grid centres. `applyGridFeatures(shape, p, walls)` applies a selectable subset of the 4 walls (WallSpec[]).
- **Stage 3 DONE**: dovetail 4-piece split (`splitPieces`, param `split` default 1 → build returns 4 solids). Split at X=±cavityHalfLength; long-side pieces carry dovetail tangs (params dovetailWidth/Depth/Angle) into the end pieces' sockets; ends keep the corners. KEY: apply each wall's grid features to the piece that OWNS that wall (pass `walls` per piece) — fusing bumps to the whole frame then splitting orphans ±X-wall ribs into the side pieces as slivers. Tang base set 2 mm inside the split line so its 2-D union with the side rect is clean. Result: 4 clean single-solid pieces, assembled bbox 350×250×110, smoke green.
- **Stage 4 DONE**: dividers (`dividers` param, BOARDER_DIVIDERS) — full-height channel-spanning cross-ribs at N evenly-spaced grid centres on the long sides. Built as a Y-Z profile extruded per X (follows the wall taper+fillet, so NO expensive intersect against the outer loft). Ground truth's dividers are ad-hoc per-edge (side2 x55,115,205,265; side1 x55,100,160,235; ends differ) so this is a configurable feature, not an exact clone. Applied last, per piece, so grooves can't slice them.
- **Stage 5 DONE**: case bottom-corner radius = BOTTOM_CORNER_RADIUS (19.05, fitted to ~19.3) rolled into the outer wall via `outerLoft` = a short fillet loft (z=0..R) fused to a straight 2-section body loft (z=R..H). MUST split the loft: a single multi-section loft with clustered fillet sections corrupts the body taper. The narrow floor now meets the pulled-in filleted wall bottom → connectivity + fit + accuracy together. Port side profile matches truth (taper + rounded bottom).
- **Print clearances** added: `clearance` (CLEARANCE) insets the whole outer envelope (default 0 = nominal case size — nonzero would fail the smoke bbox check, which validates against nominal truth, so it's opt-in per printer); `dovetailClear` (BOARDER_DOVETAIL_CLEAR, default 0.2) grows the end-piece socket beyond the side-piece tang, opening a slide-fit gap (doesn't affect bbox). Suggested print settings: clearance ~0.15, dovetailClear 0.2.
- Current fidelity: fused port **306k** vs truth **405k**. Gap = flat-floor foot (vs gusset ramp) + design-specific divider layout + dovetail-corner detail. Build ~14 s (the flagship complex model).
- GOTCHA: the shared `slab()` intersect gives a WRONG bbox on lofted solids (returns the top/largest section) — works on imported STEP. Use measureVolume or mesh vertices to check a loft's taper, not boundingBox of a z-slab. (Cost me a long false-alarm chase.)
- smoke.mjs keeps perimeter bbox-only (no volume assertion) since the port is deliberately incomplete vs truth volume. Tool: `scripts/diff-aligned.mjs` recenters both port+truth on XY before diffing (boolean volumes are reliable; slab bbox is not on lofts).
