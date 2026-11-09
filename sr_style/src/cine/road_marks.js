import * as THREE from "three";
import { px_to_world } from "../map/coords.js";
import PACKAGE from "../map/data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   road_marks — 道路标线

   观感版只有沥青路面，一条标线都没有。车机 SR 里道路之所以一眼读得懂，
   靠的是「暗路面 + 亮边线」这个对比，不是贴图。

   数据包里道路是三块带孔的多边形（`roads.surface`），没有中心线数据，
   所以这里只做能做的两件：

   1. 沿每个多边形的内外环铺一圈亮边线 —— 对应现实里的路缘和黄线；
   2. 森林那条林道按中心点画一条虚线。

   画法：把每一段做成一个带状四边形，所有段并进一个 BufferGeometry，
   最后只剩一个网格、一次绘制调用。拐角用斜接（miter）分摊，
   夹角太尖时给个上限，免得线条在急弯处炸开。
   ══════════════════════════════════════════════════════════════════════════ */

const MITER_MIN = 0.42;   // 斜接下限，小于这个角度就截断
const MARK_Y = 0.075;     // 压在路面之上，压在草地之上，不参与阴影

/** 像素环 → 世界坐标环 */
function to_xz(ring) {
  return ring.map(([px, py]) => {
    const w = px_to_world(px, py);
    return [w.x, w.z];
  });
}

/**
 * 把一条折线做成带状。返回三角形顶点数组（每三个数一个点）。
 * 用逐点斜接而不是逐段画，拐角才不会豁口。
 */
function ribbon(points, width, out) {
  const half = width / 2;
  const n = points.length;
  if (n < 3) return;

  const left = [];
  const right = [];

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    let d1x = p1[0] - p0[0], d1z = p1[1] - p0[1];
    let d2x = p2[0] - p1[0], d2z = p2[1] - p1[1];
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;

    let mx = d1x + d2x, mz = d1z + d2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-5) { mx = d2x; mz = d2z; } else { mx /= ml; mz /= ml; }

    /* 斜接长度 = 1 / cos(θ/2)，θ 是拐角；dot(m, d2) 就是 cos */
    const cos = Math.max(MITER_MIN, mx * d2x + mz * d2z);
    const scale = half / cos;

    const nx = -mz, nz = mx;
    left.push([p1[0] + nx * scale, p1[1] + nz * scale]);
    right.push([p1[0] - nx * scale, p1[1] - nz * scale]);
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = left[i], b = right[i], c = right[j], d = left[j];
    out.push(a[0], MARK_Y, a[1], b[0], MARK_Y, b[1], c[0], MARK_Y, c[1]);
    out.push(a[0], MARK_Y, a[1], c[0], MARK_Y, c[1], d[0], MARK_Y, d[1]);
  }
}

/** 森林那条林道：沿中心点画虚线 */
function dashed(points, width, dash, gap, out) {
  const half = width / 2;
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const ux = dx / len, uz = dz / len;
    const nx = -uz * half, nz = ux * half;

    let t = -carry;
    while (t < len) {
      const s0 = Math.max(0, t);
      const s1 = Math.min(len, t + dash);
      if (s1 > s0) {
        const ax = x0 + ux * s0, az = z0 + uz * s0;
        const bx = x0 + ux * s1, bz = z0 + uz * s1;
        out.push(ax + nx, MARK_Y, az + nz, ax - nx, MARK_Y, az - nz, bx - nx, MARK_Y, bz - nz);
        out.push(ax + nx, MARK_Y, az + nz, bx - nx, MARK_Y, bz - nz, bx + nx, MARK_Y, bz + nz);
      }
      t += dash + gap;
    }
    carry = (carry + len) % (dash + gap);
  }
}

function build_mesh(positions, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    /* 路面材质带 polygonOffset（地面分层用），标线不跟着抬就会被压下去，
       表现是一条条断续的虚线。这里压得比路面更靠前 */
    polygonOffset: true,
    polygonOffsetFactor: -9,
    polygonOffsetUnits: -18,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "road_marks";
  mesh.renderOrder = 4;
  /* 标线是贴在路面上的薄片，不参与阴影，也不进合并 */
  mesh.userData.no_merge = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 给校园场景加道路标线。
 * 校园与小区共用同一个场景，所以只按校园数据画一次就够。
 */
export function add_road_marks(root) {
  const R = PACKAGE.roads;
  if (!R?.surface) return null;

  const pos = [];
  for (const s of R.surface) {
    ribbon(to_xz(s.outer), 0.46, pos);
    for (const hole of s.holes || []) ribbon(to_xz(hole), 0.46, pos);
  }

  const mesh = build_mesh(pos, 0xdfe8f2, 0.92);
  root.add(mesh);
  return mesh;
}

/** 森林林道：中心虚线，比校园的边线更淡 */
export function add_path_marks(root) {
  const P = PACKAGE.forest_path;
  if (!P?.points?.length) return null;

  const pts = P.points.map(([px, py]) => {
    const w = px_to_world(px, py);
    return [w.x, w.z];
  });

  const pos = [];
  dashed(pts, 0.22, 2.6, 3.4, pos);

  const mesh = build_mesh(pos, 0xdfe8ef, 0.55);
  root.add(mesh);
  return mesh;
}
