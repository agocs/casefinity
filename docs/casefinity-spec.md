# Casefinity Liner Interior & Accessory Specification

**Status:** Proposed specification v0.3 · 2026-07-31
**Changed in v0.3:** Registration features carry a draft angle `θ` taken about the
wall's normal (see §2, REQ-4.5). Nominal widths are now stated **at the wall
face**, which leaves every fit in §4.3 numerically unchanged and keeps drafted and
undrafted parts intermatable — so `θ` is a lead-in, not an interface width.
**Changed in v0.2:** Registration geometry is decoupled from wall thickness: rib
width is its own interface constant `w` (`RIB_WIDTH`), and `WALL_THICK` is now a
free structural parameter (see INV-2, REQ-4.4). In v0.1 both were the single
symbol `t`, so thickening a wall silently resized every rib, socket, and groove.
**Scope:** The geometric interface between Casefinity hard-case *liners* (perimeter
frames), *bins*, and *accessories* (lids, dividers, solid stock). This document
specifies the module grid, the interlock/registration features, the fit and
clearance scheme, and the tolerance stack-up behaviour so that independently
designed parts interoperate.

This is a *reference* specification: every dimension traces to a named Fusion 360
user parameter (see `f3d-parameters.md`) as realized in the generator
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
| `w` | Rib / grid bump width | **3.00 mm** | 3.00 mm | `RIB_WIDTH` |
| `b` | Bump height (proud/deep) | **1.50 mm** | 1.50 mm | `WALL_BUMP` = `GRID_BUMP` |
| `c` | Registration clearance | **0.10 mm** | 0.10 mm | `CLEAR` = `LID_CLEAR` |
| `θ` | Feature draft *(lead-in, free)* | default 2.00° | default 2.00° | `draftAngle` |
| `t` | Wall thickness *(structural, free)* | default 1.20 mm | default 1.20 mm | `WALL_THICK` |
| `f` | Floor / foot thickness | **1.00 mm** | 1.00 mm | `FLOOR_THICK` |
| `H` | Nominal cavity/bin height | 110 mm | 110 mm | `OVERALL_HT` / `OVERALL_HEIGHT` |

The **interface constants** are `P`, `w`, `b`, `c` (bold values). `t`, `f`, and
`H` are *structural* parameters: a conforming part may choose them freely (walls
of `1–6 mm` are the reasonable range) without affecting interoperability. `θ` is
free in the same way, for a different reason: it applies equally to male and
female features from a shared reference plane, so it cancels out of every fit
(REQ-4.5). Two parts drafted differently — including one at `θ = 0` — still mate.

Every width in this document is stated **at the wall face**. With `θ > 0` a
feature is that wide only on that plane; see REQ-4.5.

**INV-1 (unified bump).** `WALL_BUMP` (bins) and `GRID_BUMP` (liner) are the same
value `b = 1.50 mm`, and every **rib** (male feature), on a bin or on a liner, is
`w = 3.00 mm` wide and stands `b` proud. The female features are near-identical: a
bin *socket* and a liner *groove* are both a `b`-deep slot in the wall, kept a
**blind pocket** (backed by an interior boss when the wall is thin — see REQ-4.4),
differing only in the slot's tangential clearance (see §4). All share `b` and `w`.
A bin registers against a neighbouring bin and against the liner with compatible
geometry. Any change to `b` or `w` MUST be applied to both families together.

**INV-2 (wall thickness is orthogonal to registration).** `WALL_THICK` is *not*
an interface dimension. Changing `t` MUST NOT change any registration geometry —
rib width `w`, bump height `b`, slot widths, module pitch `P`, feature centring,
or the liner's cavity size (INV-7). This is realized by construction:

- every rib, slot, and boss width derives from `w` (and `c`), never from `t`;
- a bin's walls thicken **inward** (its interior shrinks; its footprint `F(n)`
  and exterior features are unchanged);
- the liner's cavity wall thickens **outward** into the border (the cavity stays
  exactly `N·P`; the border hollow shrinks). `t` appears in the liner only as
  the rib's structural embed depth and the boss depth — both behind the wall
  face, never in a mating dimension.

Historical note: the original Fusion designs drove rib width off `WALL_THICK`
(they were numerically equal at `1.20 mm`). `RIB_WIDTH` is a generator-introduced
parameter that freezes that width as an interface constant.

**Deviation from the original Casefinity models.** `w = 3.00 mm` is a deliberate
change from the originals' `1.20 mm`, made for printability: at `1.20 mm` a rib
is a single extrusion wide on a `0.40 mm` nozzle, so it prints fragile and is
prone to under-extrusion, and the matching slot is a single-pass gap that closes
up on any over-extrusion. `3.00 mm` gives both features real cross-section. This
is a conforming change under INV-1 (it moves both families together — they read
one parameter), but parts built to the original `1.20 mm` do NOT interlock with
parts built to this spec. Set `RIB_WIDTH = 1.20` to reproduce the original
geometry; that is the value the generator's ground-truth fidelity checks use.

**Upper bound.** `w` MUST satisfy `3w + 2c ≤ P − 2·CLEAR` — the socket's backing
boss (`s + 2w = 3w + 2c` wide, §4.1) sits on the outermost module centre, which
leaves `P/2 − CLEAR` to the footprint edge. Above that the boss overhangs and the
bin stops tiling at pitch: `w ≤ 4.87 mm` at the standard `P = 15`, so the
generator caps the parameter at `4.50 mm`.

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
| `−X`, `+Y` | **Rib (male)** | `w = 3.00` wide **at the wall face**, drafted `θ` toward its tip (2.895 there at `θ = 2°`), stands `b = 1.50` proud, full height. One per module centre. |
| `+X`, `−Y` | **Socket (female)** | Slot cut `b = 1.50` deep into the wall, `s = w + 2c = 3.20` wide **at the wall face**, drafted `θ` toward the bottom of the pocket (3.095 there at `θ = 2°`). On a thin wall (`t < 2b`) the slot severs the wall and MUST be backed by an interior **boss** `s + 2w = 9.20` wide, `b` thick, so the cavity is not opened; on a thick wall (`t ≥ 2b`) the slot is a plain blind pocket and the boss is omitted (REQ-4.4). One per module centre. |

**REQ-4.1.** Socket slot width MUST equal `w + 2c` **at the wall face** so a mating
`w`-wide rib enters with exactly `c = 0.10 mm` clearance **per flank**. Under
REQ-4.5 that clearance then holds at every depth. Neither dimension involves `t`
(INV-2).

### 4.2 Liner interior wall (the grid bumps)

The liner presents the *same* bump geometry on its cavity walls, split so it mates
with a bin's exterior in any of the two registrations:

| Liner wall | Feature | Geometry |
|---|---|---|
| `−Y`, `+X` | **Rib** | `w = 3.00` wide at the cavity face (drafted `θ` toward its tip), `b = 1.50` proud into the cavity (plus `t` embedded back into the wall — a structural anchor, not a mating dimension). One per module. |
| `+Y`, `−X` | **Groove** | A slot `w = 3.00` wide at the cavity face (line-to-line with a rib there, drafted `θ` deeper in), `b = 1.50` deep (from `0.30 mm` proud of the face). On a thin wall (`t < 2b`), **backed by a boss `3w = 9.00` wide extending `t + b` past the face** into the U-channel — a blind pocket, so the cavity is not opened; on a thick wall (`t ≥ 2b`) the slot is cut straight into the flat wall (REQ-4.4). One per module. |

**REQ-4.2.** The liner groove is `w` wide at the cavity face — the **same** width as
a rib there, with **no** added tangential clearance (line-to-line); under REQ-4.5
it stays line-to-line at every depth. Like the bin socket, the groove MUST be
a blind pocket that does not open the cavity into the U-channel hollow: on a thin
wall the `b`-deep slot alone cuts clean through the inner wall and severs it, so it
MUST be backed by a boss (REQ-4.4 gives the exact rule). The `0.30 mm` mouth
chamfer is a first-layer / elephant-foot allowance at the wall face, not
registration clearance. Tangentially the groove is a relief, not a precision
locator (see REQ-4.3).

### 4.3 Fit summary — two distinct interfaces

The joint is **asymmetric**: only the socket pairs are clearanced locators; the
groove pairs are line-to-line reliefs.

| Interface | Male | Female | Tangential fit |
|---|---|---|---|
| **Locating** — bin↔bin, and liner-rib↔bin-socket | rib `w = 3.00` | socket `w + 2c = 3.20` | **0.10 mm / flank** (0.20 across) |
| **Relief** — bin-rib↔liner-groove | rib `w = 3.00` | groove `w = 3.00` | **line-to-line** (0 nominal) |

```
   LOCATING:  rib w=3.00 ─►│ │◄─ socket s=3.20   →  0.10 mm/flank  (the clean hand-fit)
                           └─┘
   RELIEF:    rib w=3.00 ─►│ │◄─ groove w=3.00    →  0 nominal; seats on process tolerance
                           └─┘   (a blind pocket; line-to-line width, not a locator)
```

**REQ-4.3.** A part locates on its **socket** interfaces (the clearanced 0.10 mm/flank
fit — this is what assembles cleanly by hand). The opposing **rib-in-groove** pair is
a blind pocket (closing the cavity like the socket does) but with a **line-to-line**
slot width, so *tangentially* it is a relief, not a clearanced locator: its practical
fit is set by process tolerance and the `CLEAR` knob (§8.4). Designers MUST NOT treat
the groove as a tight datum, and MUST NOT over-constrain a part by relying on both
interfaces for precision simultaneously.

### 4.4 Female features on thick walls

**REQ-4.4 (boss rule).** Every female feature (bin socket, liner groove) MUST be a
**blind pocket**: the `b`-deep slot must never open the part's cavity (or the
liner's U-channel hollow). How that is achieved depends only on the wall:

- **`t < 2b` (thin wall):** the slot severs the wall, or leaves less than `b` of
  material behind it, so it MUST be backed by an interior boss (§4.1/§4.2 give
  each family's boss dimensions — all derived from `w` and `b`, except the liner
  boss *depth* `t + b`, which must span whatever wall it backs).
- **`t ≥ 2b` (thick wall):** the wall itself swallows the slot with at least `b`
  of solid material behind it. The boss MUST be omitted and the slot cut directly
  into the flat wall.

The male rib and the slot's mouth geometry are identical in both regimes, so a
mating part cannot tell them apart — the boss is an internal construction detail,
never part of the interface. At the default `t = 1.20 mm` every part is in the
thin-wall regime; a `6 mm` liner wall (`t = 4b`) is in the thick-wall regime.

### 4.5 Feature draft

**REQ-4.5 (draft rule).** A registration feature MAY be drafted by an angle `θ`.
The draft MUST be taken about the **wall's normal** — never about `Z` — and the
feature's nominal width MUST hold **at the wall face**, tapering by `2·tan θ` per
mm as the feature extends past that face (and widening at the same rate behind
it). One linear taper across the whole feature: no taper-plus-straight-run.

*Why not about `Z`.* These features run the full height of a part. At `H = 110 mm`
a 2° taper along `Z` would consume `2·H·tan θ = 3.84 mm` of width — more than a
`w = 3.00` rib has — and the rib would pinch to nothing 43 mm up. About the normal
the same angle costs `2·b·tan θ = 0.10 mm` over the `b = 1.50` bump.

*Why the fits are unchanged.* A rib's root and its mating slot's mouth are
coplanar when two wall faces touch, so at any depth `d` past that plane both
widths have shrunk by the same `2d·tan θ`:

```
slot(d) − rib(d) = (s − 2d·tan θ) − (w − 2d·tan θ) = s − w = 2c
```

Every fit in §4.3 therefore holds at **every** depth, not just at the face. The
draft is a lead-in, not a clearance.

**REQ-4.5.1 (mixed draft).** Conforming parts MUST interoperate across different
values of `θ`, including `θ = 0`. This follows from holding nominal width at the
face: a drafted rib is never wider than a nominal one, and a drafted slot is never
narrower than nominal minus its own taper, so engagement is preserved in both
directions. `θ` therefore needs **no agreement between parts** — unlike `w`, `b`,
`c`, and `P`.

**REQ-4.5.2.** Draft applies to the mating features only. Backing bosses (REQ-4.4)
and other internal construction geometry MUST NOT be relied on to carry it.

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
number of modules on each axis, **independent of wall thickness**. This is
*guaranteed by construction* by the border formula, not left to the user — note
that `t` appears nowhere in it (the cavity wall thickens outward into the border,
INV-2), so a liner rebuilt with any `t` in the `1–6 mm` range presents the exact
same `N_L × N_W` module cavity:

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
(wall + bump + a structural margin `m_struct ≈ 3 mm`) — `≳ 6 mm` at the default
`t = 1.20`, rising to `≳ 10.5 mm` at `t = 6` — or the border cannot carry the
U-channel wall and grid bump. Increasing `BIN_ADD` trades cavity modules for
border, and thickening the wall consumes border hollow; neither MUST drive the
border below this floor.

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
  is the intended tuning knob; `RIB_WIDTH`, `WALL_BUMP`, and `P` MUST stay fixed
  (they are interface constants — INV-1). `WALL_THICK` is free (INV-2) — thicken
  walls for strength at will; it changes no fit anywhere in this section.
- **MAY-8.4.** Prefer **more, narrower bins** over one wide bin when print accuracy
  is marginal: each extra bin adds `2c = 0.20 mm` of total slack and shortens the
  drift lever `n·P/2`.
- **NOTE-8.5.** The liner's own perimeter is split into bed-fitting dovetail pieces
  (`splitPieces`); those seams are a separate, generously-cleared joint
  (`BOARDER_DOVETAIL_CLEAR = 0.20 mm`) and do not interact with the module grid
  clearance analysed here. Each seam is closed by a **bulkhead** filling the
  U-channel cross-section, `WALL_THICK` either side of the seam plane and running
  the frame's full height, with the dovetail through it as a **vertical prism** —
  a tang folded to `WALL_THICK` on one piece, not solid, and a matching slot grown
  by `BOARDER_DOVETAIL_CLEAR` on the other. Both bulkheads are pierced on the
  dovetail centreline — the tang is drawn out through a slit in its own, so its
  interior stays continuous with the channel — and the seam is closed by that
  folded form rather than by an unbroken plate. Pieces therefore assemble by sliding
  together **vertically**, and the joint constrains both in-plane axes over the
  full height; vertical separation is
  unconstrained by design (it is the assembly direction, and the case retains the
  frame). All of this is liner-internal: it consumes only border material outboard
  of the cavity wall, so it changes no interface dimension and `WALL_THICK` stays
  free under INV-2.
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
footprint `F(n)`; a lid MUST use the same `P`, `w`, `c` so it shares the bin's
tolerance behaviour (§8). Lids stand above the rim (REQ-6.3).

### 9.2 Dividers

Liner dividers are full-height cross-ribs on the long walls at evenly spaced grid
centres (`BOARDER_DIVIDERS`). They subdivide the cavity **on module boundaries**;
a divider MUST fall on a grid line so it does not steal a bin's module, and MUST
be `w` wide (like every module-boundary feature, its width does not follow `t` —
a thick-walled liner with `t`-wide dividers would eat into the adjacent modules).

### 9.3 Solid Block (module stock)

The Solid Block is a bin footprint with no cavity (keeps `F(n)`, ribs, sockets,
pull tab). It is module-conforming stock: it registers exactly like a bin, so a
tool holder machined out of it drops into the grid with the §4.3 fit. Custom
accessories SHOULD start from `F(n)` + the §4.1 feature set to inherit conformance.

### 9.4 Conformance checklist (new part)

A part is *Casefinity-conformant* iff:

1. Its module envelope is `n·P` with footprint `F(n) = n·P − 2c` (REQ-3.2).
2. It carries the §4.1 handed rib/socket set at module centres, `w` wide, `b`
   proud/deep, sockets `w + 2c` wide (REQ-4.1), blind per REQ-4.4. Widths are
   measured at the wall face; any draft follows REQ-4.5.
3. It uses the interface constants of §2 unchanged except `CLEAR` (the only tuning
   knob); structural parameters (`WALL_THICK`, `FLOOR_THICK`, height) and the
   draft `θ` are free.
4. If it defines an interior pocket, that pocket snaps to whole modules (INV-7).

---

## Appendix A — Symbol → parameter → source map

| Symbol | Generator param (`bin-common.ts` / `perimeter.ts`) | Fusion name |
|---|---|---|
| `P` | `gridSpacing` | `GRID_SPACING` |
| `w` | `ribWidth` (`registration.ts`) | — (generator-introduced; historically driven by `WALL_THICK`) |
| `t` | `wallThick` (structural only) | `WALL_THICK` |
| `b` | `wallBump` / `gridBump` | `WALL_BUMP` / `GRID_BUMP` |
| `c` | `clear` | `CLEAR` / `LID_CLEAR` |
| `θ` | `draftAngle` (`registration.ts`) | — (generator-introduced; the originals are undrafted) |
| `f` | `floorThick` / `footThick` | `FLOOR_THICK` |
| `F(n)` | `widthModules*gridSpacing - 2*clear` | `MODULE_NUMBER * GRID_SPACING` (− `CLEAR`) |
| socket `s` | `ribWidth + 2*clear` (`addInterlockRibs`) | derived |
| `N_L,N_W` | `cavityDims()` | `SIDE/FRONT_BOARDER_FACTOR` |

Provenance of every default: `f3d-parameters.md`. Geometry realization:
`hardcase-gridfinity-generator/src/models/bin-common.ts` (bins) and
`.../perimeter.ts` (liner); the shared registration interface — rib/slot/boss
widths, module centring, the REQ-4.4 boss rule, the REQ-4.5 draft — lives in one
place, `.../registration.ts`. Invariants INV-1, INV-2, INV-7, the fit REQ-4.1 and
the boss rule REQ-4.4 are exercised by `npm run scaling` (including a
`WALL_THICK` sweep over `1–6 mm` on the liner). REQ-4.5 is exercised by
`npm run smoke`, which measures a rib's width in a slab at its root and another
at its tip — volume cannot see a draft that shaves the ribs and pads the sockets
by the same amount.
