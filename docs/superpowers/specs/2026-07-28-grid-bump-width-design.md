# Grid bump width: expose under Module features, default 3 mm

Date: 2026-07-28

## Problem

The form offers no control over how *wide* a grid bump is. The width exists as
`ribWidth` (`src/models/registration.ts`) — the shared interface constant `w`
that drives bin ribs, bin sockets (`w + 2c`), liner grooves, and both families'
backing bosses — but in the three perimeter models it is filed under *Interior
features*, away from the other grid knobs, and it is labelled "Rib width", which
does not connect it to the "Grid bump" (depth) control beside it.

Its 1.2 mm default is also a printability problem: that is a single extrusion
width on a 0.4 mm nozzle, so ribs come out fragile and prone to under-extrusion.

## Design

### Parameter

`ribWidthParam` is a single shared definition imported by every model, so one
edit covers all seven:

| field | before | after |
|---|---|---|
| `label` | "Rib width" | "Grid bump width" |
| `default` | 1.2 mm | 3 mm |
| `max` | 3 mm | 4.5 mm |

The ceiling was designed as 6 mm and corrected to 4.5 mm after measurement — see
*Knock-on geometry*.

Fit is unaffected: sockets remain `w + 2c` and liner grooves remain line-to-line
`w`, so registration clearance stays 0.1 mm per flank at any width.

### Form layout

Bins, `bin-with-lid`, `bin-double-sided` and `solid-block` already list
`ribWidth` under *Module features* and need no group change. In `perimeter.ts`,
`perimeter-square-corners.ts` and `smooth-perimeter.ts` the `"ribWidth"` key
moves from *Interior features* to *Module features*, after `gridSpacing` and
`gridBump`, so the three grid knobs sit together. Each key must appear in
exactly one group or `params-form.ts` renders it twice.

### Knock-on geometry

Both derived from `w` by construction, not incidental:

- Backing bosses widen — bin `s + 2w`: 3.8 → 9.2 mm, liner `3w`: 3.6 → 9.0 mm.
  Both still clear the 15 mm module pitch.

  **Measured, and it changed the design.** A bin socket's boss is `3w + 2c` wide
  and sits on the outermost module centre, leaving `P/2 − CLEAR = 7.4 mm` to the
  footprint edge, so it overhangs above `w = 4.87` — a sweep of `bin-no-lid`
  confirms the bbox is exactly 46.30 through `w = 4.8` and grows (46.50, 47.25,
  48.20) at 5, 5.5 and 6. A 6 mm ceiling would therefore let the form build a
  bin that no longer tiles at pitch, so the cap is **4.5 mm** instead: 50%
  headroom over the default, comfortably inside the limit. Geometry is clean at
  both ends of the range — bins, lids and the 4-piece perimeter all build as
  single solids with no debris or empty meshes.
- Perimeter dividers take their thickness from `ribWidth` (`perimeter.ts`), so
  they go 1.2 → 3 mm. Stronger; recorded in the README.

### Tests

`smoke.mjs` gains an optional `params` field on the `expected` table:

- Ground-truth-derived volumes (`bin-no-lid`, `bin-with-lid`,
  `bin-double-sided`) build with `params: { ribWidth: 1.2 }` so the fidelity
  assertion keeps measuring fidelity against the STEP originals.
- Every model still builds at its shipped defaults for the bbox and
  build-success checks. Bounding boxes are driven by `wallBump` (depth), not
  width, so they stay exact.
- Self-derived volumes — `solid-block`, `perimeter-square-corners`, and the
  screw-boss block's `boss-off + 8 pads` — are re-baselined at 3 mm. Pad volumes
  do not depend on `ribWidth`, so the pad arithmetic in the comment survives.

### Specification

`casefinity-liner-spec.md` declares `w = 1.20 mm` an interface constant that
conforming parts MUST use, and hard-codes the derived numbers across §2,
§4.1–4.3 and §7. Shipping a 3 mm default without moving the spec would make
every generated part off-spec, so the spec's `w` becomes 3.00 mm along with its
derived values. INV-1 permits this: the change applies to both families
together, which is inherent in their sharing one parameter.

The spec records that 3.00 mm deviates from the original Casefinity models
(1.20 mm) and why — printability. The original value remains documented as the
geometry the ground-truth checks reproduce.

## Files

- `src/models/registration.ts` — parameter and doc comment
- `src/models/perimeter.ts`, `perimeter-square-corners.ts`,
  `smooth-perimeter.ts` — group membership
- `scripts/smoke.mjs` — `params` override, re-baselined volumes
- `casefinity-liner-spec.md` — `w`, derived values, deviation and bound notes
  (re-render with `npm run build-spec`; the HTML page is committed)
- `all_options.md` — form layout for all seven models
- `README.md` — intentional deviations

## Verification

`npm run build`, `npm run smoke`, `npm run test:session`, `npm run scaling`
(its rib assertions derive from `p.ribWidth`, so they follow the new default),
plus a width sweep of `bin-no-lid` and builds of the bins and the perimeter at
both ends of the range.
