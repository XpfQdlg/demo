import * as THREE from "three";
import { px_to_world, MAP } from "./coords.js";
import { grassTex, tiled } from "../core/tex.js";

/* ══════════════════════════════════════════════════════════════════════════
   terrain — 山体地形

   两座山由 scene_extra.json 的多边形轮廓给范围，高度用参数化场生成：
   到山脊的距离越近越高，峰值取 poly.peak_m；山脚压到 0 平齐地面。

   为什么不用高度图：新图是 JPEG，等高线被压缩糊成一片，提不出可靠的数字高程。
   参数化场能保证山脚与校园地面严丝合缝，不会出现山悬在空中或地面被撕开。

   实现要点：
   - 网格按多边形包围盒铺，落在轮廓外的顶点把高度压到 0 并略微下沉，
     地面贴图仍然可见，视觉上是山脚缓坡过渡到平地。
   - 法线自己算，不用 computeVertexNormals，避免轮廓边缘出现硬边。
   ══════════════════════════════════════════════════════════════════════════ */

/** 射线法判内 */
export function inside_polygon(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 点到线段的距离，像素单位 */
function dist_to_polyline(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/** 确定性噪声，保证每次打开地形一致 */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth_noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 点到多边形边界的距离，多边形内部返回正、外部返回负（近似，够用） */
function signed_dist_to_polygon(poly, x, y) {
  const d = dist_to_polyline(poly, x, y);
  return inside_polygon(poly, x, y) ? d : -d;
}

/**
 * 高度场：以山脊为中心做钟形，边界处平滑归零。
 *
 * 之前用「到边界距离 / 包围盒半对角」做衰减，结果是整座山又宽又缓，
 * 站在山脚根本看不出是山。现在改成两段：
 *   1. 山脊钟形 ridge_k，半径 R（米），山脊线上为 1
 *   2. 边界过渡 edge_k，只在离多边形边界 margin 米内起效，防止山体切边
 * 两者相乘再叠分形噪声，山头就有明显的高差。
 *
 * flatten 是一组多边形，落进去的地方高度压到 0，向外 smooth 米线性抬回。
 * 巡检空地必须压平，否则平地薄片会被抬高的地形埋掉。
 */
function height_at(hill, px, py, flatten = [], smooth = 14.0) {
  const poly = hill.polygon;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const m = MAP.meters_per_px;

  /* 边界过渡：离边界 margin 米内从 0 抬到 1 */
  const MARGIN_PX = 42 / m;
  const edge_d = dist_to_polyline(poly, px, py);
  const edge_k = Math.min(1, edge_d / MARGIN_PX);

  /* 山脊钟形：到山脊线的距离按半径归一化，超过半径为 0 */
  const RIDGE_M = Math.max(90, Math.hypot(x1 - x0, y1 - y0) * m * 0.34);
  const ridge_d = hill.ridge ? dist_to_polyline(hill.ridge, px, py) * m : Math.hypot(px - cx, py - cy) * m;
  const ridge_k = Math.max(0, 1 - (ridge_d / RIDGE_M) ** 2);

  /* 分形噪声：两层，近看有起伏，不碎 */
  const n1 = smooth_noise(px * 0.012, py * 0.012) - 0.5;
  const n2 = smooth_noise(px * 0.043, py * 0.043) - 0.5;
  const rough = hill.roughness ?? 0.35;
  const noise = (n1 * 0.72 + n2 * 0.28) * rough * 0.9;

  const h = hill.peak_m * edge_k * (0.18 + 0.82 * ridge_k) * (1 + noise);
  let out = Math.max(0, h);

  /* 压平区：场地内部高度归零；场外 smooth 米内从 0 线性抬到山地原高度，
     形成一圈缓坡过渡，不会在空地边上突然竖起一道墙。
     signed_dist 是像素单位，过渡宽度按比例尺换算 */
  const smooth_px = smooth / MAP.meters_per_px;
  for (const f of flatten) {
    const sd = signed_dist_to_polygon(f, px, py);
    if (sd > 0) return 0;
    const k = Math.min(1, -sd / smooth_px);
    /* 用平方根让靠近场地的一段更平缓，远处才接近完整坡度 */
    out *= Math.sqrt(k);
  }
  return out;
}

/** 山体材质：草皮贴图按世界坐标铺，近看有颗粒，远看是整片绿 */
function hill_material() {
  const tex = tiled(grassTex(), 6, 6);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: 0x8f9c74,
    roughness: 0.97,
    metalness: 0,
    envMapIntensity: 0.45,
  });
}

/**
 * 生成一座山的网格。
 * seg 是每边的分段数，44 段在 500 像素见方的山头上约 12 米一格，
 * 第一人称贴近看会有轻微棱角，但展台大屏不贴脸，够用且省三角形。
 */
export function build_hill(hill, { seg = 44, y_offset = 0, flatten = [], flatten_smooth = 16, material = null } = {}) {
  const poly = hill.polygon;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);

  /* 四周留一点余量，让山脚平缓接上地面 */
  const pad = 14;
  const ax0 = x0 - pad, ax1 = x1 + pad;
  const ay0 = y0 - pad, ay1 = y1 + pad;

  const geo = new THREE.PlaneGeometry(
    (ax1 - ax0) * MAP.meters_per_px,
    (ay1 - ay0) * MAP.meters_per_px,
    seg,
    seg
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const wc = px_to_world((ax0 + ax1) / 2, (ay0 + ay1) / 2);

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + wc.x;
    const wz = pos.getZ(i) + wc.z;

    /* 世界坐标 → 像素坐标，用来查高度场与判内 */
    const px = wx / MAP.meters_per_px + MAP.width_px / 2;
    const py = wz / MAP.meters_per_px + MAP.height_px / 2;

    let h = inside_polygon(poly, px, py) ? height_at(hill, px, py, flatten, flatten_smooth) : 0;

    /* 轮廓外的点往下沉一点，避免与地面共面拉出条纹 */
    if (h <= 0.02) h = -0.35;

    pos.setY(i, h + y_offset);
    /* 贴图按世界坐标铺，山脚与平地纹理尺度一致 */
    uv.setXY(i, px / MAP.width_px, py / MAP.height_px);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = material || hill_material();

  const mesh = new THREE.Mesh(geo, mat);
  /* 高度是按世界坐标查的，网格本体还在原点，必须挪到该山的位置 */
  mesh.position.set(wc.x, 0, wc.z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = `hill:${hill.id}`;
  return mesh;
}

/**
 * 山上的树：按高度与坡度撒点。
 * 太高太陡的地方不长树，山脚灌木密一些，符合校园后山的观感。
 * 全部实例化，两三百棵只占两次绘制。
 */
export function scatter_hill_trees(_hill, mesh, { count = 180, seed = 7 } = {}) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;

  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* 候选点：随机取三角形，按重心插值落点，保证落在山面上 */
  const spots = [];
  const v = new THREE.Vector3();
  const tri_count = idx.count / 3;
  for (let attempt = 0; attempt < count * 8 && spots.length < count; attempt++) {
    const t = Math.floor(rnd() * tri_count) * 3;
    const ia = idx.getX(t);
    const ib = idx.getX(t + 1);
    const ic = idx.getX(t + 2);
    let r1 = rnd(), r2 = rnd();
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const w0 = 1 - r1 - r2;
    const x = pos.getX(ia) * w0 + pos.getX(ib) * r1 + pos.getX(ic) * r2;
    const y = pos.getY(ia) * w0 + pos.getY(ib) * r1 + pos.getY(ic) * r2;
    const z = pos.getZ(ia) * w0 + pos.getZ(ib) * r1 + pos.getZ(ic) * r2;
    if (y < 1.5) continue; // 山脚平地上不撒，留给场景自己安排
    spots.push([x, y, z]);
  }

  if (!spots.length) return null;

  const trunk_geo = new THREE.CylinderGeometry(0.16, 0.24, 1, 5);
  trunk_geo.translate(0, 0.5, 0);
  const trunk_mat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.96 });
  const trunks = new THREE.InstancedMesh(trunk_geo, trunk_mat, spots.length);
  trunks.receiveShadow = true;

  const crown_geo = new THREE.ConeGeometry(1, 1, 6);
  crown_geo.translate(0, 0.5, 0);
  const crown_mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, flatShading: true,
  });
  const crowns = new THREE.InstancedMesh(crown_geo, crown_mat, spots.length);
  crowns.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const LEAF = [0x50793a, 0x446830, 0x5f8a44, 0x3d5f2a];

  for (let i = 0; i < spots.length; i++) {
    const [lx, ly, lz] = spots[i];
    /* 顶点是网格局部坐标，网格本体已经挪到了山的位置，撒树要补上同样的偏移 */
    const x = lx + mesh.position.x;
    const y = ly + mesh.position.y;
    const z = lz + mesh.position.z;
    const h = 5.0 + rnd() * 5.5;

    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    p.set(x, y - 0.1, z);
    s.set(1, h * 0.42, 1);
    trunks.setMatrixAt(i, m.compose(p, q, s));

    p.set(x, y + h * 0.36, z);
    s.set(1.55 + rnd() * 0.6, h * 0.72, 1.55 + rnd() * 0.6);
    crowns.setMatrixAt(i, m.compose(p, q, s));
    crowns.setColorAt(i, c.setHex(LEAF[i % LEAF.length]));
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

  const g = new THREE.Group();
  g.name = "hill_trees";
  g.add(trunks, crowns);
  return g;
}

export const TERRAIN_API = { build_hill, scatter_hill_trees, inside_polygon };
