/* ══════════════════════════════════════════════════════════════════════════
   rectify — 把描图出来的居民楼轮廓改成规则板楼

   描图得到的是沿着道路与院墙走的一圈折线，落在 3D 里就是「糖块」：
   弧边、锯齿、十几到几十个顶点。现实中宿舍是板的，一栋一栋直角体块。

   做法：先求最小面积包围矩形拿到这栋楼的主朝向，再沿短边切 13 米深的一条条，
   每条里取「确实落在原轮廓内」的连续区段，切成规整矩形。
   结果是一排板楼，朝向跟着原楼走，不会跑到原轮廓外面——
   轮廓外是可行走区域，体块一旦外扩，机器人和行人就会从楼角里穿过去。

   不满足条件时返回空数组，调用方退回原轮廓，宁可不好看也不乱拆。
   ══════════════════════════════════════════════════════════════════════════ */

const DEPTH = 13;      // 板楼进深，米
const STEP = 1;        // 采样步长，米
const MIN_LEN = 7;     // 一条板楼至少这么长
const MIN_KEEP = 0.5;  // 切出来的总面积不到原轮廓一半就别拆了

/** 凸包（Andrew 单调链） */
function hull(pts) {
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  lo.pop();
  up.pop();
  return lo.concat(up);
}

/** 最小面积包围矩形：枚举凸包每条边，取面积最小的那一框 */
function min_area_rect(pts) {
  const h = hull(pts);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    /* 投影到 (ux, uy) 及其法向，得到这组坐标下的包围范围 */
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of h) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  return best;
}

/** 点是否在多边形内（射线法，含边界近似） */
function inside(px, py, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 多边形面积，用来判断切出来的总量够不够 */
function poly_area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/**
 * 把一块居民楼轮廓切成若干规则矩形。
 *
 * @param outline  [[x, z], ...] 世界坐标，顺序不重要
 * @param depth    板楼进深，默认 13 米
 * @returns 矩形轮廓数组；拆不动时返回空数组
 */
export function slabify(outline, { depth = DEPTH } = {}) {
  if (!outline || outline.length < 3) return [];

  const rect = min_area_rect(outline);
  if (!rect) return [];

  const { ux, uy, u0, u1, v0, v1 } = rect;
  const to_local = ([x, z]) => [x * ux + z * uy, -x * uy + z * ux];
  const to_world = (u, v) => [u * ux - v * uy, u * uy + v * ux];

  const local = outline.map(to_local);

  const rows = Math.max(1, Math.min(6, Math.round((v1 - v0) / depth)));
  const row_h = (v1 - v0) / rows;
  if (row_h < 6) return [];

  const out = [];
  for (let r = 0; r < rows; r++) {
    const va = v0 + r * row_h;
    const vb = va + row_h;
    /* 一条带里沿长边逐米采样：五个高度上多数在轮廓内，这个位置才算被楼盖住 */
    const covered = [];
    for (let u = u0; u <= u1; u += STEP) {
      let hit = 0;
      for (let k = 0; k < 5; k++) {
        const v = va + ((k + 0.5) / 5) * row_h;
        const [x, z] = to_world(u, v);
        if (inside(x, z, outline)) hit++;
      }
      /* 五分之四以上落在轮廓内才算：门槛松了，矩形会在凹口处探出去，
         机器人和行人就会从楼角里穿过去 */
      covered.push(hit >= 4);
    }

    /* 连续段。允许 1 米的缺口，描图边缘的锯齿不该把一条板楼劈成两截 */
    let start = -1;
    let gap = 0;
    const runs = [];
    for (let i = 0; i < covered.length; i++) {
      if (covered[i]) {
        if (start < 0) start = i;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > 1) {
          runs.push([start, i - gap]);
          start = -1;
          gap = 0;
        }
      }
    }
    if (start >= 0) runs.push([start, covered.length - 1]);

    for (const [ia, ib] of runs) {
      const ua = u0 + ia * STEP;
      const ub = u0 + ib * STEP;
      if (ub - ua < MIN_LEN) continue;
      out.push([
        to_world(ua, va),
        to_world(ub, va),
        to_world(ub, vb),
        to_world(ua, vb),
      ]);
    }
  }

  if (!out.length) return [];
  const kept = out.reduce((s, p) => s + poly_area(p), 0);
  /* 切得太碎或者丢得太多就别切了：一块地的形状千奇百怪，
     硬套矩形会剩下几个孤零零的小方块，比原轮廓更假 */
  if (kept < poly_area(outline) * MIN_KEEP) return [];
  return out;
}
