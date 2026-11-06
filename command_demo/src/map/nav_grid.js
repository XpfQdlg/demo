import { PACKAGE, MAP } from "./coords.js";
import EXTRA from "./data/scene_extra.json";

/* ══════════════════════════════════════════════════════════════════════════
   nav_grid — 各场景的可行走网格

   一个场景可以有不止一套可行走范围：
     all   机器狗可走（建筑之外都行）
     road  人形机器人可走（只走道路）

   网格在启动时按多边形栅格化生成，用扫描线填充，几百个顶点的多边形
   也只花几毫秒。生成后缓存，场景切换不重算。

   为什么不在 Python 里预生成：小区、地铁的几何是前端拼出来的，
   参数一改网格就得跟着改；在 JS 里现场生成，改数据包就能立刻生效。
   ══════════════════════════════════════════════════════════════════════════ */

const DIV = 4;                     // 每格 4 像素 = 2 米
const W = Math.ceil(MAP.width_px / DIV);
const H = Math.ceil(MAP.height_px / DIV);

/**
 * 扫描线填充一个多边形到网格。
 * value=1 写入可走，value=0 挖空。奇偶规则，孔洞用 value=0 再填一次即可。
 */
function fill_polygon(mask, polygon, value) {
  if (!polygon || polygon.length < 3) return;
  const n = polygon.length;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, py] of polygon) {
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  }
  const row_a = Math.max(0, Math.floor(y0 / DIV));
  const row_b = Math.min(H - 1, Math.ceil(y1 / DIV));

  const xs = [];
  for (let row = row_a; row <= row_b; row++) {
    const py = (row + 0.5) * DIV;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const [x1, yy1] = polygon[i];
      const [x2, yy2] = polygon[(i + 1) % n];
      if ((yy1 > py) === (yy2 > py)) continue;
      const t = (py - yy1) / (yy2 - yy1);
      xs.push(x1 + (x2 - x1) * t);
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.floor(xs[k] / DIV));
      const b = Math.min(W - 1, Math.ceil(xs[k + 1] / DIV));
      for (let x = a; x <= b; x++) mask[row * W + x] = value;
    }
  }
}

/** 折线加宽成多边形（与 build_scene 的 ribbon_polygon 同一套算法） */
export function ribbon_polygon(points_px, width_m, closed = false) {
  const hw = width_m / 2 / MAP.meters_per_px;
  const pts = points_px.map(([px, py]) => ({ x: px, y: py }));
  const n = pts.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    left.push([pts[i].x - dy * hw, pts[i].y + dx * hw]);
    right.push([pts[i].x + dy * hw, pts[i].y - dx * hw]);
  }
  return left.concat(right.reverse());
}

/** 多边形按中心点缩放，用来做建筑外扩 */
function expand_polygon(poly, meters) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const px = meters / MAP.meters_per_px;
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const L = Math.hypot(dx, dy) || 1;
    return [x + (dx / L) * px, y + (dy / L) * px];
  });
}

function point_in_poly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/* ── NavGrid ─────────────────────────────────────────────────────────── */

export class NavGrid {
  constructor(mask) {
    this.mask = mask;
    this.w = W;
    this.h = H;
    this.div = DIV;
  }

  walkable(gx, gy) {
    return gx >= 0 && gy >= 0 && gx < W && gy < H && this.mask[gy * W + gx] === 1;
  }

  walkable_px(px, py) {
    return this.walkable(Math.floor(px / DIV), Math.floor(py / DIV));
  }

  to_grid(px, py) {
    return [Math.floor(px / DIV), Math.floor(py / DIV)];
  }

  to_px(gx, gy) {
    return [(gx + 0.5) * DIV, (gy + 0.5) * DIV];
  }

  /** 最近的可行走点，找不到返回 null */
  nearest(px, py, max_ring = 60) {
    const [gx0, gy0] = this.to_grid(px, py);
    if (this.walkable(gx0, gy0)) return this.to_px(gx0, gy0);
    for (let r = 1; r <= max_ring; r++) {
      let best = null;
      let best_d = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (!this.walkable(gx0 + dx, gy0 + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < best_d) {
            best_d = d;
            best = [gx0 + dx, gy0 + dy];
          }
        }
      }
      if (best) return this.to_px(best[0], best[1]);
    }
    return null;
  }

  /** 统计可用格数，调试用 */
  count() {
    let n = 0;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i]) n++;
    return n;
  }
}

/* ── 各场景的网格构造 ─────────────────────────────────────────────────── */

/** 校园全体：沿用数据包里的位掩膜（建筑外扩 2 米后挖空） */
function campus_all() {
  const m = PACKAGE.walk_mask;
  const bin = atob(m.bits);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    mask[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  }
  return new NavGrid(mask);
}

/** 校园道路：只保留路面，人形机器人走这套 */
function campus_road() {
  const mask = new Uint8Array(W * H);
  const R = PACKAGE.roads;
  if (!R) return new NavGrid(mask);
  for (const s of R.surface) {
    fill_polygon(mask, s.outer, 1);
    for (const h of s.holes || []) fill_polygon(mask, h, 0);
  }
  /* 路面只有 8 米宽，2 米一格，边角会太贴着路沿。
     把网格做一次 3×3 膨胀，让机器人走在路上有一点余量。 */
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
        }
      }
    }
  }
  return new NavGrid(out);
}

/** 小区全体：轮廓内，挖掉建筑（外扩 2 米） */
function community_all() {
  const mask = new Uint8Array(W * H);
  const C = EXTRA.community;
  const zone = PACKAGE.zones.community.polygon;
  fill_polygon(mask, zone, 1);
  for (const b of C.buildings || []) {
    fill_polygon(mask, expand_polygon(b.polygon, 2.0), 0);
  }
  if (C.shed && C.shed.polygon) fill_polygon(mask, expand_polygon(C.shed.polygon, 1.5), 0);
  return new NavGrid(mask);
}

/** 小区道路：环路 + 中轴，人形机器人走这套 */
function community_road() {
  const mask = new Uint8Array(W * H);
  const C = EXTRA.community;
  for (const r of C.roads || []) {
    const poly = ribbon_polygon(r.points, r.width_m + 1.0, r.closed);
    fill_polygon(mask, poly, 1);
  }
  return new NavGrid(mask);
}

/** 地铁站台：只有站台面可走，轨道不行 */
function subway_platform() {
  const mask = new Uint8Array(W * H);
  const S = EXTRA.subway;
  const brown = PACKAGE.zones.subway.polygon;
  const xs = brown.map((p) => p[0]);
  const ys = brown.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const hall_w = (Math.max(...xs) - Math.min(...xs)) * MAP.meters_per_px;

  const plat_len = hall_w - 12;
  const plat_w = S ? S.platform.width_m : 12;
  const hl = plat_len / 2 / MAP.meters_per_px - 1.5; // 两端各留 3 米
  const hw = plat_w / 2 / MAP.meters_per_px - 1.0;   // 两侧各留 2 米，不贴黄线
  fill_polygon(mask, [
    [cx - hl, cy - hw], [cx + hl, cy - hw], [cx + hl, cy + hw], [cx - hl, cy + hw],
  ], 1);
  return new NavGrid(mask);
}

/** 森林空地：巡检场地范围内都可走，山上不行 */
function forest_clearing() {
  const mask = new Uint8Array(W * H);
  const F = EXTRA.forest;
  const poly = F ? F.clearing : PACKAGE.zones.forest.polygon;
  fill_polygon(mask, poly, 1);
  return new NavGrid(mask);
}

/* ── 缓存 ─────────────────────────────────────────────────────────────── */

const cache = new Map();

const BUILDERS = {
  "campus:all": campus_all,
  "campus:road": campus_road,
  "community:all": community_all,
  "community:road": community_road,
  "subway:all": subway_platform,
  "subway:road": subway_platform,
  "forest:all": forest_clearing,
  "forest:road": forest_clearing,
};

/**
 * 取某个场景的可行走网格。
 * kind：'all' 机器狗用，'road' 人形机器人用。
 * 缺对应类型时退回 all，保证不会因为没配就跑不动。
 */
export function nav_for(scene_id, kind = "all") {
  const key = `${scene_id}:${kind}`;
  if (cache.has(key)) return cache.get(key);

  const build = BUILDERS[key] || BUILDERS[`${scene_id}:all`];
  if (!build) return null;
  const nav = build();
  cache.set(key, nav);
  if (kind !== "all" && !BUILDERS[key]) cache.set(key, nav);
  return nav;
}

export const NAV_INFO = { width: W, height: H, div: DIV };
