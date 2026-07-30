# Casefinity

A browser-based parametric model generator for the **"Gridfinity for Hardcases"**
system — 3D-printable inserts that turn a hard case into organized tool and parts
storage.

Pick a model, adjust the parameters, and download a printable STL, STEP, or 3MF.
Models are defined as code against the [replicad](https://replicad.xyz/) API — an
OpenCascade B-rep kernel compiled to WASM — and built in a web worker. **The site
is fully static: there is no backend, and your models never leave your computer.**

## What you can generate

| Model | What it is |
|---|---|
| **Perimeter (frame)** | The liner frame that seats in the case. Splits into dovetailed pieces, auto-subdividing to fit your print bed |
| **Smooth Perimeter** | The same frame with a 42 mm grid and no bumps, for standard Gridfinity interiors |
| **Perimeter (square corners)** | Squared cavity corners so a bin can sit flush in the corner-most cell (beta) |
| **Perimeter template** | Two 1 mm cross-sections of the case wall — print these first to check the fit |
| **Bin (no lid)** | The basic storage bin |
| **Bin with lid** | Bin plus a retained sliding lid with an engravable label |
| **Bin (double sided)** | Open at both ends with a central floor and two lids |
| **Solid block** | Uncut stock with the bin footprint and interlocks, for cutting your own pockets in CAD |

Bins interlock with each other and with the liner through a shared registration
interface, so parts mix freely — as long as they agree on **Grid bump width**
(see [Interoperability](docs/printing.md#interoperability-warning)).

## Quick start

Requires Node. Everything runs from the app directory:

```bash
cd hardcase-gridfinity-generator
npm install
npm run dev      # dev server
```

Then open the URL it prints. The OCCT WASM kernel loads once on first use, so the
first build takes a few seconds.

To verify a checkout is sound:

```bash
npm run build    # type-check + production build
npm run smoke    # build every model headlessly, assert against ground truth
```

## Documentation

**Printing something?**

- **[Printing guide](docs/printing.md)** — export formats, print clearances,
  fitting an oversized frame to your bed, and the screw-boss hardware
- **[Case dimensions](docs/case-dimensions.md)** — measured hard case interiors
  and how to enter them
- **[Model catalog](docs/models.md)** — every model, its fidelity to the
  original, and every parameter its form exposes

**Working on the code?**

- **[Developer guide](hardcase-gridfinity-generator/README.md)** — commands,
  architecture, script reference, deployment
- **[Reverse-engineering notes](docs/reverse-engineering.md)** — how the ports
  were reconstructed, the OCCT traps, and the recovered geometry
- **[Recovered Fusion parameters](docs/f3d-parameters.md)** — the original user
  parameters, defaults, and driving expressions
- **[Casefinity specification](docs/casefinity-spec.md)** — a proposed
  interoperability spec for the grid, interlocks, and tolerance stack-up

## Repository layout

```
README.md                       this file
LICENSE                         MIT, code only — see Design provenance
docs/                           documentation (above), plus superpowers/
                                for historical design specs and plans
aps_f3d_to_step.py              regenerates the ground truth from .f3d sources
                                via the Autodesk Model Derivative API
hardcase-gridfinity-generator/  the app — Vite + TypeScript + replicad
  src/models/                   one file per model: parameter schema + build()
  scripts/                      test and geometry-analysis tooling
  ground-truth/                 STEP exports of the originals; the porting tests
                                measure against these
```

The original `.f3d` design files are **not** included in this repository — see
below. Everything here works without them: the STEP ground truth is committed, so
the tests run on a fresh clone. Only `aps_f3d_to_step.py`, which regenerates that
ground truth, needs the sources.

## Design provenance

**The "Gridfinity for Hardcases" designs are not mine.** They are the work of the
**Unemployed Architect**, who distributes them through
[Patreon](https://www.patreon.com/cw/UnemployedArchitect) — there is also a
[video introduction](https://www.youtube.com/watch?v=YSqm821ekR4) and the
[original post](https://www.patreon.com/UnemployedArchitect/posts/gridfinity-for-162320687).
**If you find this generator useful, support him.**

This repository is an independent reimplementation of those designs' *geometry* as
parametric code. The original `.f3d` files are Fusion 360 archives that no open
tooling can parse, so nothing here is converted from them; the models were
reconstructed by measuring STEP exports and reading out the recoverable user
parameters. The `.f3d` sources themselves are deliberately not redistributed here.

What that means in practice:

- **The MIT license covers the code and documentation in this repository** — the
  replicad model implementations, the app, and the tooling.
- **It does not cover the underlying physical designs.** Models you generate are
  subject to the original designer's terms, not this license.
- Licensing of the designs for a public generator has **not** been formally
  resolved with the creator. This is stated plainly rather than resolved. If you
  are the creator and want something changed here, please get in touch.

Some model *defaults* deliberately differ from the originals for printability —
a heavier wall and floor, and a wider grid bump. These are documented in
[Intentional deviations](docs/models.md#intentional-deviations-from-the-originals).

The bundled Liberation Sans font is under the SIL Open Font License.

## Contributing

Issues and pull requests are welcome. Useful contributions, roughly in order of
value:

- **Measured interior dimensions for more hard cases** — see
  [case-dimensions.md](docs/case-dimensions.md)
- **Fit reports** — print the perimeter template against a real case and say what
  happened
- **Model fidelity fixes**, with a `scripts/diff-model.mjs` run to back them up

If you are changing geometry, `npm run smoke` and `npm run scaling` are the gates;
[the developer guide](hardcase-gridfinity-generator/README.md) explains what each
one checks.

## Contact

Chris Agocs — [casefinity@agocs.org](mailto:casefinity@agocs.org)
