# Casefinity Liner Interior & Accessory Specification

**Status:** Proposed specification v0.1 · 2026-07-16
**Scope:** The geometric interface between Casefinity hard-case *liners* (perimeter
frames), *bins*, and *accessories* (lids, dividers, solid stock). This document
specifies the module grid, the interlock/registration features, the fit and
clearance scheme, and the tolerance stack-up behaviour so that independently
designed parts interoperate.

This is a *reference* specification: every dimension traces to a named Fusion 360
user parameter (see `f3d-extracted-parameters.md`) as realized in the generator
(`hardcase-gridfinity-generator/src/models/`). Where the spec and the code
disagree, the code is authoritative and this document is a bug.

Requirement language: **MUST / SHOULD / MAY** per RFC 2119.

---

## 1. Terms and coordinate system

| Term | Meaning |
|---|---|
| **Module** | The unit cell of the grid. Pitch `P`. Standard grid `P = 15 mm`; Gridfinity liner `P = 42 mm`. |
| **Liner** | The perimeter frame that drops into the hard case and presents a gridded cavity. |
| **Bin** | An open or lidded container occupying `n × m` whole modules. |
| **Rib** | A feature standing **proud** of a wall (male). |
| **Groove / socket** | A feature **recessed** into a wall (female) that receives a rib. |
| **Registration** | Passive location of one part by another via rib↔groove engagement. |

Parts are modelled **Z-up**, centred on XY, with `z = 0` at the part's bottom
(print-bed) plane. `+X` = length, `+Y` = width, `+Z` = up (case mouth).

---

## 2. Nominal datum values

These are the interface constants. All parts claiming Casefinity conformance MUST
use these values (or a documented superset).

| Symbol | Name | Standard | Gridfinity liner | Source param |
|---|---:|---:|---:|---|
| `P` | Module pitch | **15.00 mm** | **42.00 mm** | `GRID_SPACING` |
| `t` | Wall thickness | **1.20 mm** | 1.20 mm | `WALL_THICK` |
| `b` | Bump height (proud/deep) | **1.50 mm** | 1.50 mm | `WALL_BUMP` = `GRID_BUMP` |
| `c` | Registration clearance | **0.10 mm** | 0.10 mm | `CLEAR` = `LID_CLEAR` |
| `f` | Floor / foot thickness | **1.00 mm** | 1.00 mm | `FLOOR_THICK` |
| `H` | Nominal cavity/bin height | 110 mm | 110 mm | `OVERALL_HT` / `OVERALL_HEIGHT` |

**INV-1 (unified bump).** `WALL_BUMP` (bins) and `GRID_BUMP` (liner) are the same
value `b = 1.50 mm`, and every **rib** (male feature), on a bin or on a liner, is
`t = 1.20 mm` wide and stands `b` proud. The female features are near-identical: a
bin *socket* and a liner *groove* are both a slot through the thin wall **backed by
an interior boss** — a blind pocket that keeps the cavity closed — differing only
in the slot's tangential clearance (see §4). All share `b` and `t`. A bin registers
against a neighbouring bin and against the liner with compatible geometry. Any
change to `b` or `t` MUST be applied to both families together.

---

## 3. The module grid

**REQ-3.1.** The grid is a square lattice of pitch `P`. Feature and cavity
positions are expressed in module coordinates and converted with `P`.

**REQ-3.2 (bin footprint).** A bin spanning `n` modules in an axis has outer wall
faces at

```
F(n) = n·P − 2c        (footprint, wall-face to wall-face)
```

i.e. the bin is shrunk by `c = 0.10 mm` on **each** face inside its nominal
`n·P` envelope. For `P = 15`: `F(1)=14.80`, `F(3)=44.80`, `F(n)=15n−0.20`.
The `−2c` is per-bin and **independent of `n`** (a 5-module bin is `74.80`, not
`74.60`). This is the single most important fact for the stack-up analysis (§8).

**REQ-3.3 (bounding envelope).** The male ribs on the `−X` and `+Y` faces stand
`b` proud, so a bin's true bounding box on those axes is

```
E(n) = F(n) + b = n·P − 2c + b = 15n + 1.30 mm     (standard grid)
```

e.g. a 3×3 bin measures `46.30 × 46.30 mm`. Slicers and nesting logic MUST use
`E(n)`, not `F(n)`.

**REQ-3.4 (feature centring).** Bump centres along an edge are the module centres
`(i − (k−1)/2)·P`, `i = 0…k−1`, for a `k`-module edge — i.e. one bump per module,
symmetric about the part centre. The liner uses the same centring over its cavity
span (`gridCenters`), so bin module centres and liner grid centres **coincide**
when a bin sits on-grid.

---

## 4. Interlock / registration features

### 4.1 Bin exterior (the socketed interlock)

A bin carries a **complementary** feature set so it registers "either way round":

| Face | Feature | Geometry |
|---|---|---|
| `−X`, `+Y` | **Rib (male)** | `t = 1.20` wide, stands `b = 1.50` proud of the wall face, full height. One per module centre. |
| `+X`, `−Y` | **Socket (female)** | Slot cut through the wall, `s = t + 2c = 1.40` wide, `b = 1.50` deep, backed by an interior **boss** `s + 2t = 3.80` wide, `b` thick, so the cavity is not opened. One per module centre. |

**REQ-4.1.** Socket slot width MUST equal `t + 2c` so a mating `t`-wide rib enters
with exactly `c = 0.10 mm` clearance **per flank**.

### 4.2 Liner interior wall (the grid bumps)

The liner presents the *same* bump geometry on its cavity walls, split so it mates
with a bin's exterior in any of the two registrations:

| Liner wall | Feature | Geometry |
|---|---|---|
| `−Y`, `+X` | **Rib** | `t = 1.20` wide, `b = 1.50` proud into the cavity (plus `t` embedded back into the wall). One per module. |
| `+Y`, `−X` | **Groove** | A slot `t = 1.20` wide (line-to-line with a rib), `b = 1.50` deep (from `0.30 mm` proud of the face), **backed by a boss `3t = 3.60` wide extending `t + b = 2.70` past the face** into the U-channel — a blind pocket, so the cavity is not opened. One per module. |

**REQ-4.2.** The liner groove is `t` wide — the **same** width as a rib, with **no**
added tangential clearance (line-to-line). Like the bin socket, the slot MUST be
**backed by a boss** so it is a blind pocket that does not open the cavity into the
U-channel hollow: the `b`-deep slot alone cuts clean through the `t`-thick inner
wall and severs it. The `0.30 mm` mouth chamfer is a first-layer / elephant-foot
allowance at the wall face, not registration clearance. Tangentially the groove is
a relief, not a precision locator (see REQ-4.3).

### 4.3 Fit summary — two distinct interfaces

The joint is **asymmetric**: only the socket pairs are clearanced locators; the
groove pairs are line-to-line reliefs.

| Interface | Male | Female | Tangential fit |
|---|---|---|---|
| **Locating** — bin↔bin, and liner-rib↔bin-socket | rib `t = 1.20` | socket `t + 2c = 1.40` | **0.10 mm / flank** (0.20 across) |
| **Relief** — bin-rib↔liner-groove | rib `t = 1.20` | groove `t = 1.20` | **line-to-line** (0 nominal) |

```
   LOCATING:  rib t=1.20 ─►│ │◄─ socket s=1.40   →  0.10 mm/flank  (the clean hand-fit)
                           └─┘
   RELIEF:    rib t=1.20 ─►│ │◄─ groove t=1.20    →  0 nominal; seats on process tolerance
                           └─┘   (a blind slot+boss pocket; line-to-line width, not a locator)
```

**REQ-4.3.** A part locates on its **socket** interfaces (the clearanced 0.10 mm/flank
fit — this is what assembles cleanly by hand). The opposing **rib-in-groove** pair is
a blind slot+boss pocket (structurally like the socket, so it closes the cavity) but
with a **line-to-line** slot width, so *tangentially* it is a relief, not a clearanced
locator: its practical fit is set by process tolerance and the `CLEAR` knob (§8.4).
Designers MUST NOT treat the groove as a tight datum, and MUST NOT over-constrain a
part by relying on both interfaces for precision simultaneously.

---

## 5. Bin ↔ bin engagement

**REQ-5.1.** Adjacent bins meet wall-face-to-wall-face: one bin's `−X`/`−Y` rib
seats fully into the neighbour's `+X`/`+Y` socket (`b` proud into `b` deep, with the
§4.3 locating clearance), so the wall faces become nominally coincident and the rib
occupies the socket volume — the joint adds **no length** to the pack. Each bin
therefore contributes exactly `F(nᵢ)` to a row, and the centre-to-centre pitch of
two bins of `n_A`, `n_B` modules is

```
pitch = F(n_A)/2 + F(n_B)/2 = (n_A + n_B)·P/2 − 2c.
```

**REQ-5.2.** Because the ribs are handed (`−X/+Y` male, `+X/−Y` female), a full
tiling has consistent polarity: every interior seam is one rib into one socket.
Rotating a bin 180° about Z swaps which faces are male, and it still registers
(INV-1) — but its pull tab and any lid features rotate with it.

---

## 6. Bin ↔ liner engagement

**REQ-6.1.** A bin on the cavity perimeter registers to the liner grid bumps with
the §4.3 fit. A bin in the interior registers to its neighbours (§5). The liner
grid and bin modules share pitch and centring (REQ-3.4), so both hold simultaneously.

**REQ-6.2.** Perimeter bins are located by the liner at the case datum; interior
bins are chained off them. See §8 for how error propagates through the chain.

**REQ-6.3 (Z).** A bin's floor rests on the liner foot; its rim sits at/near the
cavity mouth (`H` nominal). The pull tab (`PULL_TAB_HT = 5 mm`) and any lid stand
**above** the rim and MUST NOT be assumed to fit under a closed case lid without
checking `case_internal_height ≥ H + PULL_TAB_HT`.

---

## 7. Liner interior sizing — the integer-module invariant

**INV-7 (interiors snap to whole modules).** A liner's cavity MUST be an integer
number of modules on each axis. This is *guaranteed by construction* by the border
formula, not left to the user:

```
N_L = floor(OVERALL_LENGTH / P) − SIDE_BOARDER_BIN_ADD      (cavity length, modules)
N_W = floor(OVERALL_WIDTH  / P) − FRONT_BOARDER_BIN_ADD     (cavity width,  modules)

cavity_length = N_L · P          cavity_width = N_W · P      (always exact multiples)
```

The free outer dimension is absorbed entirely by the **border**, which is never
smaller than the whole modules reserved plus the sub-module remainder:

```
border_total(axis) = OVERALL − N·P = P·BIN_ADD + (OVERALL mod P)
border_per_side    = border_total / 2
```

Worked defaults (standard grid, `OVERALL = 350 × 250`, `SIDE_ADD = 4`, `FRONT_ADD = 3`):

| Axis | `floor(OVERALL/P)` | `BIN_ADD` | Cavity (modules → mm) | Border/side |
|---|---:|---:|---:|---:|
| Length | 23 | 4 | 19 → **285.0** | 32.5 mm |
| Width | 16 | 3 | 13 → **195.0** | 27.5 mm |

Gridfinity liner (`P = 42`, `OVERALL = 350 × 250`, `SIDE_ADD = FRONT_ADD = 1`):

| Axis | `floor(OVERALL/P)` | `BIN_ADD` | Cavity (modules → mm) | Border/side |
|---|---:|---:|---:|---:|
| Length | 8 | 1 | 7 → **294.0** | 28.0 mm |
| Width | 5 | 1 | 4 → **168.0** | 41.0 mm |

**REQ-7.1.** The `42 mm` liner cavity being a whole multiple of `42` means a
standard Gridfinity baseplate/bin set (`42 mm` module) drops into the pocket; the
standard Gridfinity `~0.5 mm/module` baseplate clearance lives *inside* that
pocket and is not part of this spec.

**REQ-7.2 (minimum border).** `border_per_side` MUST remain `≥ t + b + m_struct`
(wall + bump + a structural margin `m_struct ≈ 3 mm`), i.e. `≳ 6 mm`, or the
border cannot carry the U-channel wall and grid bump. Increasing `BIN_ADD` trades
cavity modules for border; it MUST NOT drive the border below this floor.

**SHOULD-7.3 (UX).** Because the cavity is always `N_L × N_W` whole modules, the
generator SHOULD display the resulting module count (e.g. "19 × 13 modules") and
MAY offer an inverse mode where the user enters `N_L, N_W` and the outer size is
computed as `N·P + 2·border`.

---

## 8. Tolerance and stack-up

This section addresses the practical question: *single bins fit beautifully — what
happens with many bins side by side across a full liner?*

### 8.1 Two independent error sources

1. **Designed clearance** `2c = 0.20 mm` per bin (0.10 per face), realized as the
   rib/socket flank gap. It is **absolute and per-bin**, independent of `n`
   (REQ-3.2). A row of `K` bins summing to `N` modules leaves total assembly slack

   ```
   S = C − Σ F(nᵢ) = N·P − (N·P − 2c·K) = 2c·K = 0.20·K mm.
   ```

   **Slack scales with the number of bins `K`, not the number of modules `N`.**
   Many narrow bins → lots of slack (forgiving, but more rattle). One wide bin or
   pack → little slack (crisp, but unforgiving).

2. **Printer dimensional error**, which scales with *absolute distance*: a fractional
   scale error `ε` (steps/mm, flow, thermal shrink) displaces a feature at distance
   `d` from the part datum by `ε·d`. Over a full liner span this dominates.

### 8.2 The stack-up result

Let bins print at scale `1 + ε_bin` and the liner at `1 + ε_liner`. The pack fits iff

```
(N·P − 2c·K)(1 + ε_bin) ≤ N·P·(1 + ε_liner)
  ⟹   ε_bin − ε_liner  ≤  2c·K / (N·P)  =  0.0133 · (K/N)      (standard grid)
```

**Key consequences**

- **Ratiometric cancellation.** If bins and the liner are printed on the *same
  machine, material, and profile*, `ε_bin ≈ ε_liner`, the left side is ~0, and the
  pack **always** fits — the `0.20·K` slack scales along with everything else. This
  is why your hand-fit today is excellent, and it is the primary recommendation.
- **The enemy is *differential* scale**, not absolute size: bins and liner printed
  on different printers/materials, or anisotropic X-vs-Y error. The tolerable
  differential is `0.0133·(K/N)`:

  | Pack composition | `K/N` | Max differential scale `\|ε_bin−ε_liner\|` |
  |---|---:|---:|
  | All 1-module bins | 1 | **1.33 %** (very forgiving) |
  | Mixed, ~2 modules/bin | 0.5 | 0.67 % |
  | A few wide bins, ~5 modules/bin | 0.2 | 0.27 % |
  | One bin fills the row (`K=1`, `N=19`) | 0.053 | **0.070 %** (tight) |

- **Per-joint alignment (a second, tighter check).** Total fit is necessary but not
  sufficient: each rib must still land in its socket/groove within the `c = 0.10 mm`
  flank gap. A bin's far rib is `≤ n·P/2` from its registration datum, so its
  misalignment is `≈ |ε_bin − ε_datum|·(n·P/2)`. Requiring `< c`:

  ```
  wide bins amplify drift:  a 10-module bin (150 mm) at 0.1 % differential
  drifts its end rib by 0.075 mm — inside the 0.10 mm gap, but only just.
  ```

### 8.3 Absolute-accuracy budget (single element, worst case `K=1`)

For a single bin/pack of `n` modules that must drop into an `n`-module pocket with
only its own `2c = 0.20 mm`:

| Span `n·P` | Allowed absolute error | = fractional `ε` |
|---:|---:|---:|
| 45 mm (3 mod) | 0.20 mm | 0.44 % |
| 150 mm (10 mod) | 0.20 mm | 0.13 % |
| 285 mm (19 mod, full default cavity) | 0.20 mm | **0.070 %** |

### 8.4 Requirements & guidance

- **SHOULD-8.1.** Print a liner and the bins that fill it on the **same printer,
  material, and profile.** This makes error ratiometric and removes stack-up as a
  concern for any realistic `ε`.
- **SHOULD-8.2.** For large single elements (a bin or lid spanning ≳ 8 modules),
  calibrate XY scale (flow / steps-per-mm / measured calibration cube) to keep
  absolute error `< 2c = 0.20 mm` over the span (≈ 0.07 % at the full default cavity).
- **MAY-8.3.** On an uncalibrated or high-shrink process, raise `CLEAR` (bins) from
  `0.10` toward `0.15–0.20 mm` to widen every flank gap, accepting more play. This
  is the intended tuning knob; `WALL_THICK`, `WALL_BUMP`, and `P` MUST stay fixed
  (they are interface constants — INV-1).
- **MAY-8.4.** Prefer **more, narrower bins** over one wide bin when print accuracy
  is marginal: each extra bin adds `2c = 0.20 mm` of total slack and shortens the
  drift lever `n·P/2`.
- **NOTE-8.5.** The liner's own perimeter is split into bed-fitting dovetail pieces
  (`splitPieces`); those seams are a separate, generously-cleared joint
  (`BOARDER_DOVETAIL_CLEAR = 0.20 mm`) and do not interact with the module grid
  clearance analysed here.
- **NOTE-8.6.** The single tightest interface is the perimeter **bin-rib↔liner-groove**
  relief (§4.3, line-to-line width). It is the first place an over-extruded /
  oversized print binds. If perimeter bins feel tight while interior (bin↔bin) joints
  are fine, tune extrusion width / flow, or raise `CLEAR`, before touching any
  interface constant.

---

## 9. Accessories

### 9.1 Lids

Lids seat on a bin's rim with their own clearance `LID_CLEAR = 0.10 mm` and a
sliding-lock scheme (`LID_LOCK_*`, `LID_PULL_*`). A lid's footprint tracks the bin
footprint `F(n)`; a lid MUST use the same `P`, `t`, `c` so it shares the bin's
tolerance behaviour (§8). Lids stand above the rim (REQ-6.3).

### 9.2 Dividers

Liner dividers are full-height cross-ribs on the long walls at evenly spaced grid
centres (`BOARDER_DIVIDERS`). They subdivide the cavity **on module boundaries**;
a divider MUST fall on a grid line so it does not steal a bin's module.

### 9.3 Solid Block (module stock)

The Solid Block is a bin footprint with no cavity (keeps `F(n)`, ribs, sockets,
pull tab). It is module-conforming stock: it registers exactly like a bin, so a
tool holder machined out of it drops into the grid with the §4.3 fit. Custom
accessories SHOULD start from `F(n)` + the §4.1 feature set to inherit conformance.

### 9.4 Conformance checklist (new part)

A part is *Casefinity-conformant* iff:

1. Its module envelope is `n·P` with footprint `F(n) = n·P − 2c` (REQ-3.2).
2. It carries the §4.1 handed rib/socket set at module centres, `t` wide, `b`
   proud/deep, sockets `t + 2c` wide (REQ-4.1).
3. It uses the datum constants of §2 unchanged except `CLEAR` (the only tuning knob).
4. If it defines an interior pocket, that pocket snaps to whole modules (INV-7).

---

## Appendix A — Symbol → parameter → source map

| Symbol | Generator param (`bin-common.ts` / `perimeter.ts`) | Fusion name |
|---|---|---|
| `P` | `gridSpacing` | `GRID_SPACING` |
| `t` | `wallThick` | `WALL_THICK` |
| `b` | `wallBump` / `gridBump` | `WALL_BUMP` / `GRID_BUMP` |
| `c` | `clear` | `CLEAR` / `LID_CLEAR` |
| `f` | `floorThick` / `footThick` | `FLOOR_THICK` |
| `F(n)` | `widthModules*gridSpacing - 2*clear` | `MODULE_NUMBER * GRID_SPACING` (− `CLEAR`) |
| socket `s` | `t + 2*clear` (`addInterlockRibs`) | derived |
| `N_L,N_W` | `cavityDims()` | `SIDE/FRONT_BOARDER_FACTOR` |

Provenance of every default: `f3d-extracted-parameters.md`. Geometry realization:
`hardcase-gridfinity-generator/src/models/bin-common.ts` (bins) and
`.../perimeter.ts` (liner). Invariants INV-1, INV-7 and the fit REQ-4.1 are
exercised by `npm run scaling`.
