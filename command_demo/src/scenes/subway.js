import * as THREE from "three";
import * as K from "../core/kit.js";
import { tileTex, concreteTex, tiled, signTex, metalTex, stripeTex } from "../core/tex.js";
import { T, attach, polyDist } from "./helper.js";

/* ══════════════════════════════════════════════════════════════════════════
   场景四 · 地铁站日常巡检（站厅 / 设备间 / 站台）
   ══════════════════════════════════════════════════════════════════════════ */

const WALLTILE = K.surf(tiled(tileTex("#cdd3d8", "#a5adb4", 4), 6, 3), {
  bump: 0.9,
  rough: 0.44,
  metal: 0.06,
  env: 0.5,
  roughMap: [0.35, 0.85],
});const PAINT = new THREE.MeshStandardMaterial({ color: 0x8f979e, roughness: 0.9 });
const DARKIN = new THREE.MeshStandardMaterial({ color: 0x0d1116, roughness: 1 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0x929aa2, roughness: 0.32, metalness: 0.85 });
const YELLOW = new THREE.MeshStandardMaterial({ color: 0xe8bf3a, roughness: 0.7 });

/* 立柱 */
function column() {
  const g = K.group(0, 0, 0);
  g.add(K.box(0.9, 0.1, 0.9, STEEL, 0, 0.05, 0));
  g.add(K.box(0.62, 4.3, 0.62, WALLTILE, 0, 2.2, 0));
  g.add(K.box(0.74, 0.1, 0.74, STEEL, 0, 4.3, 0));
  return g;
}

/* 顶部横梁 + 灯带 */
function beam(len = 36) {
  const g = K.group(0, 0, 0);
  g.add(K.box(len, 0.34, 0.5, new THREE.MeshStandardMaterial({ color: 0x6a7178, roughness: 0.85 }), 0, 4.5, 0));
  const lm = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, emissive: 0xfff6e0, emissiveIntensity: 1.15, roughness: 0.6 });
  g.add(K.box(len * 0.92, 0.08, 0.18, lm, 0, 4.28, 0));
  return g;
}

/* 屏蔽门（站台边缘） */
function screenDoors(n = 7) {
  const g = K.group(0, 0, 0);
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9c8d8, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.34 });
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 3.4;
    g.add(K.box(0.16, 2.6, 0.16, STEEL, x - 1.6, 1.3, 0));
    g.add(K.box(0.16, 2.6, 0.16, STEEL, x + 1.6, 1.3, 0));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.5), glass);
    panel.position.set(x, 1.35, 0);
    panel.rotation.y = 0;
    g.add(panel);
    g.add(K.box(3.2, 0.16, 0.2, STEEL, x, 2.68, 0));
    g.add(K.box(0.04, 2.5, 0.06, STEEL, x, 1.35, 0.02));
  }
  return g;
}

/* 站台边缘：黄色触感带 + 轨行区 */
function platformEdge(len = 30) {
  const g = K.group(0, 0, 0);
  g.add(K.box(len, 0.02, 0.55, YELLOW, 0, 0.02, -0.9));
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(len, 4.2), new THREE.MeshStandardMaterial({ map: tiled(concreteTex("#3b3f44", "#2a2d31"), 14, 2), roughness: 1 }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(0, -0.55, 2.2);
  g.add(pit);
  g.add(K.box(len, 1.1, 0.35, DARKIN, 0, -0.6, 0.1));
  for (const z of [1.4, 3.2]) {
    g.add(K.box(len, 0.12, 0.12, STEEL, 0, -0.45, z));
    g.add(K.box(len, 0.24, 0.5, new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 1 }), 0, -0.62, z));
  }
  return g;
}

/* 吊挂导向标识 */
function hangingSign(text, { w = 3.0, h = 0.62, bg = "#123a63", fg = "#ffffff", arrow = "→" } = {}) {
  const g = K.group(0, 0, 0);
  const tex = signTex(text, { bg, fg, w: 640, h: 160, font: 'bold 74px "Microsoft YaHei",sans-serif', sub: arrow });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0x0b2036, emissiveIntensity: 0.5, emissiveMap: tex, side: THREE.DoubleSide });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  p.position.set(0, 3.5, 0);
  g.add(p);
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
    g.add(K.box(0.04, 0.7, 0.04, STEEL, x, 3.9, 0));
  }
  return g;
}

/* 墙上广告灯箱 */
function adBoard({ color = 0x2f6f92 } = {}) {
  const g = K.group(0, 0, 0);
  const tex = signTex("安全文明出行", { bg: "#" + new THREE.Color(color).getHexString(), fg: "#f2f7fa", w: 512, h: 256, font: 'bold 62px "Microsoft YaHei",sans-serif', sub: "文明乘车 · 安全第一" });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x223344, emissiveIntensity: 0.28, emissiveMap: tex });
  g.add(K.box(2.2, 1.3, 0.08, STEEL, 0, 2.1, 0));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.15), m);
  p.position.set(0, 2.1, 0.05);
  g.add(p);
  return g;
}

/* 数显仪表（配电箱） */
function digitalPanel({ dead = false } = {}) {
  const g = K.group(0, 0, 0);
  g.add(K.box(0.9, 0.62, 0.14, new THREE.MeshStandardMaterial({ color: 0x4a5158, roughness: 0.6, metalness: 0.5 }), 0, 1.5, 0));
  const txt = dead ? "--.-" : "26.4";
  const tex = signTex(txt, { bg: "#0a1a12", fg: dead ? "#3c5a44" : "#6ef2a0", w: 256, h: 128, font: 'bold 84px "Consolas",monospace', border: "#0f2a1c" });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: dead ? 0x000000 : 0x2fae67, emissiveIntensity: dead ? 0 : 0.9, emissiveMap: tex });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), m);
  p.position.set(-0.14, 1.58, 0.08);
  g.add(p);
  const tex2 = signTex(dead ? "0.0" : "386", { bg: "#0a1a12", fg: dead ? "#3c5a44" : "#6ef2a0", w: 256, h: 128, font: 'bold 84px "Consolas",monospace' });
  const m2 = new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.4, emissive: dead ? 0x000000 : 0x2fae67, emissiveIntensity: dead ? 0 : 0.9, emissiveMap: tex2 });
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.25), m2);
  p2.position.set(0.28, 1.58, 0.08);
  g.add(p2);
  return g;
}

/* 锈蚀管路 */
function rustyPipes() {
  const g = K.group(0, 0, 0);
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.95, map: tiled(metalTex("#7b5433"), 3, 1) });
  for (let i = 0; i < 3; i++) {
    g.add(K.cyl(0.09, 6.0, i === 1 ? rust : K.M.metal, -1.6 + i * 0.34, 2.4 + i * 0.26, 0, 12).rotateZ(Math.PI / 2));
  }
  for (const x of [-2.4, -0.6, 1.6]) {
    g.add(K.box(0.14, 0.14, 0.9, STEEL, x, 2.4, -0.35));
  }
  return g;
}

/* 消防栓箱（可被遮挡） */
function hydrantBox({ blocked = true } = {}) {
  const g = K.group(0, 0, 0);
  g.add(K.box(0.9, 1.2, 0.3, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }), 0, 1.3, 0.15));
  g.add(K.box(0.78, 1.0, 0.04, new THREE.MeshStandardMaterial({ color: 0xa9c8d8, roughness: 0.15, transparent: true, opacity: 0.4 }), 0, 1.3, 0.31));
  const t = signTex("消火栓", { bg: "#b3261e", fg: "#fff", w: 256, h: 128, font: 'bold 68px "Microsoft YaHei",sans-serif' });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.26), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
  p.position.set(0, 2.05, 0.32);
  g.add(p);
  if (blocked) {
    const cart = K.cardboard(0.2, 0.2, 0.9);
    cart.position.set(0.1, 0.1, 0.75);
    g.add(cart);
    const bag = K.luggage({ w: 0.5, h: 0.5, d: 0.36, color: 0x54657a });
    bag.position.set(-0.3, 0, 0.7);
    bag.rotation.y = 0.4;
    g.add(bag);
  }
  return g;
}

/* 轮椅 */
function wheelchair() {
  const g = K.group(0, 0, 0);
  const frame = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.5, metalness: 0.5 });
  const wheel = new THREE.TorusGeometry(0.28, 0.045, 8, 20);
  for (const x of [-0.24, 0.24]) {
    const w = new THREE.Mesh(wheel, K.M.rubber);
    w.position.set(x, 0.29, -0.05);
    g.add(w);
  }
  g.add(K.box(0.5, 0.07, 0.5, frame, 0, 0.5, 0));
  g.add(K.box(0.5, 0.5, 0.06, frame, 0, 0.78, -0.24));
  g.add(K.box(0.06, 0.42, 0.06, frame, -0.24, 0.7, 0.2));
  g.add(K.box(0.06, 0.42, 0.06, frame, 0.24, 0.7, 0.2));
  for (const x of [-0.22, 0.22]) for (const z of [0.2, -0.24]) g.add(K.cyl(0.03, 0.5, frame, x, 0.25, z, 8));
  return g;
}

/* 设备柜（柜门未关严） */
function cabinet({ open = true } = {}) {
  const g = K.group(0, 0, 0);
  const body = new THREE.MeshStandardMaterial({ color: 0x59636c, roughness: 0.55, metalness: 0.45 });
  g.add(K.box(1.5, 2.0, 0.7, body, 0, 1.0, 0));
  g.add(K.box(1.36, 1.86, 0.02, DARKIN, 0, 1.0, 0.36));
  if (open) {
    const leaf = K.box(0.7, 1.86, 0.05, body, 0, 1.0, 0);
    leaf.position.set(0.35, 1.0, 0.62);
    leaf.rotation.y = -0.85;
    g.add(leaf);
    g.add(K.box(0.06, 0.24, 0.06, STEEL, 0.6, 1.05, 0.72));
  } else {
    g.add(K.box(0.72, 1.86, 0.05, body, -0.36, 1.0, 0.37));
    g.add(K.box(0.72, 1.86, 0.05, body, 0.36, 1.0, 0.37));
  }
  return g;
}

/* 台阶（边角破损） */
function stairs({ broken = 2, n = 4 } = {}) {
  const g = K.group(0, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tiled(concreteTex("#c6c2b8", "#8f8b82"), 1, 1), roughness: 0.9 });
  for (let i = 0; i < n; i++) {
    const s = K.box(3.6, 0.17, 0.34, mat, 0, 0.085 + i * 0.17, -i * 0.34);
    if (i === broken) {
      s.scale.set(2.6, 0.7, 1);
      s.material = new THREE.MeshStandardMaterial({ color: 0x868b90, roughness: 1 });
    }
    g.add(s);
  }
  g.add(K.box(3.8, 0.1, 0.2, YELLOW, 0, 0.02, 0.2));
  return g;
}

/* 躺倒的人 */
function fallenPerson() {
  const p = K.person({ shirt: 0x3f5d7d });
  p.rotation.x = -Math.PI / 2;
  p.position.set(0, 0.22, 0);
  const g = K.group(0, 0, 0);
  g.add(p);
  return g;
}

/* 攀爬护栏 */
function climbingPerson() {
  const g = K.group(0, 0, 0);
  const rail = K.fence(3.2, 1.1);
  rail.position.set(0, 0, 0);
  g.add(rail);
  const p = K.person({ shirt: 0xb2574a });
  p.position.set(0.4, 0.55, 0.1);
  p.rotation.z = 0.35;
  p.rotation.x = -0.2;
  g.add(p);
  return g;
}

/* 冲突的两人 */
function conflictPair() {
  const g = K.group(0, 0, 0);
  const a = K.person({ shirt: 0xcf5b47 });
  a.position.set(-0.42, 0, 0);
  a.rotation.y = Math.PI / 2;
  a.rotation.z = 0.08;
  g.add(a);
  const b = K.person({ shirt: 0x3b62a0 });
  b.position.set(0.42, 0, 0);
  b.rotation.y = -Math.PI / 2;
  b.rotation.z = -0.1;
  g.add(b);
  return g;
}

/* 一排候车座椅 */
function benchRow(n = 3) {
  const g = K.group(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const s = K.seat();
    s.position.set((i - (n - 1) / 2) * 0.62, 0, 0);
    g.add(s);
  }
  g.add(K.box(n * 0.62, 0.06, 0.4, STEEL, 0, 0.42, 0));
  return g;
}

export default {
  id: "subway",
  name: "地铁",
  title: "地铁站安全与设备巡检",
  icon: '<svg viewBox="0 0 24 24"><path d="M6 3h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3l1.5 2v1h-2l-2-3H9.5l-2 3h-2v-1L7 17a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm1 4v5h10V7H7Zm1 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>',
  env: {
    env: "indoor",
    sky: 0x1b232c,
    dome: [0x33424e, 0x5d707d],
    fogNear: 40,
    fogFar: 120,
    sunColor: 0xfff4e2,
    sunInt: 1.35,
    hemiSky: 0xdfe9f2,
    hemiGround: 0x3a3d42,
    hemiInt: 0.72,
    sunPos: [-14, 26, 20],
    exposure: 0.9,
  },
  camera: { pos: [-14.5, 4.0, 20.5], target: [3.0, 1.3, -4] },
  spawn: { x: -5.5, z: 7.4, heading: Math.PI },

  build() {
    const root = new THREE.Group();
    const targets = [];
    const R = K.rng(3131);

    root.add(K.skyDome(this.env.dome[0], this.env.dome[1], 180));

    /* ── 地面 ─────────────────────────────────────────────────── */
    K.ground(root, K.M.darkMetal, 120, 8);
    const floorTex = tiled(tileTex("#9ba2a9", "#7b828a", 4), 11, 16);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(37, 60),
      K.surf(floorTex, { bump: 0.8, rough: 0.34, metal: 0.08, env: 0.85, roughMap: [0.2, 0.62] })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.01, 2);
    floor.receiveShadow = true;
    root.add(floor);
    /* 地面反光条 */
    for (const x of [-11.5, 0, 11.5]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 58), new THREE.MeshStandardMaterial({ color: 0xb9c2c8, roughness: 0.5 }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.016, 2);
      root.add(r);
    }

    /* 顶棚：法线朝下，俯视时自动隐藏（只挡"室外的黑"） */
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(37, 60),
      new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.95 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, 4.72, 2);
    root.add(ceil);

    /* ── 侧墙 ─────────────────────────────────────────────────── */
    const wl = K.wallRun(60, 4.6, WALLTILE, 0.3);
    wl.rotation.y = Math.PI / 2;
    wl.position.set(-18.4, 0, 2);
    root.add(wl);
    const wr = wl.clone();
    wr.position.set(18.4, 0, 2);
    root.add(wr);
    /* 背墙（售票机一侧） */
    const wb = K.wallRun(37, 4.6, WALLTILE, 0.3);
    wb.position.set(0, 0, -26.6);
    root.add(wb);

    /* ── 顶部横梁 + 灯带 ─────────────────────────────────────── */
    for (let z = -22; z <= 24; z += 5.6) {
      const b = beam(36.4);
      b.position.set(0, 0, z);
      root.add(b);
    }
    /* 立柱 */
    for (const x of [-9.2, 9.2]) {
      for (let z = -20; z <= 22; z += 8) {
        const c = column();
        c.position.set(x, 0, z);
        root.add(c);
      }
    }

    /* ── 站台边缘 / 屏蔽门 / 轨行区 ──────────────────────────── */
    const edge = platformEdge(34);
    edge.position.set(0, 0, 25.4);
    root.add(edge);
    const doors = screenDoors(9);
    doors.position.set(0, 0, 25.0);
    root.add(doors);
    /* 轨行区背景墙 + 隧道口 */
    const tunnel = new THREE.Mesh(new THREE.PlaneGeometry(34, 4.4), new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 1 }));
    tunnel.position.set(0, 1.4, 31.5);
    root.add(tunnel);
    for (const x of [-13, 13]) {
      const arch = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 1 }));
      arch.position.set(x, 1.9, 31.4);
      root.add(arch);
    }

    /* ── 设备间隔断（右侧） ──────────────────────────────────── */
    const part = K.wallRun(13, 3.6, PAINT, 0.26);
    part.rotation.y = Math.PI / 2;
    part.position.set(11.6, 0, -19.4);
    root.add(part);
    const partDoor = K.fireDoor({ open: true, w: 1.2, h: 2.2 });
    partDoor.rotation.y = -Math.PI / 2;
    partDoor.position.set(11.5, 0, -13.4);
    root.add(partDoor);

    /* ── 售票机 / 闸机 / 客服 ────────────────────────────────── */
    for (let i = 0; i < 3; i++) {
      const tm = K.ticketMachine();
      tm.position.set(4.4 + i * 1.5, 0, -24.6);
      root.add(tm);
    }
    const gateX = [-5.4, -2.7, 0, 2.7, 5.4];
    for (const x of gateX) {
      const t = K.turnstile();
      t.position.set(x, 0, -17.2);
      root.add(t);
    }
    const board = hangingSign("进站 乘车 →", { w: 3.4, h: 0.6, bg: "#123a63" });
    board.position.set(0, 0, -14.6);
    root.add(board);
    const board2 = hangingSign("← 出口  站厅", { w: 3.4, h: 0.6, bg: "#155a3a", arrow: "" });
    board2.position.set(0, 0, 8.5);
    root.add(board2);

    /* ── 墙面广告 ─────────────────────────────────────────────── */
    for (const [x, z, ry] of [[-18.2, -12, Math.PI / 2], [-18.2, 4, Math.PI / 2], [18.2, 6, -Math.PI / 2]]) {
      const ad = adBoard({ color: 0x2f6f92 });
      ad.position.set(x, 0, z);
      ad.rotation.y = ry;
      root.add(ad);
    }

    /* ══ 点位 ═══════════════════════════════════════════════════ */

    /* 0 行李箱杂物妨碍通行 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.luggage({ w: 0.55, h: 0.72, d: 0.34, color: 0x2b3a4a }));
      const b = K.cardboard(0.4, 0.3, 0.9);
      g.add(b);
      const b2 = K.luggage({ w: 0.4, h: 0.5, d: 0.3, color: 0x6b4f3a });
      b2.position.set(-0.5, 0, 0.2);
      b2.rotation.y = 0.5;
      g.add(b2);
      attach(root, targets, T("m-luggage", "行李箱、纸箱、杂物等妨碍通行物品", "blocked_path", [-8.6, 0.8, -20.8], [-8.6, -18.8], { conf: 0.93 }), g);
    }
    /* 1 瓷砖积水、湿滑 */
    {
      const g = K.group(0, 0, 0);
      const p = K.puddle(0, 0, 4.2, 2.8, 0.15);
      p.position.y = 0.02;
      g.add(p);
      const c = K.cone(0.62);
      c.position.set(1.9, 0, 1.1);
      g.add(c);
      attach(root, targets, T("m-puddle", "瓷砖积水、漏水区域、湿滑区域", "puddle", [0.4, 0.05, -8.0], [0.4, -5.9], { conf: 0.92 }), g);
    }
    /* 2 压力表 / 温度表 / 流量表 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.box(2.2, 0.9, 0.06, new THREE.MeshStandardMaterial({ color: 0x6f757c, roughness: 0.6, metalness: 0.4 }), 0, 0, 0.05));
      for (let i = 0; i < 3; i++) {
        const ga = K.gauge(i === 0 ? "pressure" : i === 1 ? "temp" : "flow", 0.18);
        ga.position.set(-0.7 + i * 0.7, 0, 0.12);
        g.add(ga);
      }
      attach(root, targets, T("m-gauge", "压力表、指针式温度表、流量表", "gauge", [15.6, 1.9, -22.2], [15.6, -20.2], { conf: 0.9 }, [0]), g);
    }
    /* 3 地砖裂缝 / 缺角 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.crackDecal(2.0));
      const chip = K.box(0.36, 0.04, 0.36, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 }), 0.5, 0.045, 0.3);
      chip.rotation.y = 0.7;
      g.add(chip);
      attach(root, targets, T("m-tile", "地砖裂缝、缺角、缺失", "tile_broken", [-5.0, 0.1, -2.0], [-5.0, -0.2], { conf: 0.89 }), g);
    }
    /* 4 墙面水渍 / 顶棚渗漏 */
    {
      const g = K.group(0, 0, 0);
      const stain = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), new THREE.MeshStandardMaterial({ color: 0x9a8f78, roughness: 1, transparent: true, opacity: 0.55 }));
      stain.position.set(0, 2.1, 0.05);
      g.add(stain);
      g.add(K.drip({ height: 3.6 }).translateZ(0.15));
      attach(root, targets, T("m-seep", "墙面水渍、顶棚渗漏痕迹", "wall_seep", [-18.0, 2.1, -2.0], [-18.0, -2.0], { conf: 0.88 }, [0]), g);
    }
    /* 5 红黄绿指示灯 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.box(0.5, 1.0, 0.16, new THREE.MeshStandardMaterial({ color: 0x22272c, roughness: 0.7 }), 0, 0, 0));
      const cols = [0xe03e3e, 0xf2c230, 0x35c46a];
      cols.forEach((c, i) => {
        const on = i !== 1;
        g.add(K.ball(0.1, new THREE.MeshStandardMaterial({ color: on ? c : 0x2a2f33, emissive: on ? c : 0x000000, emissiveIntensity: on ? 1.3 : 0, roughness: 0.5 }), 0, 0.32 - i * 0.32, 0.09));
      });
      attach(root, targets, T("m-indicator", "红黄绿指示灯亮灭与颜色", "indicator", [11.4, 2.2, -8.0], [9.6, -8.0], { conf: 0.9 }, [0]), g);
    }
    /* 6 拨动开关 / 旋钮 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.box(1.2, 0.8, 0.14, new THREE.MeshStandardMaterial({ color: 0x5b636d, roughness: 0.6, metalness: 0.4 }), 0, 0, 0));
      g.add(K.switchPanel({ cols: 3, rows: 2 }).translateZ(0.1));
      g.add(K.cyl(0.06, 0.1, new THREE.MeshStandardMaterial({ color: 0xd94a3d, roughness: 0.5 }), 0.44, -0.28, 0.14, 10).rotateX(Math.PI / 2));
      attach(root, targets, T("m-switch", "拨动开关、旋钮、手柄位置", "switch_panel", [17.6, 1.5, -6.0], [15.8, -6.0], { conf: 0.89 }, [0]), g);
    }
    /* 7 灭火器 */
    {
      const g = K.group(0, 0, 0);
      const box = K.fireBox();
      box.position.set(0, 0, 0);
      g.add(box);
      const e = K.extinguisher();
      e.position.set(-0.62, 0, 0.1);
      g.add(e);
      attach(root, targets, T("m-ext", "灭火器是否在位、倾倒、外观破损", "extinguisher", [-17.4, 0.9, -9.4], [-17.2, -9.4], { conf: 0.92 }, [0]), g);
    }
    /* 8 垃圾桶满溢 */
    {
      const g = K.group(0, 0, 0);
      const bin = K.trashBin({ h: 1.0, full: true });
      bin.position.set(0, 0, 0);
      g.add(bin);
      const bin2 = K.trashBin({ h: 0.95, full: false });
      bin2.position.set(0.8, 0, 0.1);
      g.add(bin2);
      attach(root, targets, T("m-trash", "垃圾桶满溢、周边垃圾散落", "trash_full", [-10.5, 0.7, -6.5], [-10.5, -4.5], { conf: 0.91 }), g);
    }
    /* 9 数显仪表 */
    {
      const g = digitalPanel({ dead: false });
      attach(root, targets, T("m-digital", "数显温度、压力、电流、电压表", "meter", [15.8, 1.5, -19.0], [15.8, -17.0], { conf: 0.9 }, [0]), g);
    }
    /* 10 遗留物品 */
    {
      const g = K.group(0, 0, 0);
      const seat = benchRow(2);
      seat.position.set(0, 0, 0.3);
      g.add(seat);
      const bag = K.luggage({ w: 0.46, h: 0.34, d: 0.26, color: 0x8a5a3a });
      bag.position.set(-0.2, 0.44, 0.2);
      bag.rotation.y = 0.3;
      g.add(bag);
      for (let i = 0; i < 3; i++) {
        const bottle = K.cyl(0.04, 0.22, new THREE.MeshStandardMaterial({ color: 0xd9e6ee, roughness: 0.2, transparent: true, opacity: 0.7 }), 0.3 + i * 0.16, 0.11, 0.5);
        g.add(bottle);
      }
      attach(root, targets, T("m-left", "箱包、塑料瓶及其他遗留物品", "left_item", [9.0, 0.7, 2.0], [9.0, 4.0], { conf: 0.94 }), g);
    }
    /* 11 座椅 / 护栏 / 墙面破损 */
    {
      const g = K.group(0, 0, 0);
      const seat = benchRow(3);
      g.add(seat);
      const broken = K.box(0.6, 0.12, 0.44, new THREE.MeshStandardMaterial({ color: 0x7c848b, roughness: 0.9 }), 0.62, 0.18, 0.1);
      broken.rotation.z = 0.9;
      broken.rotation.x = 0.4;
      g.add(broken);
      attach(root, targets, T("m-seat", "座椅、护栏、墙面可见破损", "seat_damage", [7.6, 0.6, -3.0], [7.6, -1.2], { conf: 0.88 }), g);
    }
    /* 12 阀门渗漏 / 管道滴水 */
    {
      const g = K.group(0, 0, 0);
      const v = K.valve();
      v.position.set(0, 1.6, 0);
      g.add(v);
      g.add(K.pipeRun(2.6, 0.1, K.M.metal).translateY(1.6));
      const p = K.puddle(0, 0, 1.2, 0.9, 0);
      p.position.y = 0.02;
      g.add(p);
      g.add(K.drip({ height: 1.5 }).translateZ(0.05));
      attach(root, targets, T("m-valve", "阀门渗漏、管道滴水、可见油液泄漏", "valve_leak", [15.8, 1.5, -16.4], [15.8, -14.4], { conf: 0.93 }), g);
    }
    /* 13 设备管路锈蚀 */
    {
      const g = rustyPipes();
      attach(root, targets, T("m-rust", "设备、管路表面锈蚀与腐蚀斑", "pipe_rust", [15.4, 2.3, -14.4], [15.4, -12.4], { conf: 0.9 }), g);
    }
    /* 14 杂物货物妨碍通行 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.cardboard(0, 0, 1.1));
      g.add(K.cardboard(0.35, 0.2, 0.95).translateY(0.44));
      const b = K.cardboard(-0.3, -0.15, 0.85);
      b.position.y = 0.84;
      g.add(b);
      const bag = K.luggage({ w: 0.5, h: 0.6, d: 0.34, color: 0x3f5d7d });
      bag.position.set(0.95, 0, 0.15);
      g.add(bag);
      attach(root, targets, T("m-block", "杂物货物妨碍通行", "blocked_path", [11.6, 0.8, 16.4], [11.6, 14.4], { conf: 0.92 }), g);
    }
    /* 15 人员密度 */
    {
      const g = K.group(0, 0, 0);
      const shirts = [0x2f4a6d, 0xb2574a, 0xd8d3c6, 0x3f6b52, 0x8a6fa8, 0xe0a33a, 0x445a6e];
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const p = K.person({ shirt: shirts[i % shirts.length], walk: i % 4 === 0 });
        p.position.set(Math.cos(a) * (0.7 + R() * 1.5), 0, Math.sin(a) * (0.7 + R() * 1.5));
        p.rotation.y = R() * 6.28;
        g.add(p);
      }
      attach(root, targets, T("m-density", "人员密度检测", "crowd_density", [2.4, 1.0, 6.2], [2.4, 9.6], { conf: 0.93 }), g);
    }
    /* 16 可见烟雾 */
    {
      const g = K.group(0, 0, 0);
      const smoke = K.smokePlume({ rate: 26, size: 0.66, color: 0xb8bfc6, rise: 2.0, spread: 0.26 });
      smoke.position.set(0, 0.4, 0);
      g.add(smoke);
      const bin = K.trashBin({ h: 0.9, full: true });
      bin.position.set(-0.6, 0, 0.3);
      g.add(bin);
      attach(root, targets, T("m-smoke", "可见烟雾、早期烟雾", "smoke_plume", [-8.5, 0.6, 2.5], [-8.5, 4.5], { conf: 0.95 }), g);
    }
    /* 17 明火 */
    {
      const g = K.group(0, 0, 0);
      const f = K.fireFlame({ size: 0.5, intensity: 1.15 });
      f.position.set(0, 0.1, 0);
      g.add(f);
      const smoke = K.smokePlume({ rate: 14, size: 0.5, color: 0x9aa0a6, rise: 1.9, spread: 0.16 });
      smoke.position.set(0, 0.8, 0);
      g.add(smoke);
      attach(root, targets, T("m-fire", "明火、异常可见火苗", "open_fire", [-5.0, 0.6, 5.0], [-5.0, 7.0], { conf: 0.96 }), g);
    }
    /* 18 柜门异常 */
    {
      const g = cabinet({ open: true });
      attach(root, targets, T("m-cabinet", "柜门异常开启或未关严", "cabinet_door", [13.6, 1.0, -23.4], [13.6, -21.2], { conf: 0.9 }), g);
    }
    /* 19 门边异物 */
    {
      const g = K.group(0, 0, 0);
      const door = K.fireDoor({ open: false, w: 1.5, h: 2.2 });
      door.position.set(0, 0, 0);
      g.add(door);
      const junk = K.cardboard(0.55, 0.25, 0.7);
      g.add(junk);
      attach(root, targets, T("m-door-object", "门边或缝隙可见异物", "glass_crack", [-6.0, 1.2, -23.2], [-6.0, -21.2], { conf: 0.89 }), g);
    }
    /* 20 常闭防火门未关闭 */
    {
      const g = K.group(0, 0, 0);
      const door = K.fireDoor({ open: true, w: 1.6, h: 2.3 });
      g.add(door);
      const wedge = K.box(0.3, 0.1, 0.2, new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.9 }), 0.5, 0.05, 0.5);
      g.add(wedge);
      attach(root, targets, T("m-fire-door", "常闭式防火门未关闭、门前堆物", "fire_door", [-13.2, 1.3, -18.6], [-13.2, -16.6], { conf: 0.93 }), g);
    }
    /* 21 疏散指示灯不亮 */
    {
      const g = K.group(0, 0, 0);
      const txt = signTex("安全出口", { bg: "#3a3f42", fg: "#8b9196", w: 512, h: 200, font: 'bold 92px "Microsoft YaHei",sans-serif' });
      const m = new THREE.MeshStandardMaterial({ map: txt, roughness: 0.8, emissive: 0x000000 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.38), m);
      p.position.set(0, 0, 0.05);
      g.add(p);
      g.add(K.box(1.1, 0.46, 0.06, new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.9 }), 0, 0, 0));
      attach(root, targets, T("m-evac", "疏散指示灯不亮、标识遮挡", "evacuation_sign", [-14.6, 2.6, -11.0], [-14.6, -11.0], { conf: 0.9 }, [0]), g);
    }
    /* 22 杂物 / 轮椅阻挡 */
    {
      const g = K.group(0, 0, 0);
      g.add(wheelchair());
      const cart = K.cardboard(0.9, 0.3, 0.9);
      g.add(cart);
      attach(root, targets, T("m-wheelchair", "杂物、轮椅或行李长期阻挡", "blocked_path", [-11.0, 0.7, -14.4], [-11.0, -12.4], { conf: 0.91 }), g);
    }
    /* 23 售票机 */
    {
      const g = K.group(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const tm = K.ticketMachine();
        tm.position.set(-1.5 + i * 1.5, 0, 0);
        g.add(tm);
      }
      attach(root, targets, T("m-ticket", "售票机识别", "ticket_machine", [6.0, 1.2, -24.4], [6.0, -22.2], { conf: 0.9 }), g);
    }
    /* 24 边角破损 / 踏步缺陷 */
    {
      const g = stairs({ broken: 2 });
      attach(root, targets, T("m-stair", "边角破损、踏步缺陷", "stair_damage", [-15.2, 0.5, 9.2], [-13.2, 9.2], { conf: 0.88 }), g);
    }
    /* 25 门扇损坏 / 玻璃破裂 */
    {
      const g = K.group(0, 0, 0);
      const frame = new THREE.MeshStandardMaterial({ color: 0x8f979e, roughness: 0.35, metalness: 0.7 });
      g.add(K.box(0.1, 2.4, 0.12, frame, -1.1, 1.2, 0));
      g.add(K.box(0.1, 2.4, 0.12, frame, 1.1, 1.2, 0));
      g.add(K.box(2.3, 0.1, 0.12, frame, 0, 2.4, 0));
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(new THREE.PlaneGeometry(0.28 + R() * 0.4, 0.2 + R() * 0.5), new THREE.MeshStandardMaterial({ color: 0xa9c8d8, roughness: 0.15, transparent: true, opacity: 0.42 }));
        shard.position.set(-0.9 + R() * 1.8, 0.4 + R() * 1.7, 0.02);
        shard.rotation.z = R() * 1.4 - 0.7;
        g.add(shard);
      }
      attach(root, targets, T("m-glass", "门扇损坏、玻璃破裂", "glass_crack", [9.0, 1.2, -19.6], [9.0, -17.6], { conf: 0.92 }, [0]), g);
    }
    /* 26 天花板滴水 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.drip({ height: 4.2 }));
      const wet = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshStandardMaterial({ color: 0x3f4a52, roughness: 0.4, transparent: true, opacity: 0.75 }));
      wet.rotation.x = -Math.PI / 2;
      wet.position.y = 0.02;
      g.add(wet);
      attach(root, targets, T("m-drip", "天花板滴水、管线渗漏", "ceiling_drip", [5.5, 2.0, -6.0], [5.5, -6.0], { conf: 0.9 }, [0]), g);
    }
    /* 27 出口导向标识缺失 */
    {
      const g = K.group(0, 0, 0);
      g.add(K.box(1.4, 0.5, 0.06, new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.9 }), 0, 0, 0));
      const bracket = K.box(1.3, 0.04, 0.04, STEEL, 0, 0.28, 0.02);
      bracket.rotation.z = 0.5;
      g.add(bracket);
      attach(root, targets, T("m-sign-missing", "出口导向标识缺失、遮挡", "evacuation_sign", [-14.6, 2.6, -6.0], [-14.6, -6.0], { conf: 0.87 }, [0]), g);
    }
    /* 28 门体开闭异常 */
    {
      const g = K.group(0, 0, 0);
      const door = K.fireDoor({ open: true, w: 1.4, h: 2.2 });
      door.rotation.y = -1.1;
      g.add(door);
      g.add(K.box(1.6, 2.3, 0.2, DARKIN, 0, 1.15, -0.05));
      attach(root, targets, T("m-door-jam", "门体开闭、疑似异常未闭合", "door_state", [16.2, 1.3, -11.6], [16.2, -11.6], { conf: 0.89 }, [0]), g);
    }
    /* 29 消防栓箱遮挡 */
    {
      const g = hydrantBox({ blocked: true });
      attach(root, targets, T("m-hydrant", "消防栓箱遮挡、箱门异常", "cabinet_door", [11.2, 1.3, -10.4], [9.4, -10.4], { conf: 0.92 }, [0]), g);
    }
    /* 30 跌倒 / 长时间卧倒 */
    {
      const g = K.group(0, 0, 0);
      g.add(fallenPerson());
      attach(root, targets, T("m-fall", "跌倒、长时间卧倒", "fall_detect", [-4.0, 0.4, 16.4], [-4.0, 14.4], { conf: 0.95 }), g);
    }
    /* 31 攀爬护栏 */
    {
      const g = climbingPerson();
      attach(root, targets, T("m-climb", "攀爬护栏、翻越围挡", "climb_rail", [-13.4, 0.9, 19.6], [-11.4, 19.6], { conf: 0.93 }), g);
    }
    /* 32 持续肢体冲突 */
    {
      const g = conflictPair();
      attach(root, targets, T("m-conflict", "持续肢体冲突动作", "conflict", [2.0, 1.0, -17.6], [2.0, -15.6], { conf: 0.94 }), g);
    }

    /* ── 站台候车座椅 / 杂项 ─────────────────────────────────── */
    for (const [x, z] of [[-12.5, 21.5], [-12.5, 14.0], [12.5, 21.0]]) {
      const s = benchRow(3);
      s.position.set(x, 0, z);
      s.rotation.y = Math.PI / 2;
      root.add(s);
    }
    for (const [x, z] of [[-15.5, 17.0], [15.5, 17.0]]) {
      const bin = K.trashBin({ h: 0.95, full: false });
      bin.position.set(x, 0, z);
      root.add(bin);
    }
    const vending = K.vending();
    vending.position.set(-16.6, 0, -20.0);
    vending.rotation.y = Math.PI / 2;
    root.add(vending);
    const esc = K.escalator({ len: 9, rise: 3.4 });
    esc.position.set(14.6, 0, 12.0);
    esc.rotation.y = -Math.PI / 2;
    root.add(esc);

    /* 场景装饰人次（不参与识别） */
    for (let i = 0; i < 10; i++) {
      const p = K.person({ shirt: [0x2f4a6d, 0x8a6fa8, 0x3f6b52, 0xd8d3c6][i % 4], walk: i % 2 === 0 });
      const x = -13 + R() * 26;
      const z = -22 + R() * 42;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 2.5) continue;
      p.position.set(x, 0, z);
      p.rotation.y = R() * 6.28;
      root.add(p);
    }

    return { root, targets, spawn: this.spawn };
  },
};
