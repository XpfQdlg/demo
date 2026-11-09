import * as THREE from "three";
import { pbr } from "../core/pbr.js";

/* ══════════════════════════════════════════════════════════════════════════
   building — 观感版的建筑构件

   约定：所有轮廓用世界坐标的 (x, z) 给，内部转成 Shape 再挤出。
   窗、勒脚、女儿墙、屋顶设备都在这里，广场与小区共用，保证风格一致。
   ══════════════════════════════════════════════════════════════════════════ */

export const FLOOR_H = 3.6;
export const BAY = 3.6;

/**
 * 沿墙排窗。
 *
 * 坐标换算：Shape 在 XY 平面，挤出并 rotateX(-90°) 后 shape.x → 世界 x、
 * shape.y → 世界 -z。所以「墙方向」是 (ux, 0, -uy)，外法线按绕向取符号。
 */
export function add_windows(group, pts, height, glass_mat, frame_mat, opts = {}) {
  const floor_h = opts.floor_h ?? FLOOR_H;
  const bay = opts.bay ?? BAY;
  const win_w = opts.win_w ?? 0.42;
  const win_h = opts.win_h ?? 0.46;
  const floors = Math.max(1, Math.floor((height - 1.8) / floor_h));

  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area > 0 ? 1 : -1;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < bay * 1.5) continue;

    const ux = dx / len;
    const uy = dy / len;
    const nx = uy * sign;
    const nz = ux * sign;
    const yaw = Math.atan2(uy, ux);

    const bays = Math.max(1, Math.floor(len / bay));
    const step = len / bays;

    for (let f = 0; f < floors; f++) {
      for (let k = 0; k < bays; k++) {
        const t = (k + 0.5) / bays;
        const px = a.x + dx * t;
        const pz = -(a.y + dy * t);
        const y = 1.7 + f * floor_h;

        /* 玻璃：贴在墙外 3 厘米，深色高反射 */
        const pane = new THREE.Mesh(
          new THREE.BoxGeometry(step * win_w, floor_h * win_h, 0.03),
          glass_mat
        );
        pane.position.set(px + nx * 0.03, y, pz + nz * 0.03);
        pane.rotation.y = yaw;
        group.add(pane);

        /* 窗框：四周细边 */
        const bar_w = step * 0.022;
        const bar_h = floor_h * 0.022;
        const fw = step * (win_w + 0.04);
        const fh = floor_h * (win_h + 0.04);
        const bars = [
          [fw, bar_h, 0, fh / 2],
          [fw, bar_h, 0, -fh / 2],
          [bar_w, fh, fw / 2, 0],
          [bar_w, fh, -fw / 2, 0],
        ];
        for (const [w, h, ox, oy] of bars) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), frame_mat);
          bar.position.set(px + nx * 0.05 + ux * ox, y + oy, pz + nz * 0.05 - uy * ox);
          bar.rotation.y = yaw;
          group.add(bar);
        }
      }
    }
  }
}

/** 屋顶设备：空调机组 + 检修通道，避免俯视时是一块白板 */
export function add_roof_clutter(parent, { x, z, w, d, y, seed = 20261105, count = 7, outline = null }) {
  const metal = pbr("metal", { repeat: 2, metalness: 0.85, envIntensity: 1.5, normalScale: 0.5 });
  const unit_mat = pbr("concrete_floor", { repeat: 2, tint: 0xcfcbc2, normalScale: 0.7 });

  /* 楼顶轮廓常常不是矩形（L 形、切过的段），按包围盒撒设备会撒到屋面外，
     远处看就是一根根悬空的细条。给了 outline 就逐件判一下在不在屋面内。 */
  const on_roof = (px, pz) => {
    if (!outline || outline.length < 3) return true;
    let c = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i];
      const [xj, zj] = outline[j];
      if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };

  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    const uw = 2.4 + rnd() * 2.0;
    const ud = 1.6 + rnd() * 1.3;
    const uh = 0.7 + rnd() * 0.45;
    if (uw > w - 6 || ud > d - 4) continue;
    const px = x + (rnd() - 0.5) * (w - 6);
    const pz = z + (rnd() - 0.5) * (d - 4);
    if (!on_roof(px, pz)) continue;

    const unit = new THREE.Mesh(new THREE.BoxGeometry(uw, uh, ud), unit_mat);
    unit.position.set(px, y + uh / 2, pz);
    parent.add(unit);

    const fan = new THREE.Mesh(new THREE.CylinderGeometry(ud * 0.28, ud * 0.28, 0.12, 12), metal);
    fan.position.set(px, y + uh + 0.06, pz);
    parent.add(fan);
  }

  /* 检修走道：两端都要在屋面内，否则会从山墙里伸出去 */
  if (w > 14 && on_roof(x - (w - 8) / 2, z + d * 0.3) && on_roof(x + (w - 8) / 2, z + d * 0.3)) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(w - 8, 0.08, 1.3), metal);
    walk.position.set(x, y + 0.05, z + d * 0.3);
    parent.add(walk);
  }
}

/**
 * 生成一栋楼。
 *
 * @param outline  [[x, z], ...] 世界坐标的底面轮廓
 * @param height   层高 × 层数
 * @param mat      外墙材质
 * @param opts.floors  楼层数（决定窗的行数），缺省按 height / FLOOR_H
 */
export function make_building({
  outline,
  height,
  wall_mat,
  glass_mat,
  frame_mat,
  parapet = true,
  plinth = true,
  floor_h = FLOOR_H,
  bay = BAY,
  win_w,
  win_h,
  roof = true,
  shrink = 0,
}) {
  const g = new THREE.Group();

  /* 可选内缩：从一整块里切出来的相邻楼体，轮廓是共边的，
     不收缩的话在 3D 里仍然连成一堵长墙，看不出是几栋楼。
     按质心等比缩，任意形状都不会自交。 */
  let ol = outline;
  if (shrink > 0) {
    const mx = outline.reduce((a, p) => a + p[0], 0) / outline.length;
    const mz = outline.reduce((a, p) => a + p[1], 0) / outline.length;
    let rad = 0;
    for (const [x, z] of outline) rad += Math.hypot(x - mx, z - mz);
    rad /= outline.length;
    const k = Math.max(0.5, 1 - shrink / Math.max(1, rad));
    ol = outline.map(([x, z]) => [mx + (x - mx) * k, mz + (z - mz) * k]);
  }

  const pts = ol.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(pts);

  /* 主体：不启用倒角，倒角会把窗面外扩吞进墙里 */
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(geo, wall_mat);
  g.add(body);

  /* 勒脚：底部 0.9 米略粗、颜色更深，建筑才「长在地上」 */
  if (plinth) {
    const pm = wall_mat.clone();
    pm.color = new THREE.Color(0x9a978f);
    const pg = new THREE.ExtrudeGeometry(shape, {
      depth: 0.9,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.14,
      bevelSegments: 2,
    });
    pg.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(pg, pm));
  }

  /* 女儿墙 + 压顶 */
  if (parapet) {
    const cap_mat = wall_mat.clone();
    cap_mat.color = new THREE.Color(0xe8e3d8);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = a.distanceTo(b);
      if (len < 0.8) continue;
      const mx = (a.x + b.x) / 2;
      const mz = -(a.y + b.y) / 2;
      const yaw = -Math.atan2(b.y - a.y, b.x - a.x);

      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 0.26), wall_mat);
      wall.position.set(mx, height + 0.3, mz);
      wall.rotation.y = yaw;
      g.add(wall);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.34), cap_mat);
      cap.position.set(mx, height + 0.64, mz);
      cap.rotation.y = yaw;
      g.add(cap);
    }
  }

  add_windows(g, pts, height, glass_mat, frame_mat, { floor_h, bay, win_w, win_h });

  return g;
}

/** 深色反光玻璃：窗玻璃靠「深色 + 高反射 + 低粗糙」就够像，不必用折射 */
export function glass_material(tint = 0x1e2a30) {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0.15,
    roughness: 0.08,
    ior: 1.52,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.4,
    emissive: new THREE.Color(0x0a1216),
    emissiveIntensity: 1.0,
  });
}

/**
 * 远景体量。
 *
 * 展台场景最怕「孤零零一户人」。真实环境里，不管哪个方向望出去，
 * 远处总有别的楼、树、电线杆。这些远景不需要细节——雾会把它们糊掉，
 * 只需要正确的体量分布和高度层次，画面立刻从「模型」变成「地方」。
 */
/** 点在多边形内（世界坐标 x-z 平面） */
function inside_xz(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function add_distant_town(parent, {
  center = [0, 0], count = 46, seed = 7, rMin = 210, rMax = 380,
  /* 避让区：世界坐标多边形。远景楼不能落在校园、森林、小区里，
     否则会出现树上长楼、楼里长树 */
  avoid = [],
} = {}) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const mats = [
    /* 远景楼一条边三四十米，一张贴图按 9 次重复铺上去，
       砖缝与板缝的尺度才对得上，4 次会变成一整墙的大砖 */
    pbr("concrete_wall", { repeat: 9, tint: 0xd6d2ca, normalScale: 0.7 }),
    pbr("brick", { repeat: 9, tint: 0xcdbfae, normalScale: 1.0 }),
    pbr("facade", { repeat: 9, tint: 0xd8d4cc, normalScale: 0.7 }),
  ];
  const roof = pbr("concrete_floor", { repeat: 8, tint: 0x8e8b84 });

  /* 成组布置，不要随机散落。
     随机撒点得到的是一地零散的木箱；真实的城市是成片的街区——
     同一组楼朝向一致、间距紧凑，组与组之间隔着道路和空地。
     雾一糊，远处立刻从「散落的方块」变成「城郊」。 */
  const n_cluster = Math.max(6, Math.round(count / 6));

  for (let c = 0; c < n_cluster; c++) {
    const a = rnd() * Math.PI * 2;
    const r = rMin + rnd() * (rMax - rMin);
    const cx = center[0] + Math.cos(a) * r;
    const cz = center[1] + Math.sin(a) * r;
    const yaw = Math.round(rnd() * 4) * (Math.PI / 4) + rnd() * 0.2;
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);

    const nb = 3 + Math.floor(rnd() * 5);
    /* 街区里的楼沿两条轴向排，间距 30～55 米 */
    for (let i = 0; i < nb; i++) {
      const gx = (Math.floor(i / 2) - 1) * (32 + rnd() * 16);
      const gz = (i % 2 === 0 ? -1 : 1) * (16 + rnd() * 14);
      const px = cx + gx * ca - gz * sa;
      const pz = cz + gx * sa + gz * ca;

      const w = 16 + rnd() * 30;
      const d = 14 + rnd() * 22;
      const h = 9 + rnd() * 36;

      if (avoid.some((poly) => poly.length >= 3 && inside_xz(poly, px, pz))) continue;

      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[(rnd() * mats.length) | 0]);
      box.position.set(px, h / 2, pz);
      box.rotation.y = yaw + (rnd() - 0.5) * 0.06;
      box.castShadow = false;
      box.receiveShadow = true;
      parent.add(box);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.5, d * 1.02), roof);
      cap.position.set(px, h + 0.25, pz);
      cap.rotation.y = box.rotation.y;
      parent.add(cap);
    }
  }
}

/** 折线加宽成路面多边形（像素坐标进，像素坐标出） */
export function ribbon(points, width_m, mpp, closed = false) {
  const hw = width_m / 2 / mpp;
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    left.push([points[i][0] - dy * hw, points[i][1] + dx * hw]);
    right.push([points[i][0] + dy * hw, points[i][1] - dx * hw]);
  }
  return left.concat(right.reverse());
}
