import * as THREE from "three";
import { px_to_world, MAP } from "../map/coords.js";

/* ══════════════════════════════════════════════════════════════════════════
   CrowdHeat — 人员密度热区

   口径来自方案里那段：雷达擅长发现「拥堵、堵车」这类大范围、多目标的情况，
   视觉擅长「起火、门窗损坏」这类细节。热区就是把前一半演出来。

   做法：
   1. 每 0.5 秒按人群位置往一张粗网格里累加高斯权重（σ 取 24 米）；
   2. 密度映射成绿 → 黄 → 红，写进一张小画布；
   3. 贴到地形上的一层平面上，线性过滤会把 16 米一格糊成连续色团。

   代价：网格只有八十来乘六十几个，一次刷新几万次浮点运算，可以忽略。
   ══════════════════════════════════════════════════════════════════════════ */

const CELL_M = 16;
const SIGMA = 15;
const REFRESH = 0.5;

export class CrowdHeat {
  constructor() {
    const wm = MAP.width_px * MAP.meters_per_px;
    const hm = MAP.height_px * MAP.meters_per_px;

    this.w = Math.ceil(wm / CELL_M);
    this.h = Math.ceil(hm / CELL_M);
    this.density = new Float32Array(this.w * this.h);

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext("2d");
    this.image = this.ctx.createImageData(this.w, this.h);

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.14;
    this.mesh.name = "crowd_heat";
    this.mesh.renderOrder = 3;
    this.mesh.userData.no_merge = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    this.crowd = null;
    this.timer = 0;
  }

  mount(root, floor_y = 0) {
    if (this.mesh.parent !== root) root.add(this.mesh);
    this.mesh.position.y = floor_y + 0.14;
  }

  unmount() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }

  set_crowd(crowd) {
    this.crowd = crowd;
    this.mesh.visible = !!crowd;
    this.timer = 0;
  }

  update(dt) {
    if (!this.crowd) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH;

    const people = this.crowd.people || [];
    this.density.fill(0);

    /* 每个人往网格里加一团高斯权重 */
    const sig2 = 2 * SIGMA * SIGMA;
    for (const it of people) {
      const w = px_to_world(it.x, it.y);
      const cx = (w.x + (MAP.width_px * MAP.meters_per_px) / 2) / CELL_M;
      const cz = (w.z + (MAP.height_px * MAP.meters_per_px) / 2) / CELL_M;

      const r = 3;
      for (let dz = -r; dz <= r; dz++) {
        const z = Math.round(cz) + dz;
        if (z < 0 || z >= this.h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(cx) + dx;
          if (x < 0 || x >= this.w) continue;
          const ddx = (x + 0.5 - cx) * CELL_M;
          const ddz = (z + 0.5 - cz) * CELL_M;
          this.density[z * this.w + x] += Math.exp(-(ddx * ddx + ddz * ddz) / sig2);
        }
      }
    }

    this.paint();
  }

  paint() {
    const data = this.image.data;
    const n = this.w * this.h;

    /* 按本帧最大值归一：地铁站里十几个人挤在几十平方米，绝对密度是校园的几倍，
       用同一个除数会一边糊成红布、一边几乎看不见。给个下限，别让人少时全图变红。 */
    let max = 0;
    for (let i = 0; i < n; i++) if (this.density[i] > max) max = this.density[i];
    const norm = Math.max(0.9, max * 0.85);

    for (let i = 0; i < n; i++) {
      const t = Math.min(1, this.density[i] / norm);
      const o = i * 4;

      if (t < 0.06) {
        data[o + 3] = 0;
        continue;
      }

      /* 绿 → 黄 → 红 */
      let r, g, b;
      if (t < 0.55) {
        const k = t / 0.55;
        r = 0.30 + 0.62 * k;
        g = 0.82 - 0.08 * k;
        b = 0.42 - 0.16 * k;
      } else {
        const k = (t - 0.55) / 0.45;
        r = 0.92 + 0.03 * k;
        g = 0.74 - 0.40 * k;
        b = 0.26 - 0.02 * k;
      }

      data[o] = r * 255;
      data[o + 1] = g * 255;
      data[o + 2] = b * 255;
      data[o + 3] = (0.10 + 0.55 * t) * 255;
    }

    this.ctx.putImageData(this.image, 0, 0);
    this.tex.needsUpdate = true;
  }
}
