import * as THREE from "three";
import { Crowd, crowd_cluster } from "../core/crowd.js";
import { fireFlame, smokePlume } from "../core/kit.js";
import { px_to_world } from "../map/coords.js";
import { pbr } from "../core/pbr.js";

/* ══════════════════════════════════════════════════════════════════════════
   life — 观感版场景里的「活物」与情景道具

   两块内容：
     行人      观感版原来没有人，空城的画面说服力不够
     情景道具  垃圾堆积、明火、人员聚集，点位落在巡检航点上，
              设备走过去就能「发现」，第一人称必须看得见

   行人复用主演示的 Crowd（同一个类），动作由 kit 的 ticker 驱动，
   调用方只需要每帧调一次 tick_people()。
   ══════════════════════════════════════════════════════════════════════════ */

/** 给场景撒人。返回 Crowd 实例，由调用方逐帧推进 */
export function add_people(
  root,
  { scene_id, count = 14, seed = 1, center = null, radius_px = 130, floor_y = 0 } = {}
) {
  /* floor_y：地铁站台高 0.9 米，人站到台面上，否则腿埋在台面里只剩上半身 */
  const crowd = new Crowd({ scene_id, nav_kind: "road", count, seed, center, radius_px, floor_y });
  const g = crowd.build();
  g.userData.no_merge = true;   // 有走动动画，不能烘进静态几何
  g.name = "crowd";
  root.add(g);
  return crowd;
}

/** 垃圾堆：几个歪斜的箱子和袋子，近看能认出是堆积物 */
function make_trash(seed = 1) {
  const g = new THREE.Group();
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const mat = [
    pbr("concrete_floor", { repeat: 2, tint: 0x8d8a80, normalScale: 0.8 }),
    pbr("wood", { repeat: 2, tint: 0x9a8a70, normalScale: 0.9 }),
    pbr("metal", { repeat: 2, tint: 0x7d848a, metalness: 0.5 }),
  ];
  for (let i = 0; i < 14; i++) {
    const w = 0.6 + rnd() * 0.8;
    const h = 0.4 + rnd() * 0.7;
    const d = 0.5 + rnd() * 0.7;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat[(rnd() * mat.length) | 0]);
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 2.4;
    m.position.set(Math.cos(a) * r, h / 2 + rnd() * 0.25, Math.sin(a) * r);
    m.rotation.set((rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** 明火：火焰加烟柱，两者都靠 kit 的 ticker 自己动 */
function make_fire() {
  const g = new THREE.Group();
  const flame = fireFlame({ size: 1.6, intensity: 1.4 });
  flame.position.y = 0.35;
  g.add(flame);
  const smoke = smokePlume({ rate: 14, size: 1.1, rise: 2.2, spread: 0.28 });
  smoke.position.y = 1.0;
  g.add(smoke);
  return g;
}

/**
 * 在指定像素点摆一个情景。
 * @param kind  'trash' | 'fire' | 'crowd'
 */
export function make_scene_prop(kind, px, seed = 1) {
  const [cx, cy] = px;
  const w = px_to_world(cx, cy);

  /* 聚集人群的子节点本身就是世界坐标，整组不再偏移；
     垃圾堆与明火是本地坐标，整组挪到点位 */
  let g;
  if (kind === "crowd") {
    g = crowd_cluster({ center_px: px, count: 9, seed });
  } else {
    g = kind === "fire" ? make_fire() : make_trash(seed);
    g.position.set(w.x, 0, w.z);
  }
  g.userData.no_merge = true;
  g.userData.scenario_kind = kind;
  return g;
}
