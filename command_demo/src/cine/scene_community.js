import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { make_building, glass_material, add_roof_clutter, ribbon, add_distant_town } from "./building.js";
import { tree, street_lamp, bench, bin, car, railing } from "./props.js";
import { add_robots } from "./robots.js";
import EXTRA from "../map/data/scene_extra.json";
import PACKAGE from "../map/data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   scene_community — 小区（观感版）

   布局来自 map_trace/newmap2 的 enrich_community.py：
     环路 6.5 米、内部主路 5.5 米、两条支路 4.5 米，
     7 栋 15～18 米的板楼、一块球场、一块停车场、车棚、道闸。

   与校园场景共用世界坐标，所以小区就贴着校园东边界，
   在校园场景里调用同一个 add_community() 就能看到两者是连着的。

   和建筑同一套构件（building.js），勒脚、女儿墙、窗框比例一致。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;

/** 像素 → 世界 */
const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];

/** 像素多边形 → 世界轮廓（[x, z]） */
const to_world = (poly) => poly.map(([x, y]) => PW(x, y));

/* ── 几何小工具 ──────────────────────────────────────────────────── */

/** 射线法判内 */
function inside_poly(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** 点到折线的最短距离 */
function dist_to_path(pts, x, z, closed = false) {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/** 两线段之间最近的一对点（世界坐标） */
function seg_closest(p1, p2, q1, q2) {
  const d1 = [p2[0] - p1[0], p2[1] - p1[1]];
  const d2 = [q2[0] - q1[0], q2[1] - q1[1]];
  const r = [p1[0] - q1[0], p1[1] - q1[1]];
  const a = d1[0] * d1[0] + d1[1] * d1[1];
  const e = d2[0] * d2[0] + d2[1] * d2[1];
  const f = d2[0] * r[0] + d2[1] * r[1];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0; t = 0;
  } else if (a <= 1e-9) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e <= 1e-9) {
      t = 0; s = clamp01(-c / a);
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1];
      const den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const pa = [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
  const pb = [q1[0] + d2[0] * t, q1[1] + d2[1] * t];
  return { pa, pb, d: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) };
}

/** 两个多边形之间最近的一对点 */
function closest_pair(A, B) {
  let best = null;
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i];
    const a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j];
      const b2 = B[(j + 1) % B.length];
      const r = seg_closest(a1, a2, b1, b2);
      if (!best || r.d < best.d) best = r;
    }
  }
  return best;
}

/** 沿折线等距取点 */
function along(pts, step, closed = true) {
  const out = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  let carry = 0;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) continue;
    let d = carry;
    while (d < len) {
      const t = d / len;
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        Math.atan2(b[1] - a[1], b[0] - a[0]),
      ]);
      d += step;
    }
    carry = d - len;
  }
  return out;
}

/* ── 各部分 ──────────────────────────────────────────────────────── */

/** 场地底盘：轮廓内铺一层比外面略深的草，边界才读得出来 */
function make_ground(root, outline_w) {
  const pts = outline_w.map(([x, z]) => new THREE.Vector2(x, -z));
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
  geo.rotateX(-Math.PI / 2);
  const base = new THREE.Mesh(
    geo,
    pbr("grass", { repeat: 1 / 4, normalScale: 1.0, tint: 0x788a52 })
  );
  base.position.y = 0.02;
  base.receiveShadow = true;
  root.add(base);
}

/** 道路：中心线加宽成多边形，铺沥青 */
function make_roads(root, C) {
  const road_mat = pbr("asphalt", { repeat: 1 / 4, normalScale: 1.2, envIntensity: 0.65 });
  const line_mat = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.85 });

  for (const r of C.roads) {
    const poly_px = ribbon(r.points, r.width_m, MPP, r.closed);
    const pts = to_world(poly_px).map(([x, z]) => new THREE.Vector2(x, -z));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, road_mat);
    mesh.position.y = 0.05;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  /* 主路中央虚线：路段最长的那条当主路 */
  let spine = C.roads[1] || C.roads[0];
  for (const r of C.roads) {
    const a = r.points[0];
    const b = r.points[r.points.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.hypot(
      spine.points[0][0] - spine.points[spine.points.length - 1][0],
      spine.points[0][1] - spine.points[spine.points.length - 1][1])) spine = r;
  }
  const p0 = PW(spine.points[0][0], spine.points[0][1]);
  const p1 = PW(spine.points[spine.points.length - 1][0], spine.points[spine.points.length - 1][1]);
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
  const dashes = Math.max(1, Math.floor(len / 7));
  for (let i = 0; i < dashes; i++) {
    const t = (i + 0.5) / dashes;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 2.6), line_mat);
    dash.position.set(p0[0] + (p1[0] - p0[0]) * t, 0.07, p0[1] + (p1[1] - p0[1]) * t);
    dash.rotation.y = yaw;
    root.add(dash);
  }
}

/** 小区范围里描图已有的楼：观感版不再另摆，直接用数据包里的真实轮廓。
    这样「小区」页签里的楼与校园东南角是同一批，切换场景不会变样。 */
function package_buildings_in_zone() {
  const zone_w = to_world(PACKAGE.zones.community.polygon);
  const out = [];
  for (const b of PACKAGE.buildings) {
    if (!b.polygon || b.polygon.length < 3) continue;
    if ((b.height_m || 0) <= 0.01) continue;
    const xs = b.polygon.map((p) => p[0]);
    const ys = b.polygon.map((p) => p[1]);
    const [wx, wz] = to_world([[
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ]])[0];
    if (!inside_poly(zone_w, wx, wz)) continue;
    out.push({
      polygon: b.polygon,
      height_m: b.height_m,
      floors: Math.max(2, Math.round(b.height_m / 3.0)),
      kind: b.kind,
      traced: true,
    });
  }
  return out;
}

/** 楼栋：按用途给两种外墙，逐栋换色，避免一排复制粘贴 */
const WALL_TINTS = [0xe9e3d7, 0xdcd5c7, 0xe4ddd0, 0xd6cfc1, 0xece7dc];

function make_buildings(root, C, glass, frame_mat) {
  C.buildings.forEach((b, i) => {
    const outline_w = to_world(b.polygon);
    const style = i % 3 === 1
      ? { slug: "brick", tint: 0xd9c9b4 }
      : { slug: "concrete_wall", tint: WALL_TINTS[i % WALL_TINTS.length] };

    const g = make_building({
      outline: outline_w,
      height: b.height_m,
      wall_mat: pbr(style.slug, { repeat: 1 / 3.5, tint: style.tint, normalScale: 0.85 }),
      glass_mat: glass,
      frame_mat,
      floor_h: b.height_m / (b.floors || 5),
      bay: 3.2,
      win_w: 0.46,
      win_h: 0.44,
    });

    const xs = outline_w.map((p) => p[0]);
    const zs = outline_w.map((p) => p[1]);
    add_roof_clutter(g, {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
      w: Math.max(...xs) - Math.min(...xs),
      d: Math.max(...zs) - Math.min(...zs),
      y: b.height_m,
      seed: 20261110 + i * 7,
      count: 3,
      outline: outline_w,
    });

    root.add(g);
  });
}

/** 球场：丙烯地面 + 白色边线 + 两块篮板 */
function make_courts(root, C) {
  if (!C.courts?.length) return;
  const floor_mat = new THREE.MeshStandardMaterial({ color: 0x3f6f57, roughness: 0.85 });
  const line_mat = new THREE.MeshStandardMaterial({ color: 0xe9ece6, roughness: 0.8 });
  const board_mat = pbr("metal", { repeat: 1, metalness: 0.8, envIntensity: 1.2, tint: 0xd8dce0 });

  for (const c of C.courts) {
    const w = to_world(c.polygon);
    const xs = w.map((p) => p[0]);
    const zs = w.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const z0 = Math.min(...zs), z1 = Math.max(...zs);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const bw = x1 - x0, bd = z1 - z0;

    const floor = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.06, bd), floor_mat);
    floor.position.set(cx, 0.05, cz);
    floor.receiveShadow = true;
    root.add(floor);

    /* 边线：一圈 5 厘米宽的白色细条 */
    const t = 0.08;
    for (const [lw, ld, ox, oz] of [
      [bw - 1.2, t, 0, (bd - 1.2) / 2],
      [bw - 1.2, t, 0, -(bd - 1.2) / 2],
      [t, bd - 1.2, (bw - 1.2) / 2, 0],
      [t, bd - 1.2, -(bw - 1.2) / 2, 0],
      [t, bd - 1.2, 0, 0],
    ]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.01, ld), line_mat);
      line.position.set(cx + ox, 0.09, cz + oz);
      root.add(line);
    }

    /* 篮板 + 立柱，两只 */
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.1, 8), board_mat);
      post.position.set(cx + s * (bw / 2 - 1.6), 1.55, cz);
      root.add(post);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1.8), line_mat);
      board.position.set(cx + s * (bw / 2 - 1.9), 3.05, cz);
      root.add(board);
    }
  }
}

/** 停车场：深色铺装 + 一排车位线 */
function make_parkings(root, C) {
  if (!C.parkings?.length) return;
  const floor_mat = pbr("asphalt", { repeat: 1 / 4, tint: 0x9aa0a6, normalScale: 1.0 });
  const line_mat = new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.85 });

  for (const p of C.parkings) {
    const w = to_world(p.polygon);
    const xs = w.map((q) => q[0]);
    const zs = w.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const z0 = Math.min(...zs), z1 = Math.max(...zs);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.05, z1 - z0), floor_mat);
    floor.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2);
    floor.receiveShadow = true;
    root.add(floor);

    const n = Math.floor((x1 - x0) / 2.8);
    for (let i = 0; i <= n; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, z1 - z0 - 1.2), line_mat);
      line.position.set(x0 + 0.6 + i * 2.8, 0.08, (z0 + z1) / 2);
      root.add(line);
    }

    /* 停进去几辆车，别让整块地空着 */
    const colors = [0xb8bcc0, 0x2b3238, 0x8d2f28, 0x24405c, 0xd8d9d4, 0x5a6259];
    for (let i = 0; i < Math.min(n, 5); i++) {
      if ((i * 7 + 3) % 4 === 0) continue;
      const c = car({ color: colors[i % colors.length], yaw: Math.PI / 2 });
      c.position.set(x0 + 2.0 + i * 2.8, 0.06, (z0 + z1) / 2);
      root.add(c);
    }
  }
}

/** 车棚、道闸、门卫亭 */
function make_facilities(root, C, glass, frame_mat) {
  if (C.shed?.polygon) {
    const sw = to_world(C.shed.polygon);
    const xs = sw.map((p) => p[0]);
    const zs = sw.map((p) => p[1]);
    const sx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const sz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.22, d),
      pbr("metal", { repeat: 4, metalness: 0.8, envIntensity: 1.3 })
    );
    roof.position.set(sx, C.shed.height_m, sz);
    roof.castShadow = true;
    roof.receiveShadow = true;
    root.add(roof);

    const post_mat = pbr("metal", { repeat: 1, metalness: 0.9, envIntensity: 1.4 });
    for (const dx of [-w / 2 + 0.6, w / 2 - 0.6]) {
      for (const dz of [-d / 2 + 0.5, d / 2 - 0.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, C.shed.height_m, 0.14), post_mat);
        post.position.set(sx + dx, C.shed.height_m / 2, sz + dz);
        root.add(post);
      }
    }

    /* 车棚下面留几辆电动车的位置，用矮方块示意 */
    const bike_mat = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.7), bike_mat);
      b.position.set(sx - w / 2 + 2 + i * 2.1, 0.5, sz);
      root.add(b);
    }
  }

  if (C.gate) {
    const [gx, gz] = PW(C.gate.x, C.gate.y);
    const post_mat = pbr("metal", { repeat: 1, metalness: 0.85, envIntensity: 1.3 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 0.18), post_mat);
    post.position.set(gx, 0.58, gz);
    post.castShadow = true;
    root.add(post);

    const bar_mat = new THREE.MeshStandardMaterial({ color: 0xc4422f, roughness: 0.55 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 5.4), bar_mat);
    bar.position.set(gx, 1.05, gz - 2.7);
    bar.castShadow = true;
    root.add(bar);

    /* 门卫亭：2.6 米的小房子，放在闸机旁 */
    const booth = make_building({
      outline: [[gx - 3.2, gz - 2.6], [gx - 0.8, gz - 2.6], [gx - 0.8, gz - 0.2], [gx - 3.2, gz - 0.2]],
      height: 2.8,
      wall_mat: pbr("concrete_wall", { repeat: 1 / 3.5, tint: 0xe6e2d8, normalScale: 0.7 }),
      glass_mat: glass,
      frame_mat,
      parapet: false,
      plinth: false,
      floor_h: 2.2,
      bay: 2.0,
      win_w: 0.60,
      win_h: 0.42,
    });
    root.add(booth);
  }
}

/**
 * 绿化与街道家具。
 *
 * 撒点用「抖动网格 + 三重排除」：不在轮廓外、离道路中心线 6 米以上、
 * 不在楼栋轮廓内。手工摆树总会压到路面或戳进楼里，
 * 排除了这三样之后，位置就不用一个个调。
 */
function make_greenery(root, C, outline_w) {
  const buildings_w = C.buildings.map((b) => to_world(b.polygon));
  const road_paths = C.roads.map((r) =>
    to_world(r.points).map(([x, z]) => [x, z])
  );

  const xs = outline_w.map((p) => p[0]);
  const zs = outline_w.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const z0 = Math.min(...zs), z1 = Math.max(...zs);

  /* 树的候选位置：8 米网格 + 随机抖动，确定性种子 */
  let acc = 20261115;
  const rnd = () => {
    acc = (acc * 1664525 + 1013904223) >>> 0;
    return acc / 4294967296;
  };

  const spots = [];
  for (let x = x0; x < x1; x += 8) {
    for (let z = z0; z < z1; z += 8) {
      const px = x + (rnd() - 0.5) * 5;
      const pz = z + (rnd() - 0.5) * 5;
      if (!inside_poly(outline_w, px, pz)) continue;
      let ok = true;
      for (const p of road_paths) {
        if (dist_to_path(p, px, pz) < 6.0) { ok = false; break; }
      }
      if (!ok) continue;
      for (const b of buildings_w) {
        if (inside_poly(b, px, pz)) { ok = false; break; }
        if (dist_to_path(b, px, pz, true) < 3.0) { ok = false; break; }
      }
      if (!ok) continue;
      spots.push([px, pz]);
    }
  }

  /* 场地上太密会挡住视线，按 5 棵抽 3 棵 */
  let n = 0;
  for (const [px, pz] of spots) {
    if (n++ % 5 >= 3) continue;
    const t = tree({ h: 5.4 + rnd() * 2.6, seed: 3100 + n, tone: n });
    t.position.set(px, 0, pz);
    t.rotation.y = rnd() * Math.PI * 2;
    root.add(t);
  }

  /* 环路路灯：外圈每 34 米一盏，灯光朝路内 */
  const ring = to_world(C.roads[0].points);
  const [rcx, rcz] = [
    ring.reduce((a, p) => a + p[0], 0) / ring.length,
    ring.reduce((a, p) => a + p[1], 0) / ring.length,
  ];
  const lamp_pts = along(ring, 34, false);
  for (let i = 0; i < lamp_pts.length; i++) {
    const [lx, lz, yaw] = lamp_pts[i];
    /* 朝轮廓外侧偏 4.6 米，灯悬在路面上方 */
    const ox = Math.sign(lx - rcx) * 3.2;
    const oz = Math.sign(lz - rcz) * 3.2;
    const lamp = street_lamp({ h: 5.2, arm: 1.0 });
    lamp.position.set(lx + ox, 0, lz + oz);
    lamp.rotation.y = Math.atan2(-ox, -oz);
    root.add(lamp);
  }

  /* 主路两侧的长椅与垃圾桶 */
  const spine = to_world(C.roads[1].points);
  const seats = along(spine, 26, false);
  for (let i = 0; i < seats.length; i++) {
    const [sx, sz] = seats[i];
    if (!inside_poly(outline_w, sx, sz + 4.4)) continue;
    const b = bench();
    b.position.set(sx, 0, sz + 4.4);
    b.rotation.y = 0;
    root.add(b);
    if (i % 2 === 0) {
      const bb = bin();
      bb.position.set(sx + 2.4, 0, sz + 4.4);
      root.add(bb);
    }
  }
}

/** 围墙：沿小区轮廓拉一圈铁艺栏杆，和校园围栏同一套构件 */
/* 围墙：小区与校园相接的一段要断开，否则画面上是「一个被围起来的孤岛」 */
function make_fence(root, outline_w, gap_pt = null) {
  const thinned = [];
  for (const p of outline_w) {
    const last = thinned[thinned.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 10) thinned.push(p);
  }
  if (thinned.length < 3) return;

  const GAP_R = 45;   // 接口附近的顶点，两侧都不拉栏杆（留够一个出入口的宽度）
  const runs = [];
  let run = [];
  for (const p of [...thinned, thinned[0]]) {
    const near = gap_pt && Math.hypot(p[0] - gap_pt[0], p[1] - gap_pt[1]) < GAP_R;
    if (near) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 1) runs.push(run);

  for (const r of runs) root.add(railing(r, { h: 1.5, step: 2.6 }));
}

/* 小区与校园之间的连接口：铺一条连接道，把两块地连起来。
   返回小区一侧的接点，围墙在那里断开。 */
function make_link(root, outline_w) {
  const campus_w = to_world(PACKAGE.zones.campus.polygon);
  const best = closest_pair(outline_w, campus_w);
  if (!best || best.d > 140) return null;

  /* 两端各向外延伸 8 米，接进两边的地面，不留缝 */
  const { pa, pb } = best;
  const dir = [pa[0] - pb[0], pa[1] - pb[1]];
  const len = Math.max(1e-6, Math.hypot(dir[0], dir[1]));
  const ux = (dir[0] / len) * 8;
  const uz = (dir[1] / len) * 8;
  const pts = [[pb[0] - ux, pb[1] - uz], [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], [pa[0] + ux, pa[1] + uz]];

  /* 这里直接用世界坐标：ribbon 的半宽是 width/2/mpp，mpp 传 1 即为米 */
  const poly = ribbon(pts, 9, 1, false);
  const geo = new THREE.ShapeGeometry(
    new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))
  );
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    pbr("paving", { repeat: 1 / 3, tint: 0xb9b6ae, normalScale: 0.9 })
  );
  mesh.position.y = 0.06;
  mesh.receiveShadow = true;
  root.add(mesh);

  return pa;
}

/**
 * 把小区挂到任意场景根节点上。
 * 校园场景也调这个函数，两处才会严丝合缝地连在一起。
 */
export function add_community(
  root,
  { distant = true, packageBuildings = true, cine = null, robots = false } = {}
) {
  const C = EXTRA.community;
  if (!C) return;

  /* 校园场景自己会把 PACKAGE.buildings 全部画一遍，
     那里传 packageBuildings: false，避免同一栋楼叠两遍 */
  const real = packageBuildings ? package_buildings_in_zone() : [];
  const Cx = real.length ? { ...C, buildings: [...real, ...C.buildings] } : C;

  const outline_w = to_world(C.outline || PACKAGE.zones.community.polygon);
  const center = [
    outline_w.reduce((a, p) => a + p[0], 0) / outline_w.length,
    outline_w.reduce((a, p) => a + p[1], 0) / outline_w.length,
  ];

  make_ground(root, outline_w);
  make_roads(root, C);

  const glass = glass_material(0x1d2a30);
  const frame_mat = pbr("concrete_wall", { repeat: 2, tint: 0xf0ece2, normalScale: 0.4 });

  make_buildings(root, Cx, glass, frame_mat);
  make_courts(root, C);
  make_parkings(root, C);
  make_facilities(root, C, glass, frame_mat);
  make_greenery(root, Cx, outline_w);
  /* 与校园相接的一段：铺连接道、围墙断开，小区才不是一座孤岛 */
  const link_pt = make_link(root, outline_w);
  make_fence(root, outline_w, link_pt);

  if (distant) {
    add_distant_town(root, { center, count: 44, seed: 20261111, rMin: 380, rMax: 640 });
  }

  /* 小区的巡检设备：两台狗、一台人形，活动范围限定在小区轮廓内。
     放在这里而不是各个调用点，校园页签里的小区才也有自己的设备；
     由调用方传 robots: true 打开，避免自己和 build_community 各摆一遍。 */
  if (robots) {
    const oxs = (C.outline || PACKAGE.zones.community.polygon).map((p) => p[0]);
    const oys = (C.outline || PACKAGE.zones.community.polygon).map((p) => p[1]);
    add_robots(root, {
      scene: "community",
      cine,
      dogs: 2,
      humans: 1,
      center_px: [oxs.reduce((a, v) => a + v, 0) / oxs.length, oys.reduce((a, v) => a + v, 0) / oys.length],
      radius_px: 70,
      seed: 2205,
    });
  }
}

export async function build_community(cine) {
  await preload([
    "grass", "asphalt", "concrete_wall", "brick", "concrete_floor",
    "metal", "wood", "tiles", "paving", "facade",
  ]);

  const root = new THREE.Group();
  root.name = "community";

  /* 底盘：小区外围要有地。校园场景自带 2600 米地面，
     这里单独建，按 4 米一张铺贴图，和校园同一尺度。 */
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    pbr("grass", { repeat: 225, normalScale: 1.0, tint: 0x6f8a4a })
  );
  lawn.rotation.x = -Math.PI / 2;
  const oc = EXTRA.community.outline;
  const [lcx, lcz] = PW(
    oc.reduce((a, p) => a + p[0], 0) / oc.length,
    oc.reduce((a, p) => a + p[1], 0) / oc.length
  );
  lawn.position.set(lcx, 0, lcz);
  lawn.receiveShadow = true;
  root.add(lawn);

  /* 小区的巡检设备由 add_community 一并摆，免得两处各写一套 */
  add_community(root, { robots: true, cine });

  const outline_w = to_world(EXTRA.community.outline);
  const xs = outline_w.map((p) => p[0]);
  const zs = outline_w.map((p) => p[1]);
  root.userData.frame = {
    center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2],
    span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 30,
  };
  return root;
}
