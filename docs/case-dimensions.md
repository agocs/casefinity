# Measured hard case interiors

To generate a liner that fits your case you need its **interior** dimensions,
not the advertised exterior ones. Measure the usable box below the lid seal:
length, width, and the depth available to the liner.

Feed those into the perimeter's **Case length**, **Case width**, and **Case
depth** parameters. Leave **Case clearance** at `0` for a nominal fit, or set it
to roughly `0.15` mm to inset the whole outer envelope and give the print some
slip room — real cases have draft, mould seams, and radii that a nominal
envelope does not account for.

| Case | Length (mm) | Width (mm) | Depth (mm) |
|---|---|---|---|
| Apache 3800 | 377.825 | 268.2875 | 110 |
| Apache 4800 | 454.025 | 323.85 | 125 |

The generator's defaults are **350 × 250 × 110**, inherited from the original
Fusion 360 files rather than from any particular case — so expect to change them.

A full-size frame is larger than most print beds even after the standard 4-way
dovetail split. Set **Printer bed width** / **Printer bed depth** and the
perimeter will subdivide itself to fit; see [printing.md](printing.md).

Measured another case? The numbers are welcome — see *Contributing* in the
[root README](../README.md).
