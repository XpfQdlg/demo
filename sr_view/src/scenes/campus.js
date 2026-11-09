import * as THREE from "three";
import * as K from "../core/kit.js";
import { asphaltTex, tileTex, concreteTex, tiled, signTex, metalTex } from "../core/tex.js";
import { T, attach, polyDist } from "./helper.js";

/* 点到线段的距离 */
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

/* ══════════════════════════════════════════════════════════════════════════
   场景三 · 校园日常巡检（教学楼走廊 / 广场道路 / 绿化设施）
   ══════════════════════════════════════════════════════════════════════════ */

const WALL = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.94 });
const WALL2 = new THREE.MeshStandardMaterial({ color: 0xb9c1c8, roughness: 0.9 });
const DARKIN = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 1 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.45 });

/* 走廊立柱 */
function column() {
  const g = K.group(0, 0, 0);
  g.add(K.box(0.5, 0.12, 0.5, WALL2, 0, 0.06, 0));
  g.add(K.box(0.36, 3.3, 0.36, WALL, 0, 1.77, 0));
  return g;
}

/* 墙上挂板（给表计/开关做背景） */
function plate(w = 1.1, h = 0.8, y = 1.5) {
  const g = K.group(0, 0, 0);
  g.add(K.box(w, h, 0.06, new THREE.MeshStandardMaterial({ color: 0x6f757c, roughness: 0.6, metalness: 0.4 }), 0, y, 0.03));
  return g;
}

/* 安全出口：门 + 上方应急疏散指示灯 */
function exitDoor({ open = false, lit = true, label = "安全出口" } = {}) {
  const g = K.group(0, 0, 0);
  g.add(K.box(1.5, 2.3, 0.3, DARKIN, 0, 1.15, 0));
  const door = K.fireDoor({ open, w: 1.3, h: 2.1 });
  door.position.z = 0.16;
  g.add(door);
  const signTex_ = signTex(label, { bg: lit ? "#0f7a3d" : "#3a3f42", fg: lit ? "#eafff2" : "#8b9196", w: 512, h: 200, font: 'bold 92px "Microsoft YaHei",sans-serif' });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.36),
    new THREE.MeshStandardMaterial({ map: signTex_, roughness: 0.7, emissive: lit ? 0x1f8f52 : 0x000000, emissiveIntensity: lit ? 0.55 : 0, emissiveMap: lit ? signTex_ : null })
  );
  sign.position.set(0, 2.52, 0.18);
  g.add(sign);
  g.userData.lit = lit;
  return g;
}

/* 走廊顶灯 */
function ceilingLight({ on = true } = {}) {
  const g = K.group(0, 0, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: on ? 0xf6f2e2 : 0x3c4147,
    emissive: on ? 0xfff0cc : 0x000000,
    emissiveIntensity: on ? 1.1 : 0,
    roughness: 0.6,
  });
  g.add(K.box(1.1, 0.07, 0.2, mat, 0, 0, 0));
  if (on) {
    const l = new THREE.PointLight(0xffe9bd, 4.2, 7.5, 2);
    l.position.y = -0.15;
    g.add(l);
  }
  g.userData.lampMat = mat;
  return g;
}

/* 指示灯组：红黄绿 */
function indicatorBank({ dead = 0 } = {}) {
  const g = K.group(0, 0, 0);
  g.add(K.box(0.62, 0.24, 0.08, new THREE.MeshStandardMaterial({ color: 0x22272c, roughness: 0.7 }), 0, 1.35, 0.04));
  const cols = [0xe03e3e, 0xf2c230, 0x35c46a];
  cols.forEach((c, i) => {
    const on = i !== dead;
    const m = new THREE.MeshStandardMaterial({ color: on ? c : 0x2a2f33, emissive: on ? c : 0x000000, emissiveIntensity: on ? 1.2 : 0, roughness: 0.5 });
    g.add(K.ball(0.058, m, -0.18 + i * 0.18, 1.35, 0.1));
  });
  return g;
}

/* 仪表墙：压力表 / 温度表 / 流量表 */
function meterWall({ dead = -1 } = {}) {
  const g = plate(1.5, 0.95, 1.5);
  g.add(K.gauge("pressure", 0.17).translateX(-0.42).translateY(1.62).translateZ(0.1));
  g.add(K.gauge("temp", 0.17).translateY(1.62).translateZ(0.1));
  g.add(K.gauge("flow", 0.17).translateX(0.42).translateY(1.62).translateZ(0.1));
  if (dead >= 0) {
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.9 });
    g.add(K.ball(0.19, m, -0.42 + dead * 0.42, 1.62, 0.14));
  }
  return g;
}

/* 机械开关组（拨动开关 / 旋钮 / 手柄） */
function switchWall({ stuck = 1 } = {}) {
  const g = plate(1.25, 0.86, 1.45);
  g.add(K.switchPanel({ cols: 3, rows: 2 }).translateY(1.45).translateZ(0.09));
  const red = new THREE.MeshStandardMaterial({ color: 0xd94a3d, roughness: 0.5, emissive: 0x551510, emissiveIntensity: 0.6 });
  g.add(K.cyl(0.05, 0.09, red, 0.46, 1.2, 0.12, 12).translateZ(0));
  g.userData.stuck = stuck;
  return g;
}

/* 梯级 / 台阶（可破损） */
function steps({ broken = -1, n = 4 } = {}) {
  const g = K.group(0, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tiled(concreteTex("#b9b7ad", "#8d8b83"), 1, 1), roughness: 0.92 });
  for (let i = 0; i < n; i++) {
    const s = K.box(3.4, 0.16, 0.34, mat, 0, 0.08 + i * 0.16, -i * 0.34);
    if (i === broken) {
      s.scale.x = 2.2;
      s.position.x = -0.5;
      s.material = new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: 1 });
    }
    g.add(s);
  }
  return g;
}

/* 玻璃门（可破损） */
function glassDoor({ broken = false, w = 2.2, h = 2.3 } = {}) {
  const g = K.group(0, 0, 0);
  const frame = new THREE.MeshStandardMaterial({ color: 0x8f979e, roughness: 0.35, metalness: 0.7 });
  g.add(K.box(0.08, h, 0.1, frame, -w / 2, h / 2, 0));
  g.add(K.box(0.08, h, 0.1, frame, w / 2, h / 2, 0));
  g.add(K.box(w, 0.08, 0.1, frame, 0, h, 0));
  if (broken) {
    for (let i = 0; i < 5; i++) {
      const shard = new THREE.Mesh(new THREE.PlaneGeometry(0.3 + Math.random() * 0.4, 0.2 + Math.random() * 0.5), GLASS);
      shard.position.set(-w / 2 + 0.2 + Math.random() * (w - 0.4), 0.3 + Math.random() * (h - 0.5), 0.02);
      shard.rotation.z = Math.random() * 1.2 - 0.6;
      g.add(shard);
    }
    g.add(K.box(w, 0.02, 0.02, frame, 0, 1.1, 0));
  } else {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, h - 0.16), GLASS);
    pane.position.set(0, h / 2, 0);
    g.add(pane);
  }
  return g;
}

/* 推车 / 杂物堆（挡道） */
function trolley() {
  const g = K.group(0, 0, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.4, metalness: 0.8 });
  g.add(K.box(1.05, 0.06, 0.6, metal, 0, 0.42, 0));
  g.add(K.box(1.05, 0.06, 0.6, metal, 0, 0.92, 0));
  for (const x of [-0.48, 0.48]) for (const z of [-0.26, 0.26]) g.add(K.box(0.05, 1.0, 0.05, metal, x, 0.5, z));
  g.add(K.cardboard(-0.2, 0.16, 0.85).translateY(0.45));
  g.add(K.cardboard(0.24, -0.1, 0.7).translateY(0.95));
  g.rotation.y = 0.4;
  return g;
}

/* 漏水的水桶 / 液体泄漏 */
function leakDrum() {
  const g = K.group(0, 0, 0);
  const drum = new THREE.MeshStandardMaterial({ color: 0x2f6f92, roughness: 0.55, metalness: 0.3 });
  g.add(K.cyl(0.28, 0.85, drum, 0, 0.43, 0, 18));
  g.add(K.cyl(0.29, 0.05, drum, 0, 0.2, 0, 18));
  g.add(K.cyl(0.29, 0.05, drum, 0, 0.66, 0, 18));
  g.add(K.cyl(0.05, 0.16, drum, 0.28, 0.66, 0, 10).rotateZ(Math.PI / 2));
  const p = K.puddle(0.55, 0.3, 2.0, 1.4, 0.3);
  p.position.y = 0.02;
  g.add(p);
  g.add(K.drip({ height: 1.6 }).translateX(0.5).translateZ(0.2));
  return g;
}

/* 天花板渗漏：水渍 + 滴水 */
function ceilingLeak() {
  const g = K.group(0, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 1, transparent: true, opacity: 0.55 });
  const s = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20), mat);
  s.rotation.x = Math.PI / 2;
  s.position.set(0, 0.01, 0);
  g.add(s);
  g.add(K.drip({ height: 2.6 }));
  return g;
}

/* 病树 / 枯枝 */
function sickTree() {
  const g = K.group(0, 0, 0);
  const t = K.tree({ h: 5.6, r: 0.2, kind: "broad", dry: true });
  g.add(t);
  for (let i = 0; i < 5; i++) {
    const br = K.cyl(0.035, 1.1, K.M.leafDry, 0, 3.2 + i * 0.14, 0, 6);
    br.rotation.set(0.7 + Math.random() * 0.4, i * 1.3, 0);
    br.position.x = Math.cos(i * 1.3) * 0.8;
    br.position.z = Math.sin(i * 1.3) * 0.8;
    g.add(br);
  }
  return g;
}

/* 一群人 */
function crowdGroup(n = 6, spread = 1.5) {
  const g = K.group(0, 0, 0);
  const shirts = [0x2f4a6d, 0xb2574a, 0xd8d3c6, 0x3f6b52, 0x8a6fa8, 0xe0a33a];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = K.person({ shirt: shirts[i % shirts.length], walk: i % 3 === 0 });
    p.position.set(Math.cos(a) * spread * (0.5 + Math.random() * 0.5), 0, Math.sin(a) * spread * (0.5 + Math.random() * 0.5));
    p.rotation.y = Math.random() * 6.28;
    g.add(p);
  }
  return g;
}

/* 破损地砖堆 */
function tileDamage() {
  const g = K.group(0, 0, 0);
  g.add(K.crackDecal(1.6).translateX(0.2));
  for (let i = 0; i < 4; i++) {
    const t = K.box(0.34, 0.05, 0.34, new THREE.MeshStandardMaterial({ color: 0xb7b0a2, roughness: 0.95 }), -0.4 + Math.random() * 1.2, 0.045, -0.3 + Math.random() * 0.7);
    t.rotation.y = Math.random();
    g.add(t);
  }
  return g;
}

export default {
  id: "campus",
  name: "校园",
  title: "校园安全与设施巡检",
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 10-5-10-5Zm-8 7v6l8 4 8-4v-6l-8 4-8-4Z"/></svg>',
  env: {
    env: "city",
    sky: 0x9db8cf,
    dome: [0x7ba6cc, 0xdfe8ee],
    fogNear: 30,
    fogFar: 96,
    sunColor: 0xfff0cf,
    sunInt: 2.7,
    hemiSky: 0xdcebf7,
    hemiGround: 0x5b5c52,
    hemiInt: 1.0,
    sunPos: [16, 26, 18],
    exposure: 0.95,
  },
  camera: { pos: [12.4, 7.4, 19.6], target: [1.2, 1.1, -2.4] },
  spawn: { x: 1.0, z: 7.2, heading: Math.PI },

  build() {
    const root = new THREE.Group();
    const targets = [];
    const R = K.rng(919);

    root.add(K.skyDome(this.env.dome[0], this.env.dome[1], 170));
    K.ground(root, K.M.concrete, 150, 5);

    /* ── 广场铺装 ─────────────────────────────────────────────── */
    const plazaTex = tiled(tileTex("#a29d92", "#7c776d", 4), 12, 10);
    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 30),
      K.surf(plazaTex, { bump: 0.9, rough: 0.64, metal: 0.04, env: 0.42, roughMap: [0.45, 0.95] })
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.012, 3);
    plaza.receiveShadow = true;
    root.add(plaza);

    /* ── 校区道路 ─────────────────────────────────────────────── */
    const roadTex = tiled(asphaltTex(), 16, 3);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 9),
      K.surf(roadTex, { bump: 1.3, rough: 0.95, metal: 0.02, env: 0.4, roughMap: [0.7, 1.0] })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.009, 20);
    road.receiveShadow = true;
    root.add(road);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.8 });
    for (const z of [15.8, 24.2]) {
      const l = K.box(90, 0.01, 0.13, lineMat);
      l.position.set(0, 0.02, z);
      root.add(l);
    }
    for (let i = -9; i <= 9; i++) {
      const d = K.box(1.5, 0.01, 0.1, lineMat);
      d.position.set(i * 4.8, 0.021, 20);
      root.add(d);
    }

    /* ── 教学楼 ───────────────────────────────────────────────── */
    const main = K.building({ w: 34, h: 19, d: 11, wall: "#d7cfc0", win: "#31465a", cols: 9, rows: 6, lit: 0.14 });
    main.position.set(0, 0, -18);
    root.add(main);
    for (const [x, h] of [[-22, 14], [23, 16]]) {
      const b = K.building({ w: 10, h, d: 10, wall: "#cfc8ba", win: "#2f4356", cols: 3, rows: 5, lit: 0.12 });
      b.position.set(x, 0, -19);
      root.add(b);
    }

    /* ── 走廊：地面 + 顶板 + 立柱 ─────────────────────────────── */
    const corrTex = tiled(tileTex("#aaa69b", "#807c72", 3), 16, 3);
    const corr = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 4.2),
      K.surf(corrTex, { bump: 0.8, rough: 0.45, metal: 0.06, env: 0.6, roughMap: [0.3, 0.8] })
    );
    corr.rotation.x = -Math.PI / 2;
    corr.position.set(0, 0.014, -10.3);
    corr.receiveShadow = true;
    root.add(corr);
    const roof = K.box(40, 0.28, 4.6, WALL2, 0, 3.85, -10.3);
    roof.castShadow = true;
    root.add(roof);
    for (let x = -19; x <= 19; x += 3.8) {
      const c = column();
      c.position.set(x, 0, -8.6);
      root.add(c);
    }
    /* 走廊墙板（挡住建筑内部） */
    const wall = K.wallRun(40, 3.9, WALL, 0.24);
    wall.position.set(0, 0, -12.5);
    root.add(wall);
    /* 走廊顶灯 */
    for (let x = -16; x <= 16; x += 5.4) {
      const l = ceilingLight({ on: true });
      l.position.set(x, 3.66, -10.2);
      root.add(l);
    }

    /* ── 走廊内点位 ───────────────────────────────────────────── */
    {
      const g = K.group(0, 0, 0);
      const sw = switchWall({ stuck: 1 });
      sw.position.set(-0.2, 0, -12.3);
      g.add(sw);
      attach(root, targets, T("s-switch", "机械开关识别", "switch_panel", [-11.6, 1.5, -12.2], [-11.6, -10.4], { conf: 0.93 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const mw = meterWall({ dead: -1 });
      mw.position.set(0, 0, -12.3);
      g.add(mw);
      attach(root, targets, T("s-meter", "仪表读数识别", "meter", [-8.8, 1.5, -12.2], [-8.8, -10.4], { conf: 0.92 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      /* 门窗状态：墙上开窗 + 侧门未关 */
      g.add(K.box(2.0, 1.2, 0.06, GLASS, 0, 1.75, 0.14));
      g.add(K.box(2.1, 0.06, 0.16, WALL, 0, 2.38, 0.12));
      g.add(K.box(2.1, 0.06, 0.16, WALL, 0, 1.12, 0.12));
      const sideDoor = K.fireDoor({ open: true, w: 1.0, h: 2.05 });
      sideDoor.position.set(1.5, 0, 0.16);
      sideDoor.rotation.y = -0.5;
      g.add(sideDoor);
      attach(root, targets, T("s-window", "门窗状态识别", "door_state", [-5.4, 1.6, -12.2], [-5.4, -10.3], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const ed = exitDoor({ open: false, lit: true });
      ed.position.set(0, 0, -12.2);
      g.add(ed);
      attach(root, targets, T("s-firedoor", "防火门状态识别", "fire_door", [-2.4, 1.4, -12.1], [-2.4, -10.2], { conf: 0.91 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const ed = exitDoor({ open: true, lit: true });
      ed.position.set(0, 0, -12.2);
      g.add(ed);
      attach(root, targets, T("s-exit", "安全出口识别", "evacuation_sign", [1.2, 2.4, -12.0], [1.2, -10.2], { conf: 0.94 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const ind = indicatorBank({ dead: 1 });
      ind.position.set(0, 0, -12.2);
      g.add(ind);
      attach(root, targets, T("s-indicator", "指示灯状态检测", "indicator", [3.6, 1.35, -12.1], [3.6, -10.3], { conf: 0.89 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      /* 照明灯状态：一盏坏掉的顶灯 */
      const bad = ceilingLight({ on: false });
      bad.position.set(0, 3.66, -10.2);
      g.add(bad);
      const goodLampGroup = ceilingLight({ on: true });
      goodLampGroup.position.set(2.4, 3.66, -10.2);
      g.add(goodLampGroup);
      attach(root, targets, T("s-lamp-fixture", "照明灯状态检测", "light_fixture", [6.6, 3.6, -10.2], [6.6, -8.6], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const el = K.elevator({ w: 1.9, h: 2.3 });
      el.position.set(0, 0, -12.3);
      g.add(el);
      attach(root, targets, T("s-elevator", "电梯外观巡检", "elevator", [9.6, 1.3, -12.1], [9.6, -10.0], { conf: 0.9 }), g);
    }
    {
      const g = trolley();
      attach(root, targets, T("s-corridor-obst", "楼道障碍物检测", "blocked_path", [12.6, 0.7, -10.2], [10.6, -9.4], { conf: 0.92 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      g.add(K.cardboard(0, 0, 1.1).translateY(0));
      g.add(K.cardboard(0.3, 0.1, 0.9).translateY(0.46));
      g.add(K.cardboard(-0.2, -0.1, 0.8).translateY(0.86));
      g.add(K.luggage({ w: 0.46, h: 0.62, d: 0.3, color: 0x4a5b6b }).translateX(0.9));
      attach(root, targets, T("s-corridor-clutter", "楼道堆物检测", "corridor_clutter", [15.4, 0.9, -10.4], [15.4, -8.6], { conf: 0.88 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const b = K.fireBox();
      b.position.set(0, 0, -12.3);
      g.add(b);
      const e = K.extinguisher();
      e.position.set(-0.5, 0, -12.15);
      g.add(e);
      attach(root, targets, T("s-ext", "灭火器识别", "extinguisher", [-15.2, 0.9, -12.1], [-15.2, -10.2], { conf: 0.92 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const h = K.hydrant();
      h.position.set(0, 0, -12.15);
      g.add(h);
      const sb = K.signBoard("消防设施 · 消火栓", { w: 1.5, h: 0.42, bg: "#b3261e", y: 1.75 });
      sb.position.set(0, 0, -12.3);
      g.add(sb);
      attach(root, targets, T("s-hydrant", "消防栓识别", "hydrant", [17.8, 0.8, -12.0], [17.8, -10.2], { conf: 0.93 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      g.add(K.box(1.1, 1.5, 0.55, new THREE.MeshStandardMaterial({ color: 0xc8452f, roughness: 0.7 }), 0, 0.75, 0));
      g.add(K.box(1.0, 0.1, 0.06, GLASS, 0, 1.1, 0.29));
      const sb = K.signBoard("消防设施", { w: 1.2, h: 0.36, bg: "#b3261e", y: 1.9 });
      g.add(sb);
      attach(root, targets, T("s-fire-equip", "消防设施检测", "fire_equipment", [15.0, 0.9, -12.0], [15.0, -10.2], { conf: 0.91 }), g);
    }

    /* ── 室外：消防通道被占 ───────────────────────────────────── */
    {
      const g = K.group(0, 0, 0);
      const van = K.car({ color: 0xd8dbdd, type: "van", ry: Math.PI / 2 });
      g.add(van);
      const b = K.barrier(2.6, 0.9);
      b.position.set(2.2, 0, 1.2);
      b.rotation.y = 0.5;
      g.add(b);
      attach(root, targets, T("s-fire-lane", "消防通道占用", "fire_lane", [-18.4, 1.0, -5.2], [-16.4, -3.6], { conf: 0.93 }), g);
    }

    /* ── 电动车入楼（楼道口违停） ─────────────────────────────── */
    {
      const g = K.group(0, 0, 0);
      const e1 = K.ebike(0x33414d);
      e1.rotation.y = 1.3;
      e1.position.set(0.3, 0, 0.2);
      g.add(e1);
      const e2 = K.ebike(0x2d3b3a);
      e2.rotation.y = 1.6;
      e2.position.set(-0.5, 0, 0.55);
      g.add(e2);
      attach(root, targets, T("s-ebike-in", "电动车入楼检测", "ebike_indoor", [-12.6, 0.8, -8.2], [-12.6, -6.2], { conf: 0.95 }), g);
    }

    /* ── 广场地面类 ───────────────────────────────────────────── */
    {
      const g = tileDamage();
      attach(root, targets, T("s-tile", "地砖破损检测", "tile_broken", [0.6, 0.1, 1.8], [0.6, 3.6], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const p = K.puddle(0, 0, 3.6, 2.4, 0.2);
      p.position.y = 0.02;
      g.add(p);
      attach(root, targets, T("s-puddle", "地面积水检测", "puddle", [-5.4, 0.05, 0.4], [-5.4, 2.2], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const p = K.puddle(0, 0, 5.2, 3.0, -0.3);
      p.position.y = 0.02;
      g.add(p);
      const c = K.cone(0.6);
      c.position.set(1.9, 0, 0.9);
      g.add(c);
      attach(root, targets, T("s-road-water", "道路积水检测", "puddle", [-11.2, 0.05, 14.2], [-11.2, 12.2], { conf: 0.91 }), g);
    }
    {
      const g = leakDrum();
      attach(root, targets, T("s-leak", "液体泄漏检测", "liquid_leak", [-3.4, 0.5, 6.6], [-3.4, 8.4], { conf: 0.94 }), g);
    }
    {
      const g = ceilingLeak();
      attach(root, targets, T("s-roof-leak", "公共区域漏水检测", "ceiling_drip", [6.4, 2.2, 1.2], [6.4, 3.0], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const lamp = K.streetLamp({ h: 5.0, on: true });
      lamp.position.set(0, 0, 0);
      g.add(lamp);
      attach(root, targets, T("s-lamp", "路灯状态识别", "street_lamp", [-8.2, 5.0, 6.4], [-8.2, 4.2], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const m = K.manhole({ open: true });
      m.scale.setScalar(0.62);
      m.position.y = 0.02;
      g.add(m);
      attach(root, targets, T("s-manhole", "井盖状态识别", "manhole", [9.4, 0.1, 6.4], [9.4, 8.2], { conf: 0.92 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const b1 = K.barrier(2.4, 0.95);
      b1.position.set(-0.8, 0, 0);
      b1.rotation.y = 0.35;
      g.add(b1);
      const c1 = K.cone(0.66);
      c1.position.set(1.5, 0, 0.8);
      g.add(c1);
      const c2 = K.cone(0.6);
      c2.position.set(2.4, 0, -0.4);
      g.add(c2);
      g.add(K.cardboard(0.4, 0.6, 0.9));
      attach(root, targets, T("s-obstacle", "道路障碍物检测", "road_obstacle", [13.2, 0.8, 12.6], [13.2, 10.6], { conf: 0.91 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const c = K.crackDecal(3.2);
      g.add(c);
      attach(root, targets, T("s-road-crack", "道路破损识别", "road_crack", [0.4, 0.05, 17.4], [0.4, 15.2], { conf: 0.88 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const bin = K.trashBin({ h: 0.95, full: false });
      bin.position.set(-0.9, 0, 0.2);
      g.add(bin);
      for (let i = 0; i < 5; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xeef2f4 : 0xd9d2c2, roughness: 0.85, side: THREE.DoubleSide }));
        w.rotation.x = -Math.PI / 2 + 0.15 * (Math.random() - 0.5);
        w.rotation.z = Math.random() * 3;
        w.position.set(0.4 + Math.random() * 1.6, 0.03, -0.5 + Math.random() * 1.2);
        g.add(w);
      }
      attach(root, targets, T("s-litter", "公共区域垃圾识别", "public_litter", [-6.8, 0.5, 11.6], [-6.8, 9.6], { conf: 0.9 }), g);
    }
    {
      const g = crowdGroup(8, 1.35);
      attach(root, targets, T("s-crowd", "人员聚集检测", "crowd_density", [7.4, 1.0, 12.6], [7.4, 10.4], { conf: 0.93 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      for (let i = 0; i < 5; i++) {
        const s = i % 2 ? K.scooter({ color: i % 3 ? 0x2f6f92 : 0xb2574a }) : K.ebike(i % 2 ? 0x3a3f4a : 0x33414d);
        s.position.set(-1.4 + i * 0.7, 0, 0);
        s.rotation.y = Math.PI / 2 + (i - 2) * 0.12;
        g.add(s);
      }
      attach(root, targets, T("s-bike-park", "非机动车乱停放", "bicycle_misplaced", [-10.6, 0.8, 8.6], [-10.6, 6.6], { conf: 0.92 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const good = K.fence(3.4, 1.15);
      good.position.x = -1.9;
      g.add(good);
      for (let i = 0; i < 3; i++) {
        const seg = K.box(1.5, 1.05, 0.05, new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.7, metalness: 0.5 }), -0.4 + i * 0.55, 0.3 + i * 0.05, i * 0.12);
        seg.rotation.set(0.14 + i * 0.22, 0.28 * i, 1.15 + i * 0.1);
        seg.castShadow = true;
        g.add(seg);
      }
      attach(root, targets, T("s-fence", "围栏设施检测", "fence_broken", [16.2, 0.7, 2.6], [16.2, 4.6], { conf: 0.9 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const st = sickTree();
      st.position.set(0, 0, 0);
      g.add(st);
      attach(root, targets, T("s-tree", "绿化树木异常", "tree_health", [-14.6, 2.0, 9.6], [-14.6, 7.4], { conf: 0.89 }), g);
    }
    {
      const g = K.group(0, 0, 0);
      const bin = K.trashBin({ h: 0.9, full: true });
      bin.position.set(-1.1, 0, 0.2);
      g.add(bin);
      const fire = K.fireFlame({ size: 0.4, intensity: 1.0 });
      fire.position.set(0.3, 0.12, 0.2);
      g.add(fire);
      const smoke = K.smokePlume({ rate: 18, size: 0.46, color: 0x94999f, rise: 1.7, spread: 0.2 });
      smoke.position.set(0.3, 0.7, 0.2);
      g.add(smoke);
      attach(root, targets, T("s-smoke", "烟雾火焰检测", "smoke_fire", [5.8, 0.7, 5.2], [5.8, 7.0], { conf: 0.96 }), g);
    }

    /* ── 绿化（避开巡游带） ───────────────────────────────────── */
    const route = polyDist([
      [1.0, 7.2], [-11.6, -10.4], [-8.8, -10.4], [-5.4, -10.3], [-2.4, -10.2], [1.2, -10.2],
      [3.6, -10.3], [6.6, -8.6], [9.6, -10.0], [10.6, -9.4], [15.4, -8.6], [-15.2, -10.2],
      [17.8, -10.2], [15.0, -10.2], [-16.4, -3.6], [-12.6, -6.2], [0.6, 3.6], [-5.4, 2.2],
      [-11.2, 12.2], [-3.4, 8.4], [6.4, 3.0], [4.8, 7.4], [9.4, 8.2], [13.2, 10.6], [0.4, 15.2],
      [-6.8, 9.6], [3.2, 9.0], [-10.6, 6.6], [16.2, 4.6], [10.2, 11.2], [5.8, 7.0],
    ]);
    const blocked = [
      [-11.6, -12.2, 2.2], [-8.8, -12.2, 2.2], [-5.4, -12.2, 2.4], [-2.4, -12.1, 2.4], [1.2, -12.0, 2.4],
      [3.6, -12.1, 2.0], [6.6, -10.2, 2.0], [9.6, -12.1, 2.4], [12.6, -10.2, 2.4], [15.4, -10.4, 2.4],
      [-15.2, -12.1, 2.2], [17.8, -12.0, 2.2], [15.0, -12.0, 2.2], [-18.4, -5.2, 3.4], [-12.6, -8.2, 2.6],
      [0.6, 1.8, 1.8], [-5.4, 0.4, 2.4], [-11.2, 14.2, 3.0], [-3.4, 6.6, 2.0], [6.4, 1.2, 1.8],
      [4.8, 9.4, 1.4], [9.4, 6.4, 1.6], [13.2, 12.6, 2.4], [0.4, 17.4, 2.6], [-6.8, 11.6, 2.4],
      [7.4, 12.6, 3.0], [-10.6, 8.6, 3.0], [16.2, 2.6, 2.2], [10.2, 13.4, 1.8], [5.8, 5.2, 1.8],
    ];
    const ok = (x, z, r) => {
      if (Math.abs(x) < 21 && z < -13.6) return false;
      if (route(x, z) < r + 1.5) return false;
      /* 别挡住默认机位到出生点这条视线 */
      if (segDist(x, z, 11.5, 17.5, 1.0, 7.2) < r + 2.2) return false;
      if (Math.hypot(x - 11.5, z - 17.5) < 4.2) return false;
      for (const [bx, bz, br] of blocked) if (Math.hypot(x - bx, z - bz) < br + r) return false;
      return true;
    };
    const trees = [];
    for (let i = 0; i < 220 && trees.length < 16; i++) {
      const x = -30 + R() * 60;
      const z = -6 + R() * 34;
      const r = 1.1 + R() * 0.5;
      if (!ok(x, z, r)) continue;
      if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5.4)) continue;
      trees.push([x, z]);
      const t = K.tree({ h: 5.4 + R() * 2.2, r: 0.17 + R() * 0.05, kind: R() > 0.55 ? "conifer" : "broad" });
      t.position.set(x, 0, z);
      root.add(t);
    }
    for (let i = 0; i < 60; i++) {
      const x = -26 + R() * 52;
      const z = -6 + R() * 30;
      if (!ok(x, z, 0.6)) continue;
      const b = K.bush(0.3 + R() * 0.26, R() > 0.5 ? K.M.leaf : K.M.leafDeep);
      b.position.set(x, 0, z);
      root.add(b);
    }
    root.add(K.motes({ n: 260, range: 34, height: 7, color: 0xfff6dd, size: 0.04 }));

    return { root, targets, spawn: this.spawn };
  },
};
