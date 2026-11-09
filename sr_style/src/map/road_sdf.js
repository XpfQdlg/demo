import * as THREE from "three";
import { px_to_world } from "./coords.js";
import PACKAGE from "./data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   road_sdf — 道路距离场

   问题：数据包里只有道路多边形，没有车道线。可车道级导航里最显眼的
   就是路面上那几条线——只画一圈边线，中间空着，看着就不像路。

   做法：把道路多边形栅格化成一张「到路边距离」的图（距离场），
   放进贴图给路面着色器采样。有了每个点离路边多远，就能反推：

     - 离边 0.1~0.4 米   → 边线（已经在几何里画了，这里不用）
     - 离边 ≥ 3.5 米     → 中线（8 米宽的路，中线正好在 4 米处）

   一次性算，1 米一格，整幅图 1333×1079。算完上传成一张贴图，
   着色器按世界坐标采样，绕开「没有中心线数据」这个死结。

   代价：一次 canvas 填充 + 两遍颜色距离变换，约 100 毫秒。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;

/* 距离场编码上限（米）。超过这个值一律按上限存 */
const MAX_D = 8;

let cached = null;

/** 把道路多边形填进画布，取回掩膜。用 canvas 做奇偶填充，省得自己写多边形栅格化 */
function road_mask() {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff";
  g.fillRule = "evenodd";

  for (const s of PACKAGE.roads?.surface || []) {
    g.beginPath();
    const ring = (pts) => {
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };
    ring(s.outer);
    for (const hole of s.holes || []) ring(hole);
    g.fill("evenodd");
  }

  const img = g.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = img[i * 4] > 127 ? 1 : 0;
  return mask;
}

/**
 * 倒角距离变换（chamfer 3-4）。
 * 道路内为 0，路外为无穷，两遍扫描后每个像素拿到「到最近非路像素」的距离。
 * 1 米一格，斜向按 √2 加权，误差约 2%，画标线完全够。
 */
function distance_field(mask) {
  const INF = 1e6;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;

  const A = 1;        // 正交
  const B = Math.SQRT2; // 斜向

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) v = Math.min(v, d[i - W] + A);
      if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + B);
      if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + B);
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + A);
      if (y < H - 1) v = Math.min(v, d[i + W] + A);
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + B);
      if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + B);
      d[i] = v;
    }
  }
  return d;
}

/** 懒建：第一次用到时才算是，四场景共用同一份 */
export function road_sdf() {
  if (cached) return cached;

  if (!PACKAGE.roads?.surface?.length) return null;

  const d = distance_field(road_mask());

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(255, Math.round((d[i] / MAX_D) * 255));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  /* 世界坐标的范围：贴图像素 (0,0) 对应 px_to_world(0,0) */
  const a = px_to_world(0, 0);
  const b = px_to_world(W, H);

  cached = {
    texture: tex,
    /* x0, z0, 宽, 高（世界坐标，米） */
    rect: new THREE.Vector4(a.x, a.z, b.x - a.x, b.z - a.z),
    max: MAX_D,
  };
  return cached;
}
