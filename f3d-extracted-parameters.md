# Parameters recovered from the Hardcase Gridfinity .f3d files

Extracted 2026-07-13 by string-mining the `FusionDesignSegmentType1/BulkStream.dat`
stream inside each `.f3d` archive (the archives are ZIPs, some entries zstd-compressed).
User parameters are serialized as `<value expression> · "User Parameter" · <NAME>` triples
in UTF-16LE, so names, default expressions, and inter-parameter formulas are recoverable.
Full sketch geometry / feature-tree structure is NOT recoverable this way (proprietary binary).

Rows marked ⚠ are mispairings from the heuristic (unitless numeric defaults don't survive
the string scan) — read the true value from Fusion's Change Parameters dialog.

## 1. Template / Hardcase_Gridfinity_Perimeter_Template.f3d

| Parameter | Default |
|---|---|
| Overall_HT | 110 mm |
| OVERALL_LENGTH | 350 mm |
| OVERALL_WIDTH | 250 mm |
| BOTTOM_CORNER_RADIUS | 0.75 in |
| SIDE_WALL_TAPER | 1 deg |
| FRONT_WALL_TAPER | 1 deg |
| GRID_SPACING | 15 mm |
| TEST_THICK | 1 mm |
| TEST_OFFSET | 10 mm |

## 2. Perimeter / Hardcase_Gridfinity_Perimeter.f3d

| Parameter | Default / expression |
|---|---|
| OVERALL_HEIGHT | 110 mm |
| OVERALL_LENGTH | 350 mm |
| OVERALL_WIDTH | 250 mm |
| BOTTOM_CORNER_RADIUS | 0.75 in |
| SIDE_WALL_TAPER | 2 deg |
| FRONT_WALL_TAPER | 2 deg |
| CLEARANCE | 0.1 mm |
| WALL_THICK | 1.2 mm |
| GRID_BUMP | 1.5 mm |
| GRID_SPACING | 15 mm |
| SIDE_BOARDER | OVERALL_LENGTH - (GRID_SPACING * SIDE_BOARD_FACTOR) |
| FRONT_BOARDER | OVERALL_WIDTH - (GRID_SPACING * FRONT_BOARDER_FACTOR) |
| SIDE_BOARD_FACTOR | floor(OVERALL_LENGTH / GRID_SPACING) - SIDE_BOARDER_BIN_ADD |
| FRONT_BOARDER_FACTOR | floor(OVERALL_WIDTH / GRID_SPACING) - FRONT_BOARDER_BIN_ADD |
| FRONT_BOARDER_BIN_ADD | ⚠ (unitless count; check in Fusion) |
| SIDE_BOARDER_BIN_ADD | ⚠ (unitless count; check in Fusion) |
| BOARDER_DOVETAIL_WIDTH | 10 mm |
| BOARDER_DOVETAIL_DEPTH | 5 mm |
| BOARDER_DOVETAIL_ANGLE | 30 deg |
| WALL_CORNER_RADIUS | 15.5 mm |
| BOARDER_DOVETAIL_CLEAR | 0.2 mm |
| BOARDER_DIVIDERS | ⚠ (appears in param list; default not paired) |

## 2b. Perimeter / Hardcase_Gridfinity_Smooth Perimeter_42 Grid.f3d

Same schema as the Perimeter above, minus BOARDER_DOVETAIL_CLEAR, with
GRID_SPACING = 42 mm.

## 3. Bins (No Lid / with Lid / Double Sided) — shared schema

| Parameter | No Lid | With Lid | Double Sided |
|---|---|---|---|
| GRID_SPACING | 15 mm | 15 mm | 15 mm |
| WALL_THICK | 1.2 mm | 1.2 mm | 1.2 mm |
| WALL_BUMP | 1.5 mm | 1.5 mm | 1.5 mm |
| CLEAR | 0.1 mm | 0.1 mm | 0.1 mm |
| LENGTH_MODULE_NUMBER | ⚠ unitless count | ⚠ | ⚠ |
| WIDTH_MODULE_NUMBER | ⚠ unitless count | ⚠ | ⚠ |
| OVERALL_HT | 110 mm | 110 mm | 110 mm |
| FLOOR_THICK | 1 mm | 1 mm | 1 mm |
| LID_THICK | 3 mm | 3 mm | 3 mm |
| LID_TOP_OFFSET | 1 mm | — | — |
| LID_LOCK_LENGTH | 8 mm | 8 mm | 8 mm |
| LID_PULL_WIDTH | 8 mm | 8 mm | 8 mm |
| LID_PULL_HT | 1 mm | 1 mm | 1 mm |
| LID_PULL_FRONT_OFFSET | 3 mm | 3 mm | 3 mm |
| PULL_TAB_WIDTH | PULL_TAB_HT + WALL_THICK | (same) | (same) |
| PULL_TAB_HT | 5 mm | 5 mm | 5 mm |
| PULL_HOLE_LENGTH | 10 mm | 12 mm | 12 mm |
| LID_CLEAR | 0.1 mm | 0.1 mm | 0.1 mm |
| CHAMFER_LENGTH | 0.5 mm | 0.5 mm | 0.5 mm |
| CHAMFER_WIDTH | 1 mm | 1 mm | 1 mm |
| LID_LOCK_OFFSET | 0.1 mm | 0.2 mm | 0.2 mm |
| BOTTOM_FILLET_FACTOR | — | — | 2.3 |

## Driving expressions observed in the feature tree (samples)

- Wall draft: extrude/taper angles of `90 deg ± FRONT_WALL_TAPER`, `90 deg ± SIDE_WALL_TAPER`
- Grid counts: `floor(OVERALL_LENGTH / GRID_SPACING)`, `floor(OVERALL_WIDTH / GRID_SPACING)`
- Bin footprint: `LENGTH_MODULE_NUMBER * GRID_SPACING`, `WIDTH_MODULE_NUMBER * GRID_SPACING`
- Dovetail: `180 deg - BOARDER_DOVETAIL_ANGLE`, `BOARDER_DOVETAIL_WIDTH / 2`
- Lid lock: `(LID_CLEAR + LID_LOCK_OFFSET) * 0.99`
- Feature types present: Sketch, Extrude, FilletEdge, Chamfer, Combine, MirrorPattern,
  RectangularPattern, WorkPlane, SplitBody, Emboss (the "TOP" text), BaseFeature
