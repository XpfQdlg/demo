import * as THREE from "three";
import { pbr } from "../core/pbr.js";

/* ══════════════════════════════════════════════════════════════════════════
   props — 观感版的场景道具

   树、灯柱、长椅、垃圾桶、护栏。都是程序化几何，但材质用真实 PBR 贴图，
   和建筑放在一起不会像两套模型。

   树的现实参考：行道树高 6~9 米，树冠占全高的六成，树干下粗上细。
   廉价感主要来自「棒棒糖树」——一个球插在一根杆上。
   这里用两层错位的多面体树冠 + 轻微歪斜，远看就有树的样子。
   ══════════════════════════════════════════════════════════════════════════ */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 一棵树。scale 1 约 7 米高 */
export function tree({ h = 7, seed = 1, tone = 0 } = {}) {
  const g = new THREE.Group();
  const r = rng(seed);

  const bark = pbr("wood", { repeat: 1, tint: 0x6b5844, normalScale: 1.2 });
  /* 树冠用草地贴图染深绿：远看是叶团的颗粒感，比纯色球体耐看 */
  const leafTints = [0x6d8f4a, 0x5d7f3f, 0x7a9c55, 0x54763a];
  const leaf = pbr("grass", {
    repeat: 2,
    tint: leafTints[(tone + Math.floor(r() * 4)) % 4],
    normalScale: 1.6,
  });

  const trunkH = h * 0.42;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(h * 0.018, h * 0.032, trunkH, 7),
    bark
  );
  trunk.position.y = trunkH / 2;
  g.add(trunk);

  /* 树冠：两层多面体，下层宽、上层收顶，各自带随机偏移 */
  const layers = [
    { y: h * 0.62, r: h * 0.30, sy: 0.85 },
    { y: h * 0.84, r: h * 0.21, sy: 0.9 },
  ];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(L.r, 1), leaf);
    blob.position.set(
      (r() - 0.5) * h * 0.06,
      L.y,
      (r() - 0.5) * h * 0.06
    );
    blob.scale.set(1, L.sy, 1);
    blob.rotation.y = r() * Math.PI;
    g.add(blob);
  }

  /* 一点歪斜，避免整排树像复制粘贴 */
  g.rotation.z = (r() - 0.5) * 0.05;
  return g;
}

/** 路灯：金属杆 + 悬臂 + 灯头，灯头自发光配合 Bloom */
export function street_lamp({ h = 4.6, arm = 0.9 } = {}) {
  const g = new THREE.Group();
  const metal = pbr("metal", { repeat: 1, metalness: 0.9, envIntensity: 1.5, normalScale: 0.4 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xfff4de, emissive: 0xffe9c2, emissiveIntensity: 2.4, roughness: 0.35,
  });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, h, 10), metal);
  pole.position.y = h / 2;
  g.add(pole);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(arm, 0.07, 0.07), metal);
  beam.position.set(arm / 2, h - 0.12, 0);
  g.add(beam);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.24), glow);
  head.position.set(arm, h - 0.2, 0);
  g.add(head);

  return g;
}

/** 长椅：木条 + 金属腿 */
export function bench() {
  const g = new THREE.Group();
  const wood = pbr("wood", { repeat: 1, tint: 0x8a6a45, normalScale: 1.0 });
  const metal = pbr("metal", { repeat: 1, metalness: 0.85, envIntensity: 1.2 });

  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.045, 0.13), wood);
    slat.position.set(0, 0.45, -0.16 + i * 0.16);
    g.add(slat);
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.04), wood);
    back.position.set(0, 0.62 + i * 0.17, 0.2);
    back.rotation.x = -0.12;
    g.add(back);
  }
  for (const sx of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.42), metal);
    leg.position.set(sx, 0.22, 0);
    g.add(leg);
  }
  return g;
}

/** 垃圾桶 */
export function bin() {
  const g = new THREE.Group();
  const body = pbr("metal", { repeat: 1, metalness: 0.6, envIntensity: 1.1, tint: 0x5a6168 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.78, 14), body);
  drum.position.y = 0.39;
  g.add(drum);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.025, 8, 18), body);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.78;
  g.add(rim);
  return g;
}

/** 护栏：一段一段的立柱 + 横杆，沿折线摆 */
export function railing(points, { h = 0.95, step = 2.2 } = {}) {
  const g = new THREE.Group();
  const metal = pbr("metal", { repeat: 1, metalness: 0.9, envIntensity: 1.4, tint: 0x6f767d });

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / step));

    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), metal);
      post.position.set(x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t);
      g.add(post);
    }

    for (const y of [h * 0.55, h]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, len), metal);
      bar.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      bar.rotation.y = yaw;
      g.add(bar);
    }
  }
  return g;
}

/** 车辆：车身 + 车顶 + 车轮，比例按真实轿车 */
export function car({ color = 0x9aa0a6, yaw = 0 } = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.08,
    envMapIntensity: 1.6,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a242c, metalness: 0.2, roughness: 0.06, clearcoat: 1.0, envMapIntensity: 2.2,
  });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.92 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.62, 4.36), bodyMat);
  body.position.y = 0.62;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.56, 2.3), glassMat);
  cabin.position.set(0, 1.18, -0.16);
  g.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.9), bodyMat);
  roof.position.set(0, 1.46, -0.16);
  g.add(roof);

  for (const [sx, sz] of [[-0.82, 1.42], [0.82, 1.42], [-0.82, -1.42], [0.82, -1.42]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.33, sz);
    g.add(w);
  }

  g.rotation.y = yaw;
  return g;
}
