import * as THREE from "three";
import { pbr } from "../core/pbr.js";
import { add_robots } from "./robots.js";
import PACKAGE from "../map/data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   scene_community — 小区（2026-11-06 换图后重写）

   新图上小区与校园在同一张图里，楼栋与道路都在 map_package 里，
   所以这里不再自己摆楼、铺路，只做两件事：
     1. 沿小区轮廓砌一圈实体围墙，路口处断开
     2. 按需摆小区的巡检设备

   上一版是读 scene_extra.json 里的旧小区参数（环路、四栋板楼、车棚道闸），
   那套坐标只对旧图成立，换图后必须弃用。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;

const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];

/** 点是否落在道路路面内（只用外轮廓，中间的小岛忽略） */
function in_road(x, y) {
  const surfs = PACKAGE.roads?.surface || [];
  for (const s of surfs) {
    const poly = s.outer;
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    if (c) return true;
  }
  return false;
}

/**
 * 沿轮廓砌围墙，路口断开。
 * 逐段采样：段中点落在路面里就跳过，等于给每个出入口留了门洞。
 */
function make_wall(root, poly_px, { h = 1.9, thick = 0.36, step = 4 } = {}) {
  const wall_mat = pbr("concrete_wall", { repeat: 1, tint: 0xd8d2c4, normalScale: 0.6 });
  const cap_mat = wall_mat.clone();
  cap_mat.color = new THREE.Color(0xe9e4d8);

  const g = new THREE.Group();
  g.name = "community_wall";
  g.userData.no_merge = true;

  let built = 0;
  let gaps = 0;

  for (let i = 0; i < poly_px.length; i++) {
    const a = pw_pair(poly_px[i]);
    const b = pw_pair(poly_px[(i + 1) % poly_px.length]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const mx = a[0] + (b[0] - a[0]) * ((t0 + t1) / 2);
      const mz = a[1] + (b[1] - a[1]) * ((t0 + t1) / 2);
      const px = mx / MPP + W / 2;
      const py = mz / MPP + H / 2;
      if (in_road(px, py)) {
        gaps++;   // 路口：不砌墙
        continue;
      }
      const seg_len = len / n;
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(thick, h, seg_len), wall_mat);
      wall.position.set(
        a[0] + (b[0] - a[0]) * ((t0 + t1) / 2),
        h / 2,
        a[1] + (b[1] - a[1]) * ((t0 + t1) / 2)
      );
      wall.rotation.y = yaw;
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(thick + 0.1, 0.08, seg_len), cap_mat);
      cap.position.copy(wall.position);
      cap.position.y = h + 0.04;
      cap.rotation.y = yaw;
      g.add(cap);
      built++;
    }
  }

  root.add(g);
  return { built, gaps };
}

/** 像素 → 世界，返回 [x, z] */
function pw_pair([px, py]) {
  const q = PW(px, py);
  return [q[0], q[1]];
}

/**
 * 把小区挂到场景根节点上。
 * 新图里小区就在校园东南，楼与路都是同一份数据包里的，这里只加围墙与设备。
 */
export function add_community(root, { cine = null, robots = false, wall = true } = {}) {
  const poly = PACKAGE.zones?.community?.polygon;
  if (!poly || poly.length < 3) return null;

  let info = { built: 0, gaps: 0 };
  if (wall) info = make_wall(root, poly);

  if (robots) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
    add_robots(root, {
      scene: "community",
      cine,
      dogs: 2,
      humans: 1,
      center_px: [cx, cy],
      radius_px: rad * 0.8,
      seed: 2205,
    });
  }

  return info;
}

/** 独立的小区场景（页签不再用它，留作导出与调试） */
export async function build_community(cine) {
  const { build_campus } = await import("./scene_campus.js");
  return build_campus(cine);
}
