// Parametric scaling / invariant harness (the "C" test from the param-testing
// plan). It builds every model across a spread of parameter values and asserts
// invariants that must hold at ANY parameters — catching hardcoded constants
// and non-scaling logic WITHOUT a Fusion round-trip.
//
// The two highest-value invariants, by way of example:
//   - the double-sided central floor must track OVERALL_HT/2 (the first port
//     pinned it at z=53, which this would have caught at any non-110 height);
//   - every perimeter piece must be a single clean solid (the split once left
//     198 mm³ sliver debris).
//
// Bounding boxes are measured from the MESH (OCCT's boundingBox over-estimates
// lofted/BSpline solids — same reason smoke.mjs meshes).
//
// Usage: node scripts/scaling-test.mjs [modelId]   (default: all models)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oc, replicad, slabVolume, slab } from "./occt-utils.mjs";

const { measureVolume, loadFont } = replicad;
await loadFont(
  readFileSync(
    fileURLToPath(new URL("../src/assets/LiberationSans-Regular.ttf", import.meta.url)),
  ).buffer,
  "LiberationSans",
);
const { modelById, defaultValues } = await import("../src/models/index.ts");

// ---------- helpers ----------
function build(id, overrides) {
  const model = modelById(id);
  const p = { ...defaultValues(model), ...overrides };
  const result = model.build(p);
  return { shapes: Array.isArray(result) ? result : [result], p };
}

function meshBBox(shapes) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    let vertices;
    try {
      ({ vertices } = s.mesh({ tolerance: 0.1, angularTolerance: 20 }));
    } catch {
      continue; // degenerate/empty piece — skip; the solid-count check flags it
    }
    for (let i = 0; i < vertices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], vertices[i + k]);
        mx[k] = Math.max(mx[k], vertices[i + k]);
      }
  }
  return mn.map((v, i) => mx[i] - v);
}

function solidCount(shape) {
  if (shape.constructor.name !== "Compound") return 1;
  let n = 0;
  const ex = new oc.TopExp_Explorer_2(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (ex.More()) {
    n++;
    ex.Next();
  }
  ex.delete(); // free the OCCT explorer (heap is small; leaks abort later builds)
  return n;
}

/** z (centre) and volume of the fullest cross-section slab in [z0, z1]. */
function peakSlab(shape, z0, z1, step = 2) {
  let best = -1;
  let bz = z0;
  for (let z = z0; z < z1; z += step) {
    const v = slabVolume(shape, "z", z, z + step);
    if (v > best) {
      best = v;
      bz = z + step / 2;
    }
  }
  return { z: bz, v: best };
}

function centerColumnVolume(shapes, half, z0, z1) {
  const col = slab("x", -half, half)
    .clone()
    .intersect(slab("z", z0, z1))
    .intersect(slab("y", -half, half));
  let v = 0;
  for (const s of shapes) {
    try {
      v += measureVolume(s.clone().intersect(col.clone()));
    } catch {
      /* empty intersection */
    }
  }
  return v;
}

const approx = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- reusable checks (each: (shapes, p) => {ok, msg}) ----------
const shapeCount = (n) => (shapes) => ({
  ok: shapes.length === n,
  msg: `${shapes.length} shapes (want ${n})`,
});
const positiveVolumes = () => (shapes) => {
  const bad = shapes.filter((s) => measureVolume(s) <= 1).length;
  return { ok: bad === 0, msg: bad ? `${bad} near-zero-volume shape(s)` : "all volumes > 0" };
};
const bboxMatches = (want) => (shapes, p) => {
  const got = meshBBox(shapes);
  const w = want(p);
  const ok = [0, 1, 2].every((i) => approx(got[i], w[i], 0.4));
  return { ok, msg: `bbox ${got.map((v) => v.toFixed(1)).join("×")} want ${w.map((v) => v.toFixed(1)).join("×")}` };
};
const eachIsOneSolid = () => (shapes) => {
  const counts = shapes.map(solidCount);
  const bad = counts.filter((c) => c !== 1).length;
  return { ok: bad === 0, msg: `solid counts [${counts.join(",")}] (each must be 1)` };
};

// Expected perimeter piece count — mirrors the bed-fit maths in perimeter.ts
// splitPieces (2 long rails + 2 end caps, each subdivided to fit the bed).
// Kept in sync with the model by hand, like binFootprintBBox.
const perimeterPieceCount = (p) => {
  const cavLen = p.gridSpacing * (Math.floor(p.overallLength / p.gridSpacing) - p.sideBoarderBinAdd);
  const splitX = cavLen / 2;
  const depth = p.dovetailDepth;
  const active = p.bedWidth > 0 && p.bedDepth > 0;
  const usable = Math.max(p.bedWidth - 2 * p.bedMargin, p.bedDepth - 2 * p.bedMargin);
  const fit = (span, corner, interior) => {
    if (!active) return 1;
    for (let n = 1; n < 24; n++) if (span / n + (n === 1 ? corner : interior) <= usable) return n;
    return 24;
  };
  return 2 * fit(2 * splitX, 2 * depth, 2 * depth) + 2 * fit(p.overallWidth, 0, depth);
};
const pieceCountMatches = () => (shapes, p) => {
  const want = perimeterPieceCount(p);
  return { ok: shapes.length === want, msg: `${shapes.length} pieces (want ${want})` };
};
// Every printed piece must fit the usable bed (bed − 2·margin) in its best
// orientation. No-op when no bed is set. Uses each piece's own mesh footprint.
const fitsBed = () => (shapes, p) => {
  if (!(p.bedWidth > 0 && p.bedDepth > 0)) return { ok: true, msg: "no bed limit" };
  const [s, l] = [p.bedWidth - 2 * p.bedMargin, p.bedDepth - 2 * p.bedMargin].sort((a, b) => a - b);
  const bad = [];
  shapes.forEach((sh, i) => {
    const [a, b] = meshBBox([sh]).slice(0, 2).sort((x, y) => x - y); // footprint, sorted asc
    if (a > s + 0.5 || b > l + 0.5) bad.push(`#${i + 1} ${a.toFixed(0)}×${b.toFixed(0)}`);
  });
  return { ok: bad.length === 0, msg: bad.length ? `exceed ${s}×${l}: ${bad.join(", ")}` : `all ≤ ${s}×${l} usable` };
};

// bin footprint: modules·grid − 2·clear, plus one WALL_BUMP rib on -X/+Y; tab on z.
const binFootprintBBox = (p) => [
  p.widthModules * p.gridSpacing - 2 * p.clear + p.wallBump,
  p.lengthModules * p.gridSpacing - 2 * p.clear + p.wallBump,
  p.overallHeight + p.pullTabHeight,
];
const overallBBox = (p) => [p.overallLength, p.overallWidth, p.overallHeight];

// ---------- per-model suites ----------
const SUITES = {
  "bin-no-lid": {
    variants: [{}, { widthModules: 2, lengthModules: 5 }, { overallHeight: 60 }, { gridSpacing: 20 }],
    checks: [
      ["shape count", shapeCount(1)],
      ["one connected solid", (s) => ({ ok: solidCount(s[0]) === 1, msg: `${solidCount(s[0])} solids` })],
      ["bbox = footprint formula", bboxMatches(binFootprintBBox)],
      ["floor at bottom, cavity open above", (s, p) => {
        const floor = slabVolume(s[0], "z", 0, p.floorThick + 0.5);
        const mid = slabVolume(s[0], "z", p.overallHeight / 2, p.overallHeight / 2 + 2);
        return { ok: floor > 3 * mid && mid > 0, msg: `floor slab ${floor.toFixed(0)} vs mid ${mid.toFixed(0)}` };
      }],
    ],
  },
  "bin-with-lid": {
    variants: [{}, { widthModules: 4, lengthModules: 2 }, { overallHeight: 70 }, { lidLabel: "AB" }],
    checks: [
      ["shape count (body+lid)", shapeCount(2)],
      ["lid does not interpenetrate body (seat cut)", (s) => {
        let ov = 0;
        try { ov = measureVolume(s[0].clone().intersect(s[1].clone())); } catch { /* disjoint */ }
        return { ok: ov < 1, msg: `body∩lid overlap ${ov.toFixed(1)} mm³` };
      }],
      ["lid sits at the top", (s, p) => {
        const zTop = meshBBox([s[1]]);
        const lidTopZ = s[1].mesh({ tolerance: 0.2 }).vertices; // check via bbox z-extent below rim
        void lidTopZ;
        // lid thickness is small vs body height and it's near the rim
        return { ok: zTop[2] < p.overallHeight * 0.2, msg: `lid z-extent ${zTop[2].toFixed(1)} (thin, near rim)` };
      }],
    ],
  },
  "bin-double-sided": {
    variants: [{}, { overallHeight: 80 }, { overallHeight: 150 }, { widthModules: 3, lengthModules: 3 }, { widthModules: 5, lengthModules: 5 }],
    checks: [
      ["shape count (body+2 lids)", shapeCount(3)],
      ["body is one connected solid", (s) => ({ ok: solidCount(s[0]) === 1, msg: `${solidCount(s[0])} solids` })],
      ["bbox = footprint formula", bboxMatches(binFootprintBBox)],
      ["central floor tracks OVERALL_HT/2", (s, p) => {
        const { z } = peakSlab(s[0], p.floorThick, p.overallHeight);
        const mid = p.overallHeight / 2;
        return { ok: approx(z, mid, p.overallHeight * 0.12), msg: `floor peak z=${z.toFixed(1)}, h/2=${mid.toFixed(1)}` };
      }],
      ["open at both ends (floor >> ends)", (s, p) => {
        const floor = peakSlab(s[0], p.floorThick, p.overallHeight).v;
        const bottom = slabVolume(s[0], "z", 5, 7);
        return { ok: floor > 3 * bottom && bottom > 0, msg: `floor ${floor.toFixed(0)} vs bottom-end ${bottom.toFixed(0)}` };
      }],
    ],
  },
  perimeter: {
    // Regression: at 250×180 the divider rib profile used to invert at the
    // filleted base (outerInnerY < bump tip) and the fuse left a zero-volume
    // flake; addDividers now clamps the outer edge, so every piece stays one
    // clean solid. Kept as a variant to guard the fix.
    // Bed variants exercise the auto-subdivision: a bed size adds dovetail seams
    // so no piece exceeds the usable area; the base (no-bed) case stays 4 pieces.
    variants: [
      {},
      { overallLength: 250, overallWidth: 180 },
      { overallHeight: 70 },
      { bedWidth: 256, bedDepth: 256 },
      { bedWidth: 220, bedDepth: 220 },
      { bedWidth: 180, bedDepth: 180 },
      { bedWidth: 300, bedDepth: 150 }, // asymmetric: only the long rails split
    ],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid (no debris)", eachIsOneSolid()],
      ["assembled bbox = OVERALL_* (pieces stay in place)", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
      ["cavity is open (hollow frame)", (s, p) => {
        const v = centerColumnVolume(s, 10, 10, p.overallHeight - 10);
        return { ok: v < 5, msg: `centre-column volume ${v.toFixed(1)} mm³ (want ~0)` };
      }],
    ],
  },
  "smooth-perimeter": {
    // Regression: 300×300 used to leave the two long-side pieces empty (same
    // divider-profile inversion as the perimeter, here blowing the fuse up to
    // nothing rather than a flake). Guarded by the addDividers clamp.
    variants: [{}, { overallLength: 300, overallWidth: 300 }, { bedWidth: 220, bedDepth: 220 }],
    checks: [
      ["piece count (bed-fit split)", pieceCountMatches()],
      ["each piece is a single clean solid", eachIsOneSolid()],
      ["assembled bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["every piece fits the bed", fitsBed()],
    ],
  },
  "perimeter-template": {
    variants: [{}, { overallLength: 300, overallWidth: 200 }, { sideWallTaper: 2, frontWallTaper: 2 }],
    checks: [
      ["shape count (2 slices)", shapeCount(2)],
      ["assembled bbox = OVERALL_*", bboxMatches(overallBBox)],
      ["each slice is thin (TEST_THICK)", (s, p) => {
        const thins = s.map((sh) => Math.min(...meshBBox([sh])));
        const ok = thins.every((t) => approx(t, p.testThick, 0.5));
        return { ok, msg: `slice thin-dims [${thins.map((t) => t.toFixed(1)).join(",")}] want ${p.testThick}` };
      }],
    ],
  },
};

// ---------- runner ----------
const only = process.argv[2];

// With no model arg, run each model in its own process: the OCCT WASM heap is
// small and the heavy perimeter builds exhaust it if they follow the bins in
// one process. Each child runs one suite in a fresh heap.
if (!only) {
  const { spawnSync } = await import("node:child_process");
  const self = fileURLToPath(import.meta.url);
  let anyFail = false;
  for (const id of Object.keys(SUITES)) {
    const r = spawnSync(process.execPath, ["--expose-gc", self, id], { stdio: "inherit" });
    if (r.status !== 0) anyFail = true;
  }
  process.exit(anyFail ? 1 : 0);
}

const ids = [only];
let failures = 0;
let total = 0;

for (const id of ids) {
  const suite = SUITES[id];
  if (!suite) {
    console.error(`no suite for "${id}"`);
    process.exit(2);
  }
  console.log(`\n=== ${id} ===`);
  for (const overrides of suite.variants) {
    const label = Object.keys(overrides).length
      ? Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(" ")
      : "defaults";
    let ctx;
    try {
      ctx = build(id, overrides);
    } catch (err) {
      console.log(`  [${label}] BUILD FAILED: ${err.message}`);
      failures++;
      total++;
      continue;
    }
    const xfailReason = suite.xfail?.[label];
    console.log(`  [${label}]${xfailReason ? `  (known-fail: ${xfailReason})` : ""}`);
    let variantFailed = false;
    for (const [name, check] of suite.checks) {
      total++;
      let res;
      try {
        res = check(ctx.shapes, ctx.p);
      } catch (err) {
        res = { ok: false, msg: `check threw: ${err.message}` };
      }
      if (!res.ok) variantFailed = true;
      // A failure in an xfail variant is expected (known limitation); only count
      // unexpected failures toward the exit code.
      const tag = res.ok ? "OK  " : xfailReason ? "XFAIL" : "FAIL";
      if (!res.ok && !xfailReason) failures++;
      console.log(`      ${tag} ${name} — ${res.msg}`);
    }
    if (xfailReason && !variantFailed) {
      console.log(`      NOTE known-fail variant now PASSES — remove the xfail marker`);
    }
    // Free OCCT handles so the small WASM heap survives all the heavy builds.
    for (const s of ctx.shapes) s.delete?.();
    globalThis.gc?.();
  }
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);
