// Orthographic depth-map PNG rendering for replicad shapes (pure JS, no
// browser). Brighter = closer to the viewer. Views along x, y, z.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function writePng(path, pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/**
 * Render orthographic depth maps of shapes along the x, y and z axes.
 * Writes <outPrefix>-x.png, -y.png, -z.png.
 */
export function renderViews(shapes, outPrefix, size = 400, views = ["x", "y", "z"]) {
  const meshes = shapes.map((s) =>
    s.mesh({ tolerance: 0.05, angularTolerance: 15 }),
  );
  const axisIndex = { x: 0, y: 1, z: 2 };

  for (const name of views) {
    const axis = axisIndex[name];
    const [ua, va] = [0, 1, 2].filter((a) => a !== axis);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    let dMin = Infinity, dMax = -Infinity;
    for (const m of meshes) {
      for (let i = 0; i < m.vertices.length; i += 3) {
        uMin = Math.min(uMin, m.vertices[i + ua]); uMax = Math.max(uMax, m.vertices[i + ua]);
        vMin = Math.min(vMin, m.vertices[i + va]); vMax = Math.max(vMax, m.vertices[i + va]);
        dMin = Math.min(dMin, m.vertices[i + axis]); dMax = Math.max(dMax, m.vertices[i + axis]);
      }
    }
    const pad = 2;
    const scale = (size - 2 * pad) / Math.max(uMax - uMin, vMax - vMin, 1e-9);
    const width = Math.ceil((uMax - uMin) * scale) + 2 * pad;
    const height = Math.ceil((vMax - vMin) * scale) + 2 * pad;
    const depth = new Float32Array(width * height).fill(-Infinity);

    for (const m of meshes) {
      const V = m.vertices, T = m.triangles;
      for (let t = 0; t < T.length; t += 3) {
        const p = [T[t] * 3, T[t + 1] * 3, T[t + 2] * 3];
        const xs = p.map((i) => pad + (V[i + ua] - uMin) * scale);
        const ys = p.map((i) => pad + (V[i + va] - vMin) * scale);
        const ds = p.map((i) => V[i + axis]);
        const minX = Math.max(0, Math.floor(Math.min(...xs)));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
        const minY = Math.max(0, Math.floor(Math.min(...ys)));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
        const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
        if (Math.abs(area) < 1e-12) continue;
        for (let py = minY; py <= maxY; py++) {
          for (let px = minX; px <= maxX; px++) {
            const w0 = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
            const w1 = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
            const d = w0 * ds[0] + w1 * ds[1] + w2 * ds[2];
            const idx = py * width + px;
            if (d > depth[idx]) depth[idx] = d;
          }
        }
      }
    }

    const pixels = Buffer.alloc(width * height);
    const range = dMax - dMin || 1;
    for (let i = 0; i < depth.length; i++) {
      pixels[i] = depth[i] === -Infinity ? 0 : 40 + Math.round((215 * (depth[i] - dMin)) / range);
    }
    const out = `${outPrefix}-${name}.png`;
    writePng(out, pixels, width, height);
    console.log(`${out}: ${width}x${height}, ${name}-range ${dMin.toFixed(1)}..${dMax.toFixed(1)}`);
  }
}
