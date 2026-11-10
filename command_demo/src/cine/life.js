import * as THREE from "three";
import { Crowd, crowd_cluster } from "../core/crowd.js";
import { fireFlame, smokePlume, car, scooter, person } from "../core/kit.js";
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

/** 违规吸烟：只有一小股烟、没有火，和明火道具在画面里能分开 */
function make_smoke() {
  const g = new THREE.Group();
  const smoke = smokePlume({ rate: 7, size: 0.55, rise: 1.4, spread: 0.16 });
  smoke.position.y = 0.9;
  g.add(smoke);
  /* 脚下一只被踩灭的烟头 + 一点余烬，近看才知道是吸烟不是着火 */
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a4a })
  );
  ember.position.set(0.18, 0.06, 0.1);
  g.add(ember);
  return g;
}

/** 消防栓：红色栓体 + 两侧取水口，压在草丛里的那种 */
function make_hydrant() {
  const g = new THREE.Group();
  const red = pbr("metal", { repeat: 1, tint: 0xc0342c, metalness: 0.25, roughness: 0.55 });
  const dark = pbr("metal", { repeat: 1, tint: 0x6d2a24, metalness: 0.3, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.72, 12), red);
  body.position.y = 0.36;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.16, 10), red);
  cap.position.y = 0.8;
  g.add(cap);
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 10), dark);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(side * 0.2, 0.5, 0);
    g.add(nozzle);
  }
  /* 一圈没膝的杂草：照片里的栓体就是被草埋住的 */
  const grass = pbr("grass", { repeat: 3, tint: 0x6f7a4a, normalScale: 0.6 });
  for (let i = 0; i < 7; i++) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5 + (i % 3) * 0.12, 5), grass);
    const a = (i / 7) * Math.PI * 2;
    tuft.position.set(Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42);
    tuft.rotation.y = a;
    g.add(tuft);
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/** 灭火器异常：红色器材箱 + 半开的门，箱前放一只倒下的灭火器 */
function make_ext() {
  const g = new THREE.Group();
  const red = pbr("metal", { repeat: 1, tint: 0xb32d26, metalness: 0.2, roughness: 0.6 });
  const white = pbr("concrete_wall", { repeat: 1, tint: 0xe8e4dc, normalScale: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.42), red);
  box.position.y = 0.62;
  g.add(box);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.9, 0.04), white);
  panel.position.set(0, 0.66, 0.23);
  g.add(panel);
  /* 门歪着挂在一边，表示箱体被打开、器材状态不明 */
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.44, 1.05, 0.05), red);
  door.position.set(-0.52, 0.6, 0.3);
  door.rotation.y = -0.7;
  g.add(door);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.52, 10), red);
  tank.position.set(0.62, 0.26, 0.28);
  tank.rotation.z = Math.PI / 2.4;
  g.add(tank);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/** 疏散通道堵塞：安全出口灯牌 + 下面堆着纸箱，人得侧身过 */
function make_exit_block() {
  const g = new THREE.Group();
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 0.28, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x37ff86 })
  );
  sign.position.set(0, 2.1, 0);
  g.add(sign);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6),
      pbr("metal", { repeat: 1, tint: 0x8f9aa0, metalness: 0.4 })
    );
    post.position.set(side * 0.55, 1.05, 0);
    g.add(post);
  }
  const cardboard = pbr("wood", { repeat: 2, tint: 0xa8916d, normalScale: 0.7 });
  const sizes = [
    [0.7, 0.5, 0.6],
    [0.6, 0.42, 0.55],
    [0.5, 0.36, 0.5],
    [0.66, 0.3, 0.5],
  ];
  sizes.forEach((s, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), cardboard);
    m.position.set(-0.35 + (i % 2) * 0.62, s[1] / 2 + (i > 1 ? 0.34 : 0), 0.1 + (i % 3) * 0.14);
    m.rotation.y = (i - 1.5) * 0.18;
    g.add(m);
  });
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/**
 * 违停车辆：车斜停在路沿，压着一块黄色网格线，远处一眼看出「占道」。
 * 对应素材里 campus-road-2（白车压在黄格线上）那张实拍。
 */
function make_parking() {
  const g = new THREE.Group();
  const c = car({ color: 0xe9ecef, type: "sedan" });
  c.rotation.y = 0.42;
  c.position.set(0.6, 0, -0.3);
  g.add(c);

  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 4.6),
    new THREE.MeshStandardMaterial({ color: 0xffce3d, roughness: 0.92, transparent: true, opacity: 0.32 })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(-1.8, 0.03, 1.6);
  g.add(grid);
  return g;
}

/**
 * 非机动车载人：一辆电动车旁站两个人，对应素材里 campus-road-3
 * （一辆小电驴载着两个人从林荫路穿过）。
 */
function make_ebike() {
  const g = new THREE.Group();
  const s = scooter({ color: 0x2f6f92 });
  s.rotation.y = 0.5;
  g.add(s);

  const a = person({ shirt: 0x2b3138, pants: 0x2a2f36 });
  a.position.set(0.72, 0, 0.5);
  a.rotation.y = -0.4;
  g.add(a);

  const b = person({ shirt: 0x8d9199, pants: 0x2b3138 });
  b.position.set(-0.52, 0, 0.6);
  b.rotation.y = 0.3;
  g.add(b);
  return g;
}

/**
 * 站台屏蔽门：两扇玻璃门 + 门楣指示灯，对应素材里 subway-platform-2
 * （一段带黄色警示条和「注意站台与列车之间高度差」提示的屏蔽门）。
 */
function make_door() {
  const g = new THREE.Group();
  const frameMat = pbr("metal", 1, 1, { tint: 0xcfd6de });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xaecbe0,
    roughness: 0.18,
    metalness: 0.2,
    transparent: true,
    opacity: 0.42,
  });

  for (const x of [-1.05, 1.05]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.3, 0.08), glass);
    panel.position.set(x, 1.18, 0);
    g.add(panel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.14), frameMat);
    rail.position.set(x, 2.36, 0);
    g.add(rail);
  }

  const sill = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 0.3), frameMat);
  sill.position.set(0, 0.06, 0);
  g.add(sill);

  /* 门楣指示灯：绿色常亮改成黄色，表示「状态异常」 */
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.12, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffd257, emissive: 0xffb020, emissiveIntensity: 1.6 })
  );
  lamp.position.set(0, 2.52, 0);
  g.add(lamp);

  /* 站台黄色警示条 */
  const warn = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xffcf3f, roughness: 0.9 })
  );
  warn.rotation.x = -Math.PI / 2;
  warn.position.set(0, 0.02, 1.1);
  g.add(warn);

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

/**
 * 在指定像素点摆一个情景。
 * @param kind  'trash' | 'fire' | 'crowd' | 'smoke' | 'hydrant' | 'ext' | 'exit' | 'ebike' | 'parking' | 'door'
 */
export function make_scene_prop(kind, px, seed = 1) {
  const [cx, cy] = px;
  const w = px_to_world(cx, cy);

  /* 聚集人群的子节点本身就是世界坐标，整组不再偏移；
     其余道具是本地坐标，整组挪到点位 */
  let g;
  if (kind === "crowd") {
    g = crowd_cluster({ center_px: px, count: 9, seed });
  } else {
    const maker =
      kind === "fire"
        ? make_fire
        : kind === "smoke"
          ? make_smoke
          : kind === "hydrant"
            ? make_hydrant
            : kind === "ext"
              ? make_ext
              : kind === "exit"
                ? make_exit_block
                : kind === "ebike"
                  ? make_ebike
                  : kind === "parking"
                    ? make_parking
                    : kind === "door"
                      ? make_door
                      : make_trash;
    g = maker(seed);
    g.position.set(w.x, 0, w.z);
  }
  g.userData.no_merge = true;
  g.userData.scenario_kind = kind;
  return g;
}
