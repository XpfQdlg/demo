import * as THREE from "three";
import * as K from "../core/kit.js";
import { asphaltTex, tileTex, concreteTex, tiled, signTex, woodTex } from "../core/tex.js";
import { T, attach, polyDist } from "./helper.js";

/* ══════════════════════════════════════════════════════════════════════════
   场景二 · 小区日常巡检（人车秩序 / 消防设施 / 地下车库）
   ══════════════════════════════════════════════════════════════════════════ */

const WALL = new THREE.MeshStandardMaterial({ color: 0xcfc7b8, roughness: 0.92 });
const WALL2 = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.9 });
const DARKIN = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 1 });
const WHITE = K.M.paintWhite;

/* 单元入口：雨棚 + 台阶 + 单元门（可开） */
function unitEntrance({ open = false, num = "3" } = {}) {
  const g = K.group(0, 0, 0);
  const wall = K.box(3.6, 3.1, 0.35, WALL);
  wall.position.y = 1.55;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);

  /* 门洞 */
  const hole = K.box(1.25, 2.2, 0.4, DARKIN);
  hole.position.set(0, 1.1, 0.02);
  g.add(hole);
  const door = K.fireDoor({ open, w: 1.2, h: 2.05 });
  door.position.set(0, 0, 0.1);
  g.add(door);

  /* 雨棚 */
  const canopy = K.box(4.0, 0.14, 1.5, WALL2);
  canopy.position.set(0, 2.62, 0.7);
  canopy.castShadow = true;
  g.add(canopy);
  for (const x of [-1.6, 1.6]) {
    const col = K.cyl(0.06, 0.06, 2.55, 8, WALL2);
    col.position.set(x, 1.27, 1.35);
    g.add(col);
  }
  /* 台阶 */
  for (let i = 0; i < 3; i++) {
    const st = K.box(1.9, 0.12, 1.1 - i * 0.28, K.M.concrete);
    st.position.set(0, 0.06 + i * 0.11, 0.9 + i * 0.12);
    st.receiveShadow = true;
    g.add(st);
  }
  const sign = K.signBoard(`单元 ${num}`, { w: 1.0, h: 0.34, bg: "#1f4f8a", y: 2.85, pos: false });
  sign.position.set(0, 2.85, 0.22);
  sign.rotation.y = Math.PI * 0.0;
  g.add(sign);
  return g;
}

/* 地下车库坡道入口 */
function garagePortal() {
  const g = K.group(0, 0, 0);
  const rampTex = tiled(concreteTex("#6e737a", "#4b5057"), 3, 8);
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 13), new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.95 }));
  ramp.rotation.x = -Math.PI / 2 + 0.16;
  ramp.position.set(0, -0.9, -3.6);
  g.add(ramp);

  /* 深色洞口 */
  const cave = K.box(6.6, 3.2, 5.2, DARKIN);
  cave.position.set(0, -1.5, -7.4);
  g.add(cave);

  /* 门框 */
  for (const x of [-3.5, 3.5]) {
    const p = K.box(0.5, 3.4, 0.6, K.M.concrete);
    p.position.set(x, 1.5, 0.2);
    p.castShadow = true;
    g.add(p);
  }
  const lintel = K.box(7.6, 0.6, 0.6, K.M.concrete);
  lintel.position.set(0, 3.5, 0.2);
  g.add(lintel);
  const sign = K.signBoard("地下车库", { w: 2.0, h: 0.46, bg: "#12345c", y: 3.5, pos: false });
  sign.position.set(0, 3.62, 0.55);
  g.add(sign);

  /* 护栏 */
  for (const x of [-3.2, 3.2]) {
    const rail = K.box(0.08, 1.0, 11, K.M.metal);
    rail.position.set(x, 0.5, -4.6);
    g.add(rail);
  }
  return g;
}

/* 小区大门 + 岗亭 */
function gateHouse() {
  const g = K.group(0, 0, 0);
  const booth = K.box(2.6, 2.5, 2.2, new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.9 }));
  booth.position.set(-4.6, 1.25, 0);
  booth.castShadow = true;
  g.add(booth);
  const roof = K.box(3.0, 0.18, 2.6, new THREE.MeshStandardMaterial({ color: 0x2d3a45, roughness: 0.8 }));
  roof.position.set(-4.6, 2.58, 0);
  g.add(roof);
  const win = K.box(1.7, 1.0, 0.06, K.M.glass);
  win.position.set(-4.6, 1.55, 1.12);
  g.add(win);

  /* 道闸 */
  const post = K.cyl(0.09, 0.09, 1.0, 8, K.M.metal);
  post.position.set(2.4, 0.5, 0);
  g.add(post);
  const arm = K.box(4.2, 0.1, 0.09, new THREE.MeshStandardMaterial({ color: 0xe23f3f, roughness: 0.6 }));
  arm.position.set(4.5, 1.0, 0);
  arm.rotation.z = -0.08;
  g.add(arm);
  const board = K.signBoard("小区出入口", { w: 2.4, h: 0.5, bg: "#14472f", y: 2.0, pos: false });
  board.position.set(-4.6, 3.0, 0);
  g.add(board);
  return g;
}

/* 绿化带 / 花坛 */
function planter(len = 4, w = 1.4) {
  const g = K.group(0, 0, 0);
  const kerb = K.box(len, 0.32, w, new THREE.MeshStandardMaterial({ color: 0x8d8b84, roughness: 0.95 }));
  kerb.position.y = 0.16;
  kerb.receiveShadow = true;
  g.add(kerb);
  const R = K.rng(len * 977 + 13);
  for (let i = 0; i < 7; i++) {
    const b = K.bush(0.28 + R() * 0.26, R() > 0.5 ? K.M.leaf : K.M.leafDeep);
    b.position.set((R() - 0.5) * (len - 0.8), 0.3, (R() - 0.5) * (w - 0.5));
    g.add(b);
  }
  return g;
}

/* 停放的电动车组（沿 x 排成一列，车头朝 ±z） */
function ebikeRow(n = 4, rot = 0) {
  const g = K.group(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const b = K.ebike(i % 3 === 0 ? 0x33414d : i % 3 === 1 ? 0x2d3b3a : 0x3a3f4a);
    b.position.set((i - (n - 1) / 2) * 0.72, 0, (i % 2 ? 0.05 : -0.05));
    b.rotation.y = rot + Math.PI / 2 + (i % 2 ? 0.11 : -0.08);
    g.add(b);
  }
  return g;
}

/* 车库内的一组灯具（可故障） */
function garageLamp({ broken = false } = {}) {
  const g = K.group(0, 0, 0);
  const bar = K.box(1.3, 0.1, 0.24, K.M.darkMetal);
  bar.position.y = 2.5;
  g.add(bar);
  const emitMat = new THREE.MeshStandardMaterial({
    color: 0xfff2d0,
    emissive: 0xfff2d0,
    emissiveIntensity: broken ? 0.5 : 1.5,
    roughness: 0.4,
  });
  const tube = K.box(1.16, 0.05, 0.16, emitMat);
  tube.position.y = 2.43;
  g.add(tube);
  const light = new THREE.PointLight(0xfff0d0, broken ? 2.2 : 6, 9, 2);
  light.position.set(0, 2.3, 0);
  g.add(light);
  if (broken) {
    let t0 = Math.random() * 6;
    K.addTick((t) => {
      const k = (t + t0) % 2.2;
      const on = k < 1.3 ? (Math.sin(t * 24) > 0 ? 1 : 0.15) : 0.04;
      emitMat.emissiveIntensity = 0.35 + on * 1.4;
      light.intensity = 1.2 + on * 4.6;
    });
  }
  return g;
}

function boxesStack(n = 3) {
  const g = K.group(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const b = K.cardboard((i % 2 ? 0.2 : -0.25), 0.1, 0.5 + i * 0.02);
    b.position.y = i * 0.34;
    b.rotation.y = i * 0.5;
    g.add(b);
  }
  const bag = K.ball(0.26, new THREE.MeshStandardMaterial({ color: 0x2f3a46, roughness: 0.7 }), 10, 8);
  bag.position.set(0.5, 0.22, 0.4);
  bag.scale.set(1, 0.8, 1);
  g.add(bag);
  return g;
}

/* 破损围栏：断一截并且翘起 */
function fenceBroken(len = 5) {
  const g = K.group(0, 0, 0);
  const good = K.fence(len * 0.45, 1.2);
  good.position.x = -len * 0.27;
  g.add(good);
  const good2 = K.fence(len * 0.3, 1.2);
  good2.position.x = len * 0.32;
  g.add(good2);
  for (let i = 0; i < 3; i++) {
    const seg = K.box(1.5, 1.1, 0.05, new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.7, metalness: 0.5 }));
    seg.position.set(-0.6 + i * 0.5, 0.35 + i * 0.05, 0.1 * i);
    seg.rotation.set(0.15 + i * 0.2, 0.3 * i, 1.2 + i * 0.1);
    seg.castShadow = true;
    g.add(seg);
  }
  return g;
}

export default {
  id: "community",
  name: "小区",
  title: "小区安全与秩序巡检",
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3 3 10v11h6v-6h6v6h6V10L12 3Z"/></svg>',
  env: {
    env: "city",
    sky: 0xa8bccb,
    dome: [0x6f9dc4, 0xd8e2e8],
    fogNear: 28,
    fogFar: 95,
    sunColor: 0xfff0d6,
    sunInt: 2.35,
    hemiSky: 0xdcebf7,
    hemiGround: 0x5a5b52,
    hemiInt: 1.1,
    sunPos: [-18, 24, 14],
    exposure: 0.94,
  },
  camera: { pos: [8.6, 5.4, 14.2], target: [0.4, 1.0, 1.6] },
  spawn: { x: 0.4, z: 9.2, heading: Math.PI },

  build() {
    const root = new THREE.Group();
    const R = K.rng(77);
    root.add(K.skyDome(this.env.dome[0], this.env.dome[1], 160));

    /* ── 地面：中央广场 + 环路 ─────────────────────────────────── */
    K.ground(root, K.M.concrete, 150, 6);
    const plazaTex = tiled(tileTex("#9c9789", "#7b7669", 3), 9, 8);
    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 22),
      K.surf(plazaTex, { bump: 0.9, rough: 0.62, metal: 0.04, env: 0.42, roughMap: [0.45, 0.95] })
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.012, 1);
    plaza.receiveShadow = true;
    root.add(plaza);

    const roadTex = tiled(asphaltTex(), 12, 2);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 7.6),
      K.surf(roadTex, { bump: 1.3, rough: 0.95, metal: 0.02, env: 0.4, roughMap: [0.7, 1.0] })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.008, 17);
    road.receiveShadow = true;
    root.add(road);
    /* 车道边线 */
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e6dd, roughness: 0.8 });
    for (const z of [13.4, 20.6]) {
      const l = K.box(64, 0.01, 0.14, lineMat);
      l.position.set(0, 0.02, z);
      root.add(l);
    }
    for (let i = -6; i <= 6; i++) {
      const dash = K.box(1.4, 0.01, 0.1, lineMat);
      dash.position.set(i * 4.6, 0.021, 17);
      root.add(dash);
    }

    /* ── 远景住宅楼 ───────────────────────────────────────────── */
    const towers = [
      [-27, -8, 15, 24, 11, 5, 9],
      [26, -10, 14, 27, 12, 4, 10],
      [-6, -30, 17, 22, 10, 6, 8],
      [14, -31, 13, 18, 9, 4, 7],
    ];
    for (const [x, z, w, h, d, cols, rows] of towers) {
      const b = K.building({ w, h, d, wall: "#d3cbbd", win: "#33465a", cols, rows, lit: 0.16 });
      b.position.set(x, 0, z);
      root.add(b);
    }

    /* ── 广场周边单元入口 ─────────────────────────────────────── */
    const ue1 = unitEntrance({ num: "3" });
    ue1.position.set(-11.4, 0, -8.2);
    root.add(ue1);
    const ue2 = unitEntrance({ num: "5", open: true });
    ue2.position.set(11.4, 0, -8.2);
    root.add(ue2);

    /* 楼栋侧墙（把单元入口连成一体） */
    for (const x of [-16.4, 16.4]) {
      const b = K.building({ w: 9, h: 16, d: 6, wall: "#cdc5b6", win: "#33465a", cols: 3, rows: 6, lit: 0.18 });
      b.position.set(x, 0, -12.5);
      root.add(b);
    }

    /* ── 绿化与道路设施 ───────────────────────────────────────── */
    for (const [x, z, len] of [[-7.5, 8.6, 4.4], [7.5, 8.6, 4.4], [-7.5, -2.2, 3.6], [7.6, -2.4, 3.4]]) {
      const p = planter(len);
      p.position.set(x, 0, z);
      root.add(p);
    }
    for (const [x, z] of [[-13.2, 6.6], [13.0, 6.6], [-13.2, -2.2]]) {
      const tr = K.tree({ h: 5.4 + R() * 1.6, r: 0.17, kind: "broad" });
      tr.position.set(x, 0, z);
      root.add(tr);
    }
    for (const [x, z] of [[-9.4, 11.4], [9.4, 11.4]]) {
      const l = K.streetLamp({ h: 4.6, on: true });
      l.position.set(x, 0, z);
      root.add(l);
    }
    const bench = K.bench();
    bench.position.set(-5.2, 0, 9.4);
    root.add(bench);

    /* 停车位划线 */
    for (let i = 0; i < 6; i++) {
      const l = K.box(0.1, 0.01, 5, lineMat);
      l.position.set(-28 + i * 2.7, 0.02, 17);
      root.add(l);
    }
    const parked = K.car({ color: 0xcfd4d8, ry: Math.PI / 2 });
    parked.position.set(11.5, 0, 16.6);
    root.add(parked);
    const parked2 = K.car({ color: 0x3c4a5a, ry: -Math.PI / 2, type: "van" });
    parked2.position.set(-14.5, 0, 17.2);
    root.add(parked2);

    /* ── 大门 ─────────────────────────────────────────────────── */
    const gate = gateHouse();
    gate.position.set(0, 0, 23.5);
    root.add(gate);
    for (const x of [-16, 16]) {
      const f = K.fence(13, 1.5);
      f.position.set(x, 0, 23.5);
      root.add(f);
    }

    /* ══════════════════ 检测点位 ══════════════════ */
    const targets = [];

    /* 出入口拥挤 */
    {
      const g = K.group(0, 0, 0);
      const shirts = [0x3b6ea5, 0xd8d3c8, 0x8a4b3f, 0x2f5c46, 0x4b4b57, 0xb08a3e];
      for (let i = 0; i < 7; i++) {
        const p = K.person({ shirt: shirts[i % shirts.length], walk: i % 2 === 0 });
        p.position.set(-0.9 + (i % 4) * 0.62, 0, (i > 3 ? 0.7 : 0) + (i % 2) * 0.2);
        p.rotation.y = R() * 6.28;
        g.add(p);
      }
      attach(root, targets, T("c-crowd-gate", "出入口拥挤", "crowd", [0.2, 0.9, 20.2], [0.2, 18.0], { conf: 0.86 }), g);
    }

    /* 人员异常聚集 */
    {
      const g = K.group(0, 0, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = K.person({ shirt: [0xcfcfc4, 0x4a6f9c, 0x8f5a4a][i % 3], walk: false });
        p.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
        p.rotation.y = -a + Math.PI / 2;
        g.add(p);
      }
      attach(root, targets, T("c-crowd", "人员异常聚集", "crowd", [-8.6, 0.9, -0.6], [-6.6, 0.4], { conf: 0.83 }), g);
    }

    /* 电动车违规停放 */
    attach(root, targets, T("c-ebike-park", "电动车违规停放", "vehicle_misplaced", [6.4, 0.55, 4.6], [4.9, 5.6], { conf: 0.92 }), ebikeRow(5, 0.3));

    /* 电动车入楼 */
    {
      const g = ebikeRow(2, 0.1);
      g.position.set(-0.2, 0, 1.9);
      const t = T("c-ebike-in", "电动车入楼", "ebike_indoor", [-11.4, 0.6, -6.4], [-11.2, -4.2], { conf: 0.94 });
      attach(root, targets, t, g);
    }

    /* 减速带 */
    {
      const g = K.speedBump(4.2);
      g.rotation.y = Math.PI / 2;
      attach(root, targets, T("c-bump", "地面减速带", "road_obstacle", [10.6, 0.12, 17], [10.6, 14.6], { conf: 0.98, sev: "info", cls: "road_obstacle", desc: "减速带整体完整，反光条清晰，安装位置距路口 6 m，符合小区限速要求。", action: "确认减速带无缺失与翘起，纳入季度巡查记录。", size: [0.4, 0.08, 4.2] }), g);
    }

    /* 路灯亮灭 */
    {
      const g = K.group(0, 0, 0);
      const lamp = K.streetLamp({ h: 4.6, on: false });
      g.add(lamp);
      attach(root, targets, T("c-lamp", "路灯亮灭", "street_lamp", [-11.6, 2.6, -3.6], [-11.4, -1.4], { conf: 0.89 }), g);
    }

    /* 烟雾火灾监测（窗口冒烟） */
    {
      const g = K.group(0, 0, 0);
      const smoke = K.smokePlume({ rate: 26, size: 0.62, color: 0xb9c2ca, rise: 1.9, spread: 0.2 });
      smoke.position.set(0, 3.4, 0);
      g.add(smoke);
      const glow = K.fireFlame({ size: 0.5, intensity: 0.6 });
      glow.position.set(0, 2.5, 0.3);
      g.add(glow);
      attach(root, targets, T("c-smoke", "烟雾火灾监测", "smoke_fire", [11.4, 4.6, -10.6], [9.6, -6.6], { conf: 0.95 }), g);
    }

    /* 防火门状态 */
    {
      const g = K.group(0, 0, 0);
      const frame = K.box(1.5, 2.4, 0.2, K.M.concrete);
      frame.position.set(0, 1.2, 0);
      g.add(frame);
      const door = K.fireDoor({ open: true });
      door.position.set(0, 0, 0.16);
      g.add(door);
      attach(root, targets, T("c-firedoor", "防火门状态", "fire_door", [11.4, 1.1, -5.4], [9.8, -4.0], { conf: 0.9 }), g);
    }

    /* 井盖异常 */
    {
      const g = K.group(0, 0, 0);
      const a = K.manhole({ open: true });
      a.position.set(0, 0, 0);
      g.add(a);
      attach(root, targets, T("c-manhole", "井盖异常", "manhole", [4.2, 0.16, 8.2], [2.6, 8.0], { conf: 0.87 }), g);
    }

    /* 道路障碍物 */
    {
      const g = K.group(0, 0, 0);
      const b = K.barrier(2.2, 0.95);
      b.position.set(0, 0, 0.4);
      g.add(b);
      const box = K.cardboard(0.2, 0.9, 0.8);
      g.add(box);
      const cn = K.cone(0.6);
      cn.position.set(1.1, 0, 0.8);
      g.add(cn);
      attach(root, targets, T("c-obstacle", "道路障碍物", "road_obstacle", [-4.4, 0.55, 17], [-4.4, 14.2], { conf: 0.9 }), g);
    }

    /* 路面破损 */
    {
      const g = K.group(0, 0, 0);
      const crack = K.crackDecal(2.4);
      crack.position.set(0, 0.024, 0);
      g.add(crack);
      attach(root, targets, T("c-crack", "路面破损", "road_crack", [8.2, 0.06, 19.4], [7.4, 17.4], { conf: 0.85 }), g);
    }

    /* 地面积水（小区道路） */
    {
      const g = K.group(0, 0, 0);
      g.add(K.puddle(0, 0, 2.6, 1.7, 0.3));
      attach(root, targets, T("c-puddle", "地面积水（小区道路）", "puddle", [-9.6, 0.05, 12.6], [-9.4, 10.4], { conf: 0.88 }), g);
    }

    /* 地面积水（地下车库） */
    {
      const g = K.group(0, 0, 0);
      g.add(K.puddle(0, 0, 3.4, 2.2, -0.2));
      attach(root, targets, T("c-puddle-garage", "地面积水（地下车库）", "puddle", [16.0, 0.05, 12.2], [14.2, 13.6], { conf: 0.86, sev: "alarm", desc: "车库坡道底部出现成片积水，面积约 5 m²，与入口渗漏点位置吻合。", action: "判定坡道湿滑风险，设置警戒并通知机电排查集水井与排水泵。" }), g);
    }

    /* 烟雾火焰识别（垃圾点起火） */
    {
      const g = K.group(0, 0, 0);
      const fire = K.fireFlame({ size: 0.46, intensity: 1.1 });
      fire.position.set(0, 0.1, 0);
      g.add(fire);
      const smoke = K.smokePlume({ rate: 20, size: 0.5, color: 0x8f949a, rise: 1.6, spread: 0.18 });
      smoke.position.set(0, 0.7, 0);
      g.add(smoke);
      attach(root, targets, T("c-fire", "烟雾火焰识别", "smoke_fire", [9.6, 0.6, 3.2], [7.8, 2.4], { conf: 0.96 }), g);
    }

    /* 垃圾满溢 */
    {
      const g = K.group(0, 0, 0);
      const bin = K.trashBin({ h: 0.95, full: true });
      g.add(bin);
      attach(root, targets, T("c-trash", "垃圾满溢", "trash_full", [9.4, 0.6, -1.4], [7.6, -1.0], { conf: 0.91 }), g);
    }

    /* 楼道堆物 */
    {
      const g = boxesStack(3);
      attach(root, targets, T("c-corridor", "楼道堆物", "corridor_clutter", [11.4, 0.6, -11.4], [9.8, -11.0], { conf: 0.89 }), g);
    }

    /* 围栏破损 */
    attach(root, targets, T("c-fence", "小区围栏破损", "fence_broken", [15.4, 0.7, 19.4], [13.2, 18.6], { conf: 0.87 }), fenceBroken(5));

    /* 地下车库灯具故障 */
    {
      const g = K.group(0, 0, 0);
      const lamp = garageLamp({ broken: true });
      lamp.position.set(0, 0, 0);
      g.add(lamp);
      attach(root, targets, T("c-garage-lamp", "地下车库灯具故障", "garage_lamp", [18.4, 2.4, 9.4], [16.2, 10.8], { conf: 0.84 }), g);
    }

    /* 消防栓（2 类） */
    {
      const g = K.group(0, 0, 0);
      const h = K.hydrant();
      g.add(h);
      const box = K.fireBox();
      box.position.set(1.1, 0, 0.2);
      g.add(box);
      attach(root, targets, T("c-hydrant", "消防栓（2 类）", "hydrant", [-10.4, 0.62, 4.2], [-10.2, 6.2], { conf: 0.95 }), g);
    }

    /* 灭火器（5 类） */
    {
      const g = K.group(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const e = K.extinguisher();
        e.position.set(-0.5 + i * 0.4, 0, 0);
        g.add(e);
      }
      attach(root, targets, T("c-ext", "灭火器（5 类）", "extinguisher", [-10.6, 0.34, -5.6], [-10.4, -3.6], { conf: 0.96, size: [1.2, 0.62, 0.4] }), g);
    }

    /* 车库坡道本体 + 内部灯具 */
    const portal = garagePortal();
    portal.position.set(19.2, 0, 14.6);
    root.add(portal);
    const gl2 = garageLamp({ broken: false });
    gl2.position.set(19.2, 0, 11.0);
    root.add(gl2);

    /* ── 散点绿化 ─────────────────────────────────────────────── */
    const route = polyDist([[this.spawn.x, this.spawn.z], ...targets.map((t) => t.stand)]);
    let guard = 0;
    let added = 0;
    while (added < 16 && guard++ < 400) {
      const x = (R() - 0.5) * 54;
      const z = (R() - 0.5) * 46 - 2;
      if (Math.abs(x) < 13.5 && z > -12 && z < 14) continue;
      if (route(x, z) < 2.2) continue;
      if (Math.abs(x) > 24 || z < -26) continue;
      const tr = K.tree({ h: 5 + R() * 2.4, r: 0.16 + R() * 0.06, kind: R() > 0.7 ? "conifer" : "broad" });
      tr.position.set(x, 0, z);
      root.add(tr);
      added++;
    }
    root.add(K.motes({ n: 260, range: 24, height: 7, color: 0xffffff, size: 0.045 }));

    return { root, targets, spawn: this.spawn };
  },
};
