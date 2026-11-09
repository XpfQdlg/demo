import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════════════
   Procedural canvas textures — everything is generated at runtime, so the
   final build stays a single self-contained HTML file with no image assets.

   Quality notes:
   · every surface is built from tileable multi-octave value noise, so it does
     not show obvious repetition or "flat colour" look;
   · each colour map can spawn a derived normal map (normalFrom) and a
     roughness map (roughFrom), which is what makes the surfaces read as
     physical material instead of painted cardboard;
   · anisotropY is pushed to the renderer maximum for grazing-angle clarity.
   ══════════════════════════════════════════════════════════════════════════ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();
const ANISO = 16;

function canvas(size, h = size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = h;
  return c;
}

function build(key, draw, size = 256) {
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** clone with independent repeat so one canvas can serve many surfaces */
export function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = ANISO;
  return t;
}

/* ══════════════════════════════════════════════════════════════════════════
   noise helpers
   ══════════════════════════════════════════════════════════════════════════ */

/** tileable value-noise field, `cells` lattice points across the tile */
function valueField(size, cells, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  const step = cells / size;
  const sm = (t) => t * t * (3 - 2 * t); // smoothstep
  for (let y = 0; y < size; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = g[ya + xa] + (g[ya + xb] - g[ya + xa]) * tx;
      const b = g[yb + xa] + (g[yb + xb] - g[yb + xa]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** fractal sum of value noise, normalized to 0..1 */
export function fbmField(size, { cells = 4, octaves = 4, seed = 1, gain = 0.5 } = {}) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = valueField(size, Math.max(2, Math.round(cells * Math.pow(2, o))), seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  // stretch contrast a little so the surface is not muddy
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] - 0.5) * 1.25 + 0.5));
  return out;
}

const hex2rgb = (h) => {
  const c = new THREE.Color(h);
  return [c.r * 255, c.g * 255, c.b * 255];
};

/** paint a noise field straight into pixels through a colour ramp */
function paintField(ctx, size, field, stops, opacity = 1) {
  const cols = stops.map(([pos, hex]) => [pos, hex2rgb(hex)]);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    let a = cols[0];
    let b = cols[cols.length - 1];
    for (let k = 0; k < cols.length - 1; k++) {
      if (v >= cols[k][0] && v <= cols[k + 1][0]) {
        a = cols[k];
        b = cols[k + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const t = Math.min(1, Math.max(0, (v - a[0]) / span));
    const j = i * 4;
    d[j] = d[j] * (1 - opacity) + (a[1][0] + (b[1][0] - a[1][0]) * t) * opacity;
    d[j + 1] = d[j + 1] * (1 - opacity) + (a[1][1] + (b[1][1] - a[1][1]) * t) * opacity;
    d[j + 2] = d[j + 2] * (1 - opacity) + (a[1][2] + (b[1][2] - a[1][2]) * t) * opacity;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function speckle(ctx, size, n, colors, rMin, rMax, alpha = 0.5) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.35 + Math.random() * 0.65);
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = rMin + Math.random() * (rMax - rMin);
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, r, r * (0.5 + Math.random()), Math.random() * 3.14, 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** soft irregular blob (stains, moss, rust) */
function blob(ctx, x, y, r, color, alpha = 0.3, lobes = 7) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rr = r * (0.65 + Math.random() * 0.6);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.8;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.quadraticCurveTo(x + Math.cos(a - 0.4) * rr * 1.2, y + Math.sin(a - 0.4) * rr, px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   derived maps — normal + roughness, computed from the colour canvas
   ══════════════════════════════════════════════════════════════════════════ */
const normByCanvas = new WeakMap();
const roughByCanvas = new WeakMap();

function luminanceOf(cv) {
  const w = cv.width;
  const h = cv.height;
  const src = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) / 255;
  }
  return { lum: out, w, h };
}

/** 3×3 wrap-around blur — tames per-pixel speckle before differentiation */
function blurWrap(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const y0 = y * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      out[y0 + x] =
        (src[ym + xm] + src[ym + x] + src[ym + xp] + src[y0 + xm] + src[y0 + x] * 2 + src[y0 + xp] + src[yp + xm] + src[yp + x] + src[yp + xp]) / 10;
    }
  }
  return out;
}

/**
 * Tangent-space normal map derived from a colour texture's luminance.
 * Cached per (canvas, strength) so re-tiling never recomputes it.
 */
export function normalFrom(tex, strength = 2.4) {
  const cv = tex.image;
  if (!cv || !cv.width) return null;
  let m = normByCanvas.get(cv);
  if (!m) {
    m = new Map();
    normByCanvas.set(cv, m);
  }
  const hit = m.get(strength);
  if (hit) return hit;

  const { lum, w, h } = luminanceOf(cv);
  const hgt = blurWrap(lum, w, h);
  const out = canvas(w, h);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const y0 = y * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (hgt[y0 + xp] - hgt[y0 + xm]) * strength;
      const dy = (hgt[yp + x] - hgt[ym + x]) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const p = (y0 + x) * 4;
      d[p] = (-dx * inv * 0.5 + 0.5) * 255;
      d[p + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[p + 2] = (inv * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  m.set(strength, t);
  return t;
}

/** Roughness map: bright (polished) pixels slightly smoother, dark ones matte. */
export function roughFrom(tex, lo = 0.55, hi = 1.0) {
  const cv = tex.image;
  if (!cv || !cv.width) return null;
  let m = roughByCanvas.get(cv);
  if (!m) {
    m = new Map();
    roughByCanvas.set(cv, m);
  }
  const key = lo + ":" + hi;
  if (m.has(key)) return m.get(key);

  const { lum, w, h } = luminanceOf(cv);
  const out = canvas(w, h);
  const ctx = out.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < lum.length; i++) {
    const v = (lo + (1 - lum[i]) * (hi - lo)) * 255;
    const p = i * 4;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  m.set(key, t);
  return t;
}

/* ══════════════════════════════════════════════════════════════════════════
   surfaces
   ══════════════════════════════════════════════════════════════════════════ */

/* ── foliage: clustered leaf canopy ─────────────────────────────────────── */
export const foliageTex = (base = "#4d7a34", dark = "#2c4a1d", lit = "#7fae4e") =>
  build(
    "foliage" + base,
    (ctx, s) => {
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 5, octaves: 5, seed: 33, gain: 0.56 }),
        [
          [0.0, dark],
          [0.35, base],
          [0.7, lit],
          [1.0, "#a6cc74"],
        ],
        0.85
      );
      // leaf clusters: many small ellipses with a lit top edge
      for (let i = 0; i < 2200; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 2 + Math.random() * 7;
        const a = Math.random() * Math.PI;
        ctx.globalAlpha = 0.16 + Math.random() * 0.5;
        ctx.fillStyle = ["#3c6127", "#548a35", "#6fa844", "#8ec05e", "#2b451a", "#a9cd7c"][(Math.random() * 6) | 0];
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.35 + Math.random() * 0.35), a, 0, 6.283);
        ctx.fill();
      }
      // deep shadow pockets between clumps
      for (let i = 0; i < 90; i++) {
        blob(ctx, Math.random() * s, Math.random() * s, 10 + Math.random() * 30, "#1d3012", 0.18, 6);
      }
      // sky-bright specular tips
      for (let i = 0; i < 700; i++) {
        ctx.globalAlpha = 0.1 + Math.random() * 0.3;
        ctx.fillStyle = "#cfe89a";
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 1 + Math.random() * 2.4;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.55, Math.random() * Math.PI, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── ground: grass ──────────────────────────────────────────────────────── */
export const grassTex = () =>
  build(
    "grass",
    (ctx, s) => {
      ctx.fillStyle = "#5d8244";
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 3, octaves: 5, seed: 21, gain: 0.55 }),
        [
          [0.0, "#3f5c2c"],
          [0.35, "#547a3a"],
          [0.62, "#6d9450"],
          [0.85, "#86a962"],
          [1.0, "#9cbb72"],
        ],
        0.9
      );
      // clumps: bright tufts and dark shadows between them
      for (let i = 0; i < 120; i++) {
        blob(ctx, Math.random() * s, Math.random() * s, 8 + Math.random() * 26, Math.random() > 0.5 ? "#2f4a21" : "#a8c47e", 0.1, 6);
      }
      // bare soil patches with soft edges
      for (let i = 0; i < 16; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 12 + Math.random() * 34;
        for (let k = 0; k < 6; k++) blob(ctx, x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, r * 0.5, "#6a5636", 0.16, 7);
      }
      // blades — thin, varied, slight highlights
      for (let i = 0; i < 5200; i++) {
        ctx.globalAlpha = 0.14 + Math.random() * 0.42;
        ctx.strokeStyle = ["#6f9c47", "#8cb85a", "#3c5c26", "#a3c46c", "#4f7233", "#2f4a1f"][(Math.random() * 6) | 0];
        ctx.lineWidth = 0.6 + Math.random() * 1.0;
        const x = Math.random() * s;
        const y = Math.random() * s;
        const l = 2 + Math.random() * 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 3, y - l * 0.6, x + (Math.random() - 0.5) * 3.4, y - l);
        ctx.stroke();
      }
      // dry leaves + tiny flowers
      speckle(ctx, s, 90, ["#8d7a3c", "#a8914a", "#6d5c2c"], 1.2, 3.4, 0.5);
      speckle(ctx, s, 40, ["#dfe8c8", "#e8d98a"], 0.8, 1.6, 0.55);
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── ground: forest floor / dirt ────────────────────────────────────────── */
export const dirtTex = () =>
  build(
    "dirt",
    (ctx, s) => {
      ctx.fillStyle = "#6a5738";
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 3, octaves: 5, seed: 7, gain: 0.55 }),
        [
          [0.0, "#3d3122"],
          [0.3, "#5b482e"],
          [0.55, "#75603c"],
          [0.8, "#8a7449"],
          [1.0, "#9c8557"],
        ],
        0.92
      );
      // pebbles — kept sparse and low-contrast, otherwise the tiled path reads
      // as confetti once the normal map starts catching highlights
      for (let i = 0; i < 130; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 1.1 + Math.random() * 2.4;
        ctx.globalAlpha = 0.28 + Math.random() * 0.22;
        ctx.fillStyle = ["#7d786c", "#6b665b", "#86806f", "#5d584e"][(Math.random() * 4) | 0];
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * 3.14, 0, 6.283);
        ctx.fill();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = "#b8b2a2";
        ctx.beginPath();
        ctx.ellipse(x - r * 0.25, y - r * 0.3, r * 0.4, r * 0.26, 0, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // wheel ruts
      for (let k = 0; k < 2; k++) {
        const y = s * (0.25 + k * 0.42);
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#3a2e1d";
        ctx.fillRect(0, y, s, 10 + Math.random() * 8);
      }
      // leaf litter
      speckle(ctx, s, 260, ["#7a6535", "#8d7639", "#584a26", "#a08a4a"], 1.2, 4.5, 0.45);
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── ground: asphalt ───────────────────────────────────────────────────── */
export const asphaltTex = () =>
  build(
    "asphalt",
    (ctx, s) => {
      ctx.fillStyle = "#3a3d42";
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 2, octaves: 5, seed: 33, gain: 0.6 }),
        [
          [0.0, "#2c2f34"],
          [0.4, "#3a3d43"],
          [0.7, "#4a4e55"],
          [1.0, "#585d64"],
        ],
        0.85
      );
      // coarse aggregate
      for (let i = 0; i < 5200; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 0.5 + Math.random() * 1.9;
        ctx.globalAlpha = 0.25 + Math.random() * 0.5;
        ctx.fillStyle = ["#585d64", "#2b2e33", "#6a6f77", "#1f2226", "#7a7f86"][(Math.random() * 5) | 0];
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.7 + Math.random() * 0.6), Math.random() * 3.14, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // tar-sealed cracks
      for (let i = 0; i < 12; i++) {
        let x = Math.random() * s;
        let y = Math.random() * s;
        ctx.strokeStyle = "#191b1f";
        ctx.lineWidth = 1.4 + Math.random() * 2.2;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 7; k++) {
          x += (Math.random() - 0.5) * 56;
          y += (Math.random() - 0.5) * 56;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = "#6d727a";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      // oily stains
      for (let i = 0; i < 18; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + Math.random() * 46);
        g.addColorStop(0, "rgba(18,20,24,0.35)");
        g.addColorStop(1, "rgba(18,20,24,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 66, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── concrete / pavement blocks ─────────────────────────────────────────── */
export const concreteTex = (base = "#9a9ea3", line = "#7c8085") =>
  build(
    "concrete" + base + line,
    (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      const col = new THREE.Color(base);
      const dark = col.clone().multiplyScalar(0.72).getStyle();
      const light = col.clone().multiplyScalar(1.16).getStyle();
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 2, octaves: 5, seed: 51, gain: 0.58 }),
        [
          [0.0, dark],
          [0.45, base],
          [1.0, light],
        ],
        0.7
      );
      // fine aggregate
      speckle(ctx, s, 2600, [light, dark, "#ffffff", "#5f6368"], 0.4, 1.6, 0.28);
      // weathering stains
      for (let i = 0; i < 26; i++) {
        blob(ctx, Math.random() * s, Math.random() * s, 14 + Math.random() * 50, Math.random() > 0.4 ? dark : "#7d7a70", 0.08, 8);
      }
      // hairline cracks
      for (let i = 0; i < 7; i++) {
        let x = Math.random() * s;
        let y = Math.random() * s;
        ctx.strokeStyle = "rgba(40,42,45,0.5)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (Math.random() - 0.5) * 70;
          y += (Math.random() - 0.5) * 70;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // slab joints: dark groove + light bevel above it
      const step = s / 4;
      for (let i = 0; i <= 4; i++) {
        const p = i * step;
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = line;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, s);
        ctx.moveTo(0, p);
        ctx.lineTo(s, p);
        ctx.stroke();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p - 1.6, 0);
        ctx.lineTo(p - 1.6, s);
        ctx.moveTo(0, p - 1.6);
        ctx.lineTo(s, p - 1.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── interior floor tiles ───────────────────────────────────────────────── */
export const tileTex = (base = "#c9cdd2", grout = "#9aa0a8", count = 2) =>
  build(
    "tile" + base + grout + count,
    (ctx, s) => {
      const col = new THREE.Color(base);
      ctx.fillStyle = grout;
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 2, octaves: 4, seed: 63, gain: 0.55 }),
        [
          [0.0, col.clone().multiplyScalar(0.86).getStyle()],
          [0.5, grout],
          [1.0, col.clone().multiplyScalar(1.1).getStyle()],
        ],
        0.45
      );
      const step = s / count;
      const pad = 2.5;
      for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
          const shade = 1 - Math.random() * 0.06;
          ctx.fillStyle = col.clone().multiplyScalar(shade).getStyle();
          ctx.fillRect(x * step + pad, y * step + pad, step - pad * 2, step - pad * 2);
          // polished sheen: diagonal soft gradient
          const g = ctx.createLinearGradient(x * step, y * step, x * step + step, y * step + step);
          g.addColorStop(0, "rgba(255,255,255,0.16)");
          g.addColorStop(0.45, "rgba(255,255,255,0.02)");
          g.addColorStop(1, "rgba(0,0,0,0.06)");
          ctx.fillStyle = g;
          ctx.fillRect(x * step + pad, y * step + pad, step - pad * 2, step - pad * 2);
          // bevel: light on top/left edge, shadow bottom/right
          ctx.strokeStyle = "rgba(255,255,255,0.4)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x * step + pad, (y + 1) * step - pad);
          ctx.lineTo(x * step + pad, y * step + pad);
          ctx.lineTo((x + 1) * step - pad, y * step + pad);
          ctx.stroke();
          ctx.strokeStyle = "rgba(0,0,0,0.22)";
          ctx.beginPath();
          ctx.moveTo((x + 1) * step - pad, y * step + pad);
          ctx.lineTo((x + 1) * step - pad, (y + 1) * step - pad);
          ctx.lineTo(x * step + pad, (y + 1) * step - pad);
          ctx.stroke();
          // scuffs / dirt gathering in one corner
          ctx.globalAlpha = 0.06 + Math.random() * 0.08;
          ctx.fillStyle = "#4a4f55";
          ctx.beginPath();
          ctx.ellipse(x * step + step * (0.2 + Math.random() * 0.6), y * step + step * (0.2 + Math.random() * 0.6), step * 0.16, step * 0.1, Math.random() * 3, 0, 6.283);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      speckle(ctx, s, 420, ["#b3b8be", "#6f757c", "#ffffff"], 0.4, 1.4, 0.2);
    },
    512
  );

/* ── building facade with windows ───────────────────────────────────────── */
export const facadeTex = (wall = "#b9bfc6", win = "#31414f", cols = 6, rows = 8, lit = 0.16) =>
  build(
    "facade" + wall + cols + rows + lit,
    (ctx, s) => {
      const wallCol = new THREE.Color(wall);
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 2, octaves: 4, seed: 88, gain: 0.55 }),
        [
          [0.0, wallCol.clone().multiplyScalar(0.86).getStyle()],
          [0.5, wall],
          [1.0, wallCol.clone().multiplyScalar(1.1).getStyle()],
        ],
        0.6
      );
      const cw = s / cols;
      const ch = s / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + cw * 0.18;
          const y = r * ch + ch * 0.16;
          const w = cw * 0.64;
          const h = ch * 0.56;
          const isLit = Math.random() < lit;
          // recessed frame
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
          if (isLit) {
            const g = ctx.createLinearGradient(x, y, x, y + h);
            g.addColorStop(0, "#ffe9bd");
            g.addColorStop(1, "#e8b96a");
            ctx.fillStyle = g;
          } else {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, "#3c4d5c");
            g.addColorStop(0.35, win);
            g.addColorStop(0.7, "#22303c");
            g.addColorStop(1, "#40525f");
            ctx.fillStyle = g;
          }
          ctx.fillRect(x, y, w, h);
          // sky reflection streak
          ctx.globalAlpha = isLit ? 0.06 : 0.2;
          ctx.fillStyle = "#dfeef7";
          ctx.beginPath();
          ctx.moveTo(x, y + h);
          ctx.lineTo(x + w * 0.6, y);
          ctx.lineTo(x + w * 0.85, y);
          ctx.lineTo(x + w * 0.25, y + h);
          ctx.fill();
          ctx.globalAlpha = 1;
          // mullion
          ctx.strokeStyle = "rgba(24,30,36,0.65)";
          ctx.lineWidth = 1.8;
          ctx.strokeRect(x, y, w, h);
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w / 2, y + h);
          ctx.lineWidth = 1.1;
          ctx.stroke();
          // sill highlight
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(x - 3, y + h + 2, w + 6, 2);
        }
      }
      // storey bands
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch + ch * 0.82, s, ch * 0.06);
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch + ch * 0.9, s, ch * 0.03);
      // dirt streaks running down the wall
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.04 + Math.random() * 0.05;
        ctx.fillStyle = "#4a4a44";
        const x = Math.random() * s;
        ctx.fillRect(x, Math.random() * s * 0.6, 1 + Math.random() * 3, s * (0.2 + Math.random() * 0.5));
      }
      ctx.globalAlpha = 1;
    },
    512
  );

/* ── bark ───────────────────────────────────────────────────────────────── */
export const barkTex = () =>
  build(
    "bark",
    (ctx, s) => {
      ctx.fillStyle = "#584434";
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 3, octaves: 4, seed: 12, gain: 0.6 }),
        [
          [0.0, "#33251a"],
          [0.45, "#584434"],
          [0.75, "#7a6449"],
          [1.0, "#8c7557"],
        ],
        0.85
      );
      // vertical fissures + raised ridges
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * s;
        const dark = Math.random() > 0.45;
        ctx.globalAlpha = 0.2 + Math.random() * 0.45;
        ctx.strokeStyle = dark ? ["#2a1d13", "#3a2a1c"][(Math.random() * 2) | 0] : ["#8c7355", "#a08b6b"][(Math.random() * 2) | 0];
        ctx.lineWidth = 1 + Math.random() * 4.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        let y = 0;
        let xx = x;
        while (y < s) {
          y += 10 + Math.random() * 20;
          xx += (Math.random() - 0.5) * 8;
          ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      // horizontal lenticels
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.25 + Math.random() * 0.25;
        ctx.fillStyle = "#2b1f15";
        ctx.fillRect(Math.random() * s, Math.random() * s, 3 + Math.random() * 9, 1 + Math.random() * 1.4);
      }
      // moss / lichen
      for (let i = 0; i < 22; i++) {
        blob(ctx, Math.random() * s, Math.random() * s, 4 + Math.random() * 14, Math.random() > 0.5 ? "#4c5c33" : "#6b6a4a", 0.18, 7);
      }
      ctx.globalAlpha = 1;
      speckle(ctx, s, 300, ["#2f2218", "#9c8567"], 0.6, 2.4, 0.3);
    },
    256
  );

/* ── brushed metal ──────────────────────────────────────────────────────── */
export const metalTex = (base = "#5b636d") =>
  build("metal" + base, (ctx, s) => {
    const col = new THREE.Color(base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    paintField(
      ctx,
      s,
      fbmField(s, { cells: 2, octaves: 3, seed: 5, gain: 0.5 }),
      [
        [0.0, col.clone().multiplyScalar(0.86).getStyle()],
        [0.55, base],
        [1.0, col.clone().multiplyScalar(1.1).getStyle()],
      ],
      0.55
    );
    // brushing runs horizontally
    for (let i = 0; i < 2200; i++) {
      ctx.globalAlpha = 0.03 + Math.random() * 0.07;
      ctx.strokeStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
      ctx.lineWidth = 0.5 + Math.random() * 0.7;
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (Math.random() - 0.5) * 2.4);
      ctx.stroke();
    }
    // fingerprints / smudges
    for (let i = 0; i < 10; i++) {
      blob(ctx, Math.random() * s, Math.random() * s, 6 + Math.random() * 18, "#ffffff", 0.03, 8);
    }
    ctx.globalAlpha = 1;
  });

/* ── hazard stripes ─────────────────────────────────────────────────────── */
export const stripeTex = (a = "#f2c230", b = "#1d1f22") =>
  build("stripe" + a + b, (ctx, s) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = b;
    const w = s / 8;
    ctx.save();
    ctx.translate(-s, 0);
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.moveTo(i * w * 2, 0);
      ctx.lineTo(i * w * 2 + w, 0);
      ctx.lineTo(i * w * 2 + w + s, s);
      ctx.lineTo(i * w * 2 + s, s);
      ctx.fill();
    }
    ctx.restore();
    // wear
    speckle(ctx, s, 200, ["#8a8a86", "#d8d5cc"], 0.6, 2.2, 0.25);
  });

/* ── soft glow sprite ───────────────────────────────────────────────────── */
export const glowTex = () =>
  build(
    "glow",
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.55)");
      g.addColorStop(0.55, "rgba(255,255,255,0.14)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    128
  );

/* ── flame gradient: bright at the wick, fading to nothing at the tip ────── */
export const flameTex = () =>
  build(
    "flame",
    (ctx, s) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, s, s);
      // vertical core — hot at the bottom, cool toward the top
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, "#fff6d8");
      g.addColorStop(0.18, "#ffd27a");
      g.addColorStop(0.45, "#ff8a26");
      g.addColorStop(0.72, "#a12f04");
      g.addColorStop(1, "#000000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      // wavy vertical streaks so the tongue does not look like a paper cone
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * s;
        ctx.globalAlpha = 0.1 + Math.random() * 0.22;
        ctx.fillStyle = Math.random() > 0.5 ? "#fff3c0" : "#5c1a02";
        ctx.beginPath();
        ctx.ellipse(x, s * (0.55 + Math.random() * 0.4), 2 + Math.random() * 7, s * 0.22, 0, 0, 6.283);
        ctx.fill();
      }
      // darken the very edges horizontally
      const h = ctx.createLinearGradient(0, 0, s, 0);
      h.addColorStop(0, "rgba(0,0,0,0.85)");
      h.addColorStop(0.28, "rgba(0,0,0,0)");
      h.addColorStop(0.72, "rgba(0,0,0,0)");
      h.addColorStop(1, "rgba(0,0,0,0.85)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = h;
      ctx.fillRect(0, 0, s, s);
    },
    128
  );

/* ── smoke puff ─────────────────────────────────────────────────────────── */
export const smokeTex = () =>
  build(
    "smoke",
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * 6.283;
        const d = Math.random() * s * 0.2;
        const x = s / 2 + Math.cos(a) * d;
        const y = s / 2 + Math.sin(a) * d;
        const r = s * (0.08 + Math.random() * 0.2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.30)");
        g.addColorStop(0.55, "rgba(255,255,255,0.12)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.283);
        ctx.fill();
      }
    },
    128
  );

/* ── water surface (puddle) ─────────────────────────────────────────────── */
export const waterTex = () =>
  build(
    "water",
    (ctx, s) => {
      ctx.fillStyle = "#22333d";
      ctx.fillRect(0, 0, s, s);
      paintField(
        ctx,
        s,
        fbmField(s, { cells: 3, octaves: 3, seed: 44, gain: 0.55 }),
        [
          [0.0, "#16252c"],
          [0.5, "#22333d"],
          [1.0, "#2e4450"],
        ],
        0.8
      );
      for (let i = 0; i < 60; i++) {
        ctx.globalAlpha = 0.05 + Math.random() * 0.14;
        ctx.strokeStyle = "#cfeaf5";
        ctx.lineWidth = 0.6 + Math.random() * 1.5;
        const y = Math.random() * s;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + 8, s * 0.6, y - 8, s, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    256
  );

/* ── tileable text label (signs) ────────────────────────────────────────── */
export function signTex(text, opts = {}) {
  const {
    bg = "#0f7a3d",
    fg = "#ffffff",
    w = 512,
    h = 256,
    font = 'bold 120px "Microsoft YaHei", "PingFang SC", sans-serif',
    sub = "",
    border = "",
  } = opts;
  const key = "sign:" + text + bg + fg + sub + w + h;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // subtle vignette so the panel is not a flat rectangle
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0.14)");
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
  if (sub) {
    ctx.font = `500 ${Math.round(h * 0.14)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, w / 2, h * 0.74);
    ctx.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  cache.set(key, t);
  return t;
}

/* ── gauge dial (pressure / temperature) ────────────────────────────────── */
export function gaugeTex(kind = "pressure") {
  const key = "gauge:" + kind;
  if (cache.has(key)) return cache.get(key);
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e9eae5";
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, 6.283);
  ctx.fill();
  // glass sheen
  const gg = ctx.createLinearGradient(0, 0, s, s);
  gg.addColorStop(0, "rgba(255,255,255,0.55)");
  gg.addColorStop(0.5, "rgba(255,255,255,0.02)");
  gg.addColorStop(1, "rgba(90,100,110,0.18)");
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = "#1b2026";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, 6.283);
  ctx.stroke();
  // colour arcs
  ctx.strokeStyle = "#d32f2f";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 16, -0.28, 0.0);
  ctx.stroke();
  ctx.strokeStyle = "#2e7d32";
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 16, Math.PI * 0.62, Math.PI * 1.32);
  ctx.stroke();
  // ticks
  ctx.strokeStyle = "#22282f";
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI * 0.25 + (i / 40) * Math.PI * 1.5;
    const r1 = s / 2 - 20;
    const r2 = s / 2 - (i % 5 === 0 ? 34 : 27);
    ctx.lineWidth = i % 5 === 0 ? 3 : 1.4;
    ctx.beginPath();
    ctx.moveTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1);
    ctx.lineTo(s / 2 + Math.cos(a) * r2, s / 2 + Math.sin(a) * r2);
    ctx.stroke();
  }
  // needle
  const na = Math.PI * 0.25 + 0.62 * Math.PI * 1.5;
  ctx.strokeStyle = "#b3261e";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(s / 2, s / 2);
  ctx.lineTo(s / 2 + Math.cos(na) * (s / 2 - 34), s / 2 + Math.sin(na) * (s / 2 - 34));
  ctx.stroke();
  ctx.fillStyle = "#20262c";
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, 7, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = "#20262c";
  ctx.font = 'bold 20px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(kind === "pressure" ? "MPa" : "°C", s / 2, s / 2 + 46);
  if (kind === "digital") {
    ctx.fillStyle = "#0a1a12";
    ctx.fillRect(30, 90, 196, 76);
    ctx.fillStyle = "#37ff9a";
    ctx.font = 'bold 56px "Consolas", monospace';
    ctx.fillText("0.42", s / 2, 148);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  cache.set(key, t);
  return t;
}

/* ── wood planks ────────────────────────────────────────────────────────── */
export const woodTex = () =>
  build(
    "wood",
    (ctx, s) => {
      ctx.fillStyle = "#8a6a44";
      ctx.fillRect(0, 0, s, s);
      const planks = 6;
      const ph = s / planks;
      for (let i = 0; i < planks; i++) {
        const base = ["#96754c", "#7d5f3c", "#a08054", "#6f5334", "#8e7048"][i % 5];
        ctx.fillStyle = base;
        ctx.fillRect(0, i * ph, s, ph - 1.5);
        // grain
        for (let k = 0; k < 34; k++) {
          ctx.globalAlpha = 0.1 + Math.random() * 0.22;
          ctx.strokeStyle = "#5b4228";
          ctx.lineWidth = 0.6 + Math.random() * 1.1;
          const y = i * ph + Math.random() * ph;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(s * 0.3, y + 3, s * 0.6, y - 3, s, y + (Math.random() - 0.5) * 2);
          ctx.stroke();
        }
        // edge shadow + highlight
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#4a3520";
        ctx.fillRect(0, i * ph + ph - 3, s, 2);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#e8d5b5";
        ctx.fillRect(0, i * ph + 1, s, 1.4);
        ctx.globalAlpha = 1;
        // knots
        if (Math.random() > 0.6) {
          const x = Math.random() * s;
          const y = i * ph + ph * 0.5;
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = "#4e3720";
          for (let r = 1; r < 5; r++) {
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(x, y, r * 2.4, r * 1.6, 0, 0, 6.283);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
      speckle(ctx, s, 200, ["#5e4529", "#a98a5e"], 0.6, 2, 0.25);
    },
    256
  );

export function disposeTextures() {
  // textures are cached globally and reused across scene rebuilds
}
