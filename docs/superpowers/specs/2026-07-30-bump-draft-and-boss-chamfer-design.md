# Bump draft and screw-boss lead-in chamfer

**Date:** 2026-07-30
**Status:** approved

Two independent printability changes to the generator:

1. A 2° plan-view draft on every grid registration feature (bin ribs and
   sockets, liner grid ribs and grooves).
2. A 45° lead-in chamfer on the clearance-hole mouth of the perimeter's screw
   bosses.

## 1. Draft on the grid bumps and slots

### Why not draft along Z

The registration features are full-height vertical prisms — a bin's ribs run
`z = 0 … OVERALL_HT` (110 mm at the defaults, up to 300 mm). A 2° taper along Z
would consume `2 · 110 · tan 2° = 3.84 mm` of width, more than the rib's entire
3 mm. The feature would pinch to nothing 43 mm up. Drafting along Z is only
possible at a height-dependent angle (≈0.7° at `h = 110`, ≈0.28° at `h = 300`),
which is not what "2°" means.

So the draft is taken about the **wall normal** — the X axis on the ±X walls,
the Y axis on the ±Y walls. Each feature's cross-section in plan view becomes a
trapezoid; in Z it stays a straight prism.

### The rule

> A registration feature's nominal width holds **at the wall face**. Its width
> shrinks by `2 · tan(draft)` per mm as the feature extends past that face, and
> grows by the same rate on the other side of it.

One linear taper across the whole prism — not a taper plus a straight section.
Male ribs therefore narrow toward their tip and thicken where they anchor into
the wall; female slots narrow toward the bottom of the pocket and flare at the
mouth.

At `draft = 2°`, `w = 3.00`, `b = 1.50`, `c = 0.10`:

| Feature | at the wall face | at the far end |
|---|---|---|
| Bin rib (−X, +Y), 1.5 proud | 3.000 | 2.895 at the tip |
| Bin socket (+X, −Y), 1.5 deep | 3.200 | 3.095 at the bottom |
| Liner rib, 1.5 proud + `t` embedded | 3.000 | 2.895 tip / 3.210 buried at `t = 3` |
| Liner groove, 1.5 deep from 0.3 proud | 3.000 | 2.895 deep / 3.021 at the mouth |

### Why the fit is unchanged

A rib's root and its mating slot's mouth are coplanar when the two wall faces
touch, so at any depth `d` past that plane:

```
slot(d) − rib(d) = (s − 2d·tan θ) − (w − 2d·tan θ) = s − w = 2c
```

The 0.10 mm/flank locating clearance (REQ-4.1) is preserved exactly at every
depth, and the liner groove stays line-to-line with a bin rib at every depth
(REQ-4.2). The draft is a *lead-in*, not a clearance change.

**Mixed-draft parts still mate**, in both directions: a drafted 2.895 tip enters
an undrafted 3.200 slot, and an undrafted 3.000 rib enters a drafted slot whose
narrowest point is 3.095. So the angle need not be agreed between parts —
holding nominal at the face is what makes it a conforming change under INV-1.

### What is not drafted

- **Backing bosses** (bin socket bosses, liner groove bosses). REQ-4.4 calls
  them an internal construction detail; no mating part ever touches them.
- **Perimeter divider ribs.** Not §4 interlock features. Their cavity-facing
  edge references the grid bump's *depth*, which draft does not change, so
  there is no interaction.
- **`bin-with-lid`'s lid nose notch.** The notch is relief that keeps the lid
  from capping the −Y sockets; a straight `socketWidth` cut equals the drafted
  socket at its widest and is wider everywhere else, so it stays valid.

`bin-with-lid`'s **ledge socket re-cut** *is* the +X socket continued through
the rail ledge and takes the same drafted cutter — otherwise the slot steps in
width partway up its height.

### Implementation

A shared helper in `registration.ts` alongside `interlockDims`, taking the
feature's normal-axis extent, the face coordinate where nominal width holds, the
nominal width and the narrowing direction, and returning the trapezoid. Both
families call it, so draft joins rib width and bump depth as a value defined in
exactly one place.

This is a sketch-level change (`drawRectangle` → a four-point trapezoid,
extruded in Z as before). No lofts, no tapered extrusions, no new OCCT traps.

### Parameter

`draftAngleParam` in `registration.ts`: key `draftAngle`, label "Bump draft",
default **2**, unit deg, min 0, max 5, step 0.5. Added to `binParams` and the
perimeter parameter lists, and to the **"Module features"** form group on every
model that has one. No `fusionName` — like `ribWidth` it is a generator
interface constant, not a recovered Fusion parameter.

Setting it to 0 reproduces the original Fusion geometry exactly.

## 2. Screw-boss lead-in chamfer

45° × 0.5 mm on the **clearance half's outer mouth only**. At the M3 defaults
the ø3.10 clearance hole opens to a ø4.10 mouth while the pilot hole stays a
sharp ø2.40.

The asymmetry is the point. Besides easing screw entry, the chamfer is a
**visual indicator of which end takes the screw** — a 3.1 mm and a 2.4 mm FDM
hole are not reliably distinguishable by eye, and a chamfered mouth is. So the
pilot hole and both seam-facing ends stay sharp.

Built as a frustum fused onto the existing bore cutter in `bossHalf`, using
replicad's linear extrusion profile:

```
drawCircle(r + ch).extrude(ch, {
  extrusionProfile: { profile: "linear", endFactor: r / (r + ch) },
})
```

placed at the half's outer end (`s.side > 0 ? u0 + len : u0`) and gated on
`s.hole === "clear"`.

Size is a constant, not a parameter — the "Screw bosses" group already carries
five knobs and this is a fixed convenience feature. It is clamped to
`min(0.5, bossWall − 0.2)` so the cone can never break out through the pad's
side; at the parameter's `bossWall ≥ 1` floor the clamp never binds, but it
keeps the geometry safe if that floor ever moves.

## Tests

- `smoke.mjs`: add `draftAngle: 0` to the `params` override on the three
  ground-truth-pinned bins, so they keep measuring against the STEP ground
  truth — the same escape hatch already used for `ribWidth: 1.2`. Re-baseline
  the two self-derived volumes (`perimeter-square-corners`, `solid-block`).
  **Every bounding box is unchanged**: draft shrinks feature widths, never the
  proud depth that sets the extents.
- `scaling-test.mjs`: the rib/groove width probes run at ±30–45% tolerance
  against a ~1.7% volume shrink, so no change is expected. Verify by running,
  not by assuming.

## Docs

- `docs/casefinity-spec.md` → v0.3: the §4.1/§4.2 geometry tables, REQ-4.1 and
  REQ-4.2, a §2 datum entry, the "nominal at the wall face" rule and the
  mixed-draft compatibility note. Regenerate with `npm run build-spec`.
- `docs/models.md`: the new "Module features" parameter and the draft under
  intentional deviations.
- `docs/printing.md`: the chamfered mouth marks the screw entry.
