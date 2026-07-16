import type { ModelDef } from "./types.ts";
import { perimeterParams, buildPerimeter } from "./perimeter.ts";
import { withDefaults } from "./bin-common.ts";

/**
 * Port of Hardcase_Gridfinity_Smooth Perimeter_42 Grid.f3d.
 *
 * Same frame as the standard perimeter (see perimeter.ts), just a different
 * configuration: a coarse 42 mm grid and a *smooth* inner wall — no grid bumps
 * or grooves (GRID_BUMP = 0). The coarser grid changes the recovered border
 * factors: the 350x250 case at 42 mm gives a 7x4 cavity (294x168) with a 28 mm
 * end border and a 41 mm side border, i.e. SIDE/FRONT_BOARDER_BIN_ADD = 1.
 *
 * Reuses the perimeter's build wholesale, so it inherits the U-channel border,
 * dovetail split, case bottom-radius and print clearances. The ground truth
 * carries two dividers per long side. Same simplification as the perimeter: a
 * flat-floor foot rather than the gusset ramp.
 */
export const smoothPerimeter: ModelDef = {
  id: "smooth-perimeter",
  name: "Smooth Perimeter (gridfinity interior)",
  description:
    "Liner frame with a smooth (bump-free) inner wall. Interior is designed to fit a 42mm Gridfinity baseplate. Split " +
    "into dovetailed pieces (enter a printer bed size to auto-subdivide to fit). Shares the perimeter frame code.",
  params: withDefaults(perimeterParams, {
    gridSpacing: 42,
    gridBump: 0,
    sideBoarderBinAdd: 1,
    frontBoarderBinAdd: 1,
    dividers: 2,
  }),
  build: buildPerimeter,
};
