import { MAP } from "./coords.js";
import { nav_for } from "./nav_grid.js";

/* ══════════════════════════════════════════════════════════════════════════
   pathfind — 网格 A*

   网格来自 nav_grid.js：每个场景有 all（机器狗）与 road（人形）两套。
   八邻接，对角线代价 √2；找到路径后做视线简化，避免走出锯齿。
   ══════════════════════════════════════════════════════════════════════════ */

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function astar(nav, sx, sy, tx, ty) {
  if (!nav.walkable(sx, sy) || !nav.walkable(tx, ty)) return null;

  const GW = nav.w;
  const GH = nav.h;
  const N = GW * GH;
  const g_cost = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);

  const start = sy * GW + sx;
  const goal = ty * GW + tx;
  g_cost[start] = 0;

  /* 二叉堆：[f, idx] */
  const heap = [];
  const push = (f, idx) => {
    heap.push([f, idx]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const h = (x, y) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  push(h(sx, sy), start);

  while (heap.length) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;

    const cx = cur % GW;
    const cy = (cur / GW) | 0;

    for (const [dx, dy, w] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!nav.walkable(nx, ny)) continue;
      /* 斜向不允许穿过两个角落都是障碍的缝隙 */
      if (dx && dy && (!nav.walkable(cx + dx, cy) || !nav.walkable(cx, cy + dy))) continue;

      const ni = ny * GW + nx;
      if (closed[ni]) continue;

      const ng = g_cost[cur] + w;
      if (ng >= g_cost[ni]) continue;
      g_cost[ni] = ng;
      came[ni] = cur;
      push(ng + h(nx, ny), ni);
    }
  }

  if (came[goal] === -1 && goal !== start) return null;

  const cells = [];
  let cur = goal;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === start) break;
    cur = came[cur];
  }
  cells.reverse();
  return cells.map((i) => [i % GW, (i / GW) | 0]);
}

/* ── 视线简化 ───────────────────────────────────────────────────────── */

function line_clear(nav, a, b) {
  const [ax, ay] = a;
  const [bx, by] = b;
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
  if (steps === 0) return true;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    if (!nav.walkable(x, y)) return false;
  }
  return true;
}

function simplify(nav, cells) {
  if (cells.length < 3) return cells;
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !line_clear(nav, cells[i], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  return out;
}

/**
 * 在指定网格上求一条从起点到终点的像素折线。
 * 任一端不可走时会先吸附到最近的可行走点。
 */
export function find_path_on(nav, from_px, to_px) {
  if (!nav) return null;
  const [sx0, sy0] = nav.to_grid(from_px.x, from_px.y);
  const [tx0, ty0] = nav.to_grid(to_px.x, to_px.y);

  let s = nav.walkable(sx0, sy0) ? [sx0, sy0] : null;
  let t = nav.walkable(tx0, ty0) ? [tx0, ty0] : null;

  if (!s) {
    const p = nav.nearest(from_px.x, from_px.y);
    if (!p) return null;
    s = nav.to_grid(p[0], p[1]);
  }
  if (!t) {
    const p = nav.nearest(to_px.x, to_px.y);
    if (!p) return null;
    t = nav.to_grid(p[0], p[1]);
  }

  const cells = astar(nav, s[0], s[1], t[0], t[1]);
  if (!cells) return null;

  const pts = simplify(nav, cells).map(([gx, gy]) => nav.to_px(gx, gy));
  /* 首尾用真实坐标替换格心，避免起点瞬间偏移。
     但只有原本就可走时才替换，否则会把人形机器人拽回马路中间以外的地方 */
  if (pts.length) {
    if (nav.walkable(sx0, sy0)) pts[0] = [from_px.x, from_px.y];
    if (nav.walkable(tx0, ty0)) pts[pts.length - 1] = [to_px.x, to_px.y];
  }
  return pts;
}

/** 兼容旧调用：走校园全体网格 */
export function find_path(from_px, to_px) {
  return find_path_on(nav_for("campus", "all"), from_px, to_px);
}

/** 兼容旧调用 */
export function nearest_walkable_px(px, py, max_ring = 40) {
  const nav = nav_for("campus", "all");
  return nav ? nav.nearest(px, py, max_ring) : null;
}

/**
 * 在一张网格上挑若干互相分散的站位。
 * 用「最远点采样」：先取最开阔的一点，之后每次取离已选点最远的候选。
 * 之前用的「按开阔度排序再卡最小间距」会把设备全挤在同一片空地上，
 * 四台机器看起来挤成一堆。
 */
export function spread_spots(nav, count, min_sep_px = 60) {
  if (!nav) return [];
  const GW = nav.w;
  const GH = nav.h;

  /* 开阔度：到最近障碍的格子数，用多源 BFS */
  const dist = new Int32Array(GW * GH).fill(-1);
  const queue = new Int32Array(GW * GH);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < dist.length; i++) {
    if (nav.mask[i] === 1) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }
  const NEI = [1, -1, GW, -GW];
  while (head < tail) {
    const cur = queue[head++];
    const d = dist[cur];
    for (const off of NEI) {
      const nb = cur + off;
      if (nb < 0 || nb >= dist.length) continue;
      if (dist[nb] !== -1) continue;
      dist[nb] = d + 1;
      queue[tail++] = nb;
    }
  }

  /* 候选：开阔度 >= 3 格（6 米）的点 */
  const cand = [];
  for (let i = 0; i < dist.length; i++) {
    if (nav.mask[i] === 1 && dist[i] >= 3) cand.push(i);
  }
  if (!cand.length) return [];
  const px_of = (i) => [
    ((i % GW) + 0.5) * nav.div,
    (((i / GW) | 0) + 0.5) * nav.div,
  ];

  /* 第一个点取最开阔的 */
  let first = cand[0];
  for (const i of cand) if (dist[i] > dist[first]) first = i;
  const picked = [first];

  while (picked.length < count) {
    let best = -1;
    let best_score = -Infinity;
    const [px0, py0] = px_of(picked[0]);
    for (const i of cand) {
      if (picked.includes(i)) continue;
      const p = px_of(i);
      let dmin = Infinity;
      for (const q of picked) {
        const qp = px_of(q);
        const d = Math.hypot(p[0] - qp[0], p[1] - qp[1]);
        if (d < dmin) dmin = d;
      }
      if (dmin < min_sep_px) continue;
      /* 分数 = 离已选点最近的距离 × 0.7 + 自身开阔度（像素）× 0.3 */
      const score = dmin * 0.72 + Math.min(dist[i], 20) * 0.28 * nav.div;
      if (score > best_score) {
        best_score = score;
        best = i;
      }
    }
    if (best < 0) break;
    picked.push(best);
  }

  return picked.map((i) => px_of(i));
}

/** 兼容旧调用：校园全体网格上取分散站位 */
export function open_spots(count, min_sep_px = 70) {
  return spread_spots(nav_for("campus", "all"), count, min_sep_px);
}

export const MASK_INFO = {
  meters_per_cell: 4 * MAP.meters_per_px,
};
