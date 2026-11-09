import * as THREE from "three";
import * as K from "../core/kit.js";
import { dirtTex, tiled, grassTex } from "../core/tex.js";

/* ══════════════════════════════════════════════════════════════════════════
   场景一 · 森林防火与林木巡检
   ══════════════════════════════════════════════════════════════════════════ */

const WOOD = new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.92 });
const STONE = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.95, flatShading: true });
const ASH = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 });

function trashPile(x, z) {
  const g = K.group(x, 0, z);
  const bagOf = (c, r, px, pz, sy) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.05 }));
    m.scale.set(1, sy, 0.94);
    m.position.set(px, r * sy * 0.92, pz);
    m.rotation.y = Math.random() * 3;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  bagOf(0xe8e6df, 0.19, 0, -0.1, 0.86);
  bagOf(0xd5d2c8, 0.15, 0.24, 0.16, 0.8);
  bagOf(0x2b2f36, 0.13, -0.22, 0.18, 0.78);
  const plastic = (c, r, h) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9 }));
  const bottle = plastic(0x9fd6e8, 0.05, 0.24);
  bottle.position.set(0.34, 0.12, 0.14);
  bottle.rotation.z = 1.5;
  g.add(bottle);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), K.M.metal);
  can.position.set(-0.16, 0.07, 0.42);
  can.rotation.z = 1.4;
  g.add(can);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95, side: THREE.DoubleSide }));
  paper.rotation.x = -1.5;
  paper.position.set(0.2, 0.012, -0.3);
  g.add(paper);
  g.add(K.cardboard(0.02, -0.02, 0.55).translateY(0.05));
  return { g, size: [1.1, 0.55, 1.1], cy: 0.28 };
}

function fireSite(x, z, scale = 1) {
  const g = K.group(x, 0, z);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = 0.13 + Math.random() * 0.06;
    const st = new THREE.Mesh(K.G.ballLow, STONE);
    st.scale.setScalar(s * scale);
    st.position.set(Math.cos(a) * 0.55 * scale, s * 0.5, Math.sin(a) * 0.55 * scale);
    st.rotation.set(Math.random(), Math.random() * 3, Math.random());
    st.castShadow = true;
    g.add(st);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.52 * scale, 20), ASH);
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.012;
  g.add(ash);
  for (let i = 0; i < 4; i++) {
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.8, 8), WOOD);
    lg.rotation.z = Math.PI / 2;
    lg.rotation.y = (i / 4) * Math.PI + 0.3;
    lg.position.y = 0.07;
    lg.castShadow = true;
    g.add(lg);
  }
  const flame = K.fireFlame({ size: 0.55 * scale, intensity: 1 });
  flame.position.y = 0.16;
  g.add(flame);
  const smoke = K.smokePlume({ rate: 16, size: 0.55, color: 0xb9bcc0, rise: 1.6, spread: 0.3 });
  smoke.position.y = 0.3;
  g.add(smoke);
  return { g, size: [1.4 * scale, 1.2 * scale, 1.4 * scale], cy: 0.5 * scale, flame };
}

function smokeSource(x, z, s = 1) {
  const g = K.group(x, 0, z);
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.5 * s, 16), ASH);
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = 0.01;
  g.add(embers);
  const smoke = K.smokePlume({ rate: 22, size: 0.9 * s, color: 0x9ea3ab, rise: 1.9, spread: 0.34 });
  smoke.position.y = 0.3;
  g.add(smoke);
  const glow = new THREE.PointLight(0xff7a30, 2.2, 6, 2);
  glow.position.y = 0.4;
  g.add(glow);
  const spark = K.sparkBurst({ color: 0xffb066, n: 10, spread: 0.8 });
  spark.position.y = 0.2;
  g.add(spark);
  K.addTick((t) => {
    glow.intensity = 1.6 + Math.sin(t * 5.5) * 0.7;
  });
  return { g, size: [1.2 * s, 2.4 * s, 1.2 * s], cy: 1.1 * s };
}

function diseasedTree(x, z, h = 5.6) {
  const g = K.group(x, 0, z);
  const t = K.tree({ h, r: 0.2, kind: "broad", dry: true });
  g.add(t);
  // bark wounds
  for (let i = 0; i < 5; i++) {
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x160f0a, roughness: 1 }));
    const a = Math.random() * 6.28;
    hole.position.set(Math.cos(a) * 0.19, 0.6 + Math.random() * 2.2, Math.sin(a) * 0.19);
    g.add(hole);
  }
  // sawdust at the base
  const dust = new THREE.Mesh(new THREE.CircleGeometry(0.45, 14), new THREE.MeshStandardMaterial({ color: 0xa8874f, roughness: 1 }));
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = 0.02;
  g.add(dust);
  // dead branch hanging
  const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, 1.5, 6), K.M.bark);
  br.position.set(0.55, h * 0.62, 0.1);
  br.rotation.z = 1.15;
  g.add(br);
  return { g, size: [2.6, h, 2.6], cy: h * 0.45 };
}

function leafDiseaseBush(x, z) {
  const g = K.group(x, 0, z);
  const b = K.bush(0.85, K.M.leafDeep);
  g.add(b);
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xc8a63c, roughness: 0.9, side: THREE.DoubleSide });
  const brownMat = new THREE.MeshStandardMaterial({ color: 0x8a5a26, roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 26; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), Math.random() > 0.5 ? spotMat : brownMat);
    const a = Math.random() * 6.28;
    const r = 0.35 + Math.random() * 0.6;
    leaf.position.set(Math.cos(a) * r, 0.25 + Math.random() * 0.75, Math.sin(a) * r);
    leaf.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    g.add(leaf);
  }
  return { g, size: [1.7, 1.3, 1.7], cy: 0.62 };
}

function fallenTree(x, z) {
  const g = K.group(x, 0, z);
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 4.6, 10), K.M.bark);
  log.rotation.z = Math.PI / 2;
  log.rotation.y = 0.16;
  log.position.y = 0.24;
  log.castShadow = log.receiveShadow = true;
  g.add(log);
  for (const s of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), new THREE.MeshStandardMaterial({ color: 0xc2a172, roughness: 0.9 }));
    face.position.set(s * 2.3, 0.24, s * 0.36);
    face.rotation.y = s * Math.PI * 0.5;
    g.add(face);
  }
  // broken branch stubs
  for (let i = 0; i < 3; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.9, 6), K.M.bark);
    br.position.set(-1.4 + i * 1.3, 0.4, 0.2);
    br.rotation.x = 1.1;
    br.rotation.z = (Math.random() - 0.5) * 0.8;
    br.castShadow = true;
    g.add(br);
  }
  // canopy of the downed tree
  const canopy = K.bush(1.1, K.M.leafDeep);
  canopy.position.set(1.9, 0.3, 0.1);
  g.add(canopy);
  g.add(K.leafLitter(30, 3.4).translateY(0.03));
  return { g, size: [4.8, 1.1, 2.2], cy: 0.5 };
}

function smokingPerson(x, z) {
  const g = K.group(x, 0, z, -0.5);
  const p = K.person({ shirt: 0x8a3b34, hat: "cap" });
  g.add(p);
  // cigarette + ember + wisp
  const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.9 }));
  cig.position.set(0.12, 1.42, 0.18);
  cig.rotation.x = 1.2;
  g.add(cig);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
  ember.position.set(0.12, 1.46, 0.2);
  g.add(ember);
  const wisp = K.smokePlume({ rate: 6, size: 0.13, color: 0xdfe3e8, rise: 0.55, spread: 0.05 });
  wisp.position.set(0.12, 1.5, 0.2);
  g.add(wisp);
  K.addTick((t) => {
    ember.material.color.setHSL(0.055, 1, 0.52 + Math.sin(t * 9) * 0.12);
  });
  return { g, size: [0.7, 1.8, 0.7], cy: 0.9 };
}

function fireEquipment(x, z) {
  const g = K.group(x, 0, z, 0.4);
  const h = K.hydrant();
  h.position.set(-0.5, 0, 0);
  g.add(h);
  // extinguisher on a plinth
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.3, 12), K.M.concrete);
  plinth.position.set(0.55, 0.15, 0);
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);
  const ex = K.extinguisher();
  ex.position.set(0.55, 0.3, 0);
  g.add(ex);
  const sign = K.signBoard("消防设施", { w: 1.3, h: 0.4, bg: "#b3261e", y: 1.55 });
  sign.position.set(0.1, 0, -0.15);
  g.add(sign);
  return { g, size: [2.0, 1.6, 1.0], cy: 0.8 };
}

export default {
  id: "forest",
  name: "森林",
  title: "森林防火与林木巡检",
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3 6.5 12h3L5 19h14l-4.5-7h3L12 3Z"/></svg>',
  env: {
    env: "forest",
    sky: 0x9db6c4,
    dome: [0x5d8bb0, 0xcfdae0],
    fogNear: 24,
    fogFar: 88,
    sunColor: 0xfff1d4,
    sunInt: 2.9,
    hemiSky: 0xd7e8f5,
    hemiGround: 0x5d6a44,
    hemiInt: 1.15,
    sunPos: [16, 22, 10],
    exposure: 1.05,
  },
  camera: { pos: [11, 7.5, 14], target: [0, 1.2, -1] },
  spawn: { x: 0.8, z: 8.6, heading: Math.PI },

  build() {
    const root = new THREE.Group();
    const R = K.rng(31);

    root.add(K.skyDome(this.env.dome[0], this.env.dome[1], 150));
    K.ground(root, K.M.grass, 150, 2.6);

    /* ── dirt path down the middle ─────────────────────────────── */
    const pathTex = tiled(dirtTex(), 1.4, 11);
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 30),
      new THREE.MeshStandardMaterial({ map: pathTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.008, -1);
    path.receiveShadow = true;
    root.add(path);

    /* ── trees (rejection-sampled, keep the path + targets clear) ── */
    const blocked = [
      [4.6, 6.4, 2.6],
      [-6.2, 5.6, 2.4],
      [-4.4, 0.6, 2.2],
      [6.8, 1.2, 2.4],
      [0.4, -3.4, 3.4],
      [5.4, -7.2, 2.6],
      [-5.6, -8.2, 3.0],
      [-8.8, -14.2, 3.4],
      [0.8, 8.6, 2.4],
    ];
    /* keep the walk between consecutive stops clear */
    const route = [
      [0.8, 8.6],
      [4.4, 8.4],
      [-6.0, 7.7],
      [-3.0, 1.9],
      [5.5, 2.4],
      [0.5, -1.0],
      [4.0, -5.6],
      [-4.3, -6.6],
      [-7.2, -11.8],
    ];
    const distToRoute = (x, z) => {
      let m = 1e9;
      for (let i = 0; i < route.length - 1; i++) {
        const [ax, az] = route[i];
        const [bx, bz] = route[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        m = Math.min(m, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
      }
      return m;
    };
    const trees = [];
    let guard = 0;
    while (trees.length < 44 && guard++ < 1200) {
      const x = (R() - 0.5) * 44;
      const z = (R() - 0.5) * 40 - 2;
      if (Math.abs(x) < 2.9) continue;
      if (distToRoute(x, z) < 2.2) continue;
      if (blocked.some(([bx, bz, r]) => Math.hypot(bx - x, bz - z) < r)) continue;
      if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 2.1)) continue;
      trees.push([x, z]);
      const h = 4.6 + R() * 4.4;
      const t = K.tree({ h, r: 0.16 + R() * 0.1, kind: R() > 0.72 ? "conifer" : "broad" });
      t.position.set(x, 0, z);
      t.rotation.y = R() * 6.28;
      root.add(t);
    }

    /* ── undergrowth ──────────────────────────────────────────── */
    for (let i = 0; i < 34; i++) {
      const x = (R() - 0.5) * 40;
      const z = (R() - 0.5) * 36 - 1;
      if (Math.abs(x) < 2.4 || distToRoute(x, z) < 1.5) continue;
      const b = K.bush(0.24 + R() * 0.3, R() > 0.5 ? K.M.leafDeep : K.M.leaf);
      b.position.set(x, 0, z);
      root.add(b);
    }
    for (let i = 0; i < 60; i++) {
      const x = (R() - 0.5) * 38;
      const z = (R() - 0.5) * 34 - 1;
      if (Math.abs(x) < 2.2) continue;
      const gt = K.grassTuft(4);
      gt.position.set(x, 0, z);
      gt.rotation.y = R() * 3;
      root.add(gt);
    }
    for (let i = 0; i < 16; i++) {
      const x = (R() - 0.5) * 36;
      const z = (R() - 0.5) * 32 - 1;
      if (distToRoute(x, z) < 2.0) continue;
      if (blocked.some(([bx, bz, r]) => Math.hypot(bx - x, bz - z) < r + 1.4)) continue;
      const r = K.rock(0.16 + R() * 0.26);
      r.position.set(x, 0, z);
      r.rotation.y = R() * 3;
      root.add(r);
    }
    root.add(K.leafLitter(70, 16).translateY(0.015));
    root.add(K.motes({ n: 360, range: 26, height: 7, color: 0xfff4d8, size: 0.05 }));

    /* ── props + detection targets ────────────────────────────── */
    const targets = [];
    const add = (t) => {
      root.add(t.g);
      targets.push(t);
    };

    const trash = trashPile(4.6, 6.4);
    add({
      ...trash,
      id: "f-trash",
      name: "树林垃圾",
      owner: "组员",
      sev: "info",
      pos: [4.6, 0.3, 6.4],
      stand: [4.4, 8.4],
      cls: "litter",
      conf: 0.91,
      desc: "步道旁发现塑料袋、饮料瓶等零星生活垃圾，未构成火险隐患。",
      action: "标记清理点位并回传照片，通知保洁班次顺路收运。",
      model: "yolo11s-seg",
    });

    const equip = fireEquipment(-6.2, 5.6);
    add({
      ...equip,
      id: "f-equip",
      name: "灭火器和消防栓",
      owner: "组员",
      sev: "info",
      pos: [-6.2, 0.8, 5.6],
      stand: [-6.0, 7.7],
      cls: "fire_equipment",
      conf: 0.96,
      desc: "微型消防站器材在位，压力表指针位于绿区，外观无破损遮挡。",
      action: "器材状态正常，记录巡检时间并续期台账。",
      model: "yolo11m-obb",
    });

    const smoker = smokingPerson(-4.4, 0.6);
    add({
      ...smoker,
      id: "f-smoke",
      name: "吸烟行为识别",
      owner: "组员",
      sev: "warn",
      pos: [-4.4, 0.95, 0.6],
      stand: [-3.0, 1.9],
      cls: "smoking",
      conf: 0.88,
      desc: "目标人物手持点燃香烟，处于林区禁烟范围内，周边地表明火风险升高。",
      action: "语音播报劝阻，记录人员画面并同步护林员；持续跟随 30 秒。",
      model: "yolo11s-pose",
    });

    const leaf = leafDiseaseBush(6.8, 1.2);
    add({
      ...leaf,
      id: "f-leaf",
      name: "树叶虫害 / 树叶病斑",
      owner: "组员",
      sev: "warn",
      pos: [6.8, 0.7, 1.2],
      stand: [5.5, 2.4],
      cls: "leaf_lesion",
      conf: 0.84,
      desc: "叶面出现黄褐色斑块与卷曲，疑似叶斑病，病斑占比约 18%。",
      action: "采集近景样本并定位病株坐标，生成林业病虫害工单。",
      model: "yolo11s-seg",
    });

    const fallen = fallenTree(0.4, -3.4);
    add({
      ...fallen,
      id: "f-log",
      name: "倒木和断枝",
      owner: "组员",
      sev: "warn",
      pos: [0.4, 0.55, -3.4],
      stand: [0.5, -1.0],
      cls: "fallen_tree",
      conf: 0.93,
      desc: "倒木横跨林间步道，有效通行宽度不足 0.4 m，并伴随散落断枝。",
      action: "判定步道阻断，重新规划绕行路径并上报林道清理任务。",
      model: "yolo11m-seg",
    });

    const tree = diseasedTree(5.4, -7.2, 5.8);
    add({
      ...tree,
      id: "f-tree",
      name: "树干虫害和病害",
      owner: "组员",
      sev: "warn",
      pos: [5.4, 2.6, -7.2],
      stand: [4.0, -5.6],
      cls: "trunk_damage",
      conf: 0.87,
      desc: "树干表面存在 5 处蛀孔与流脂痕迹，树冠叶片枯黄，存在倒伏风险。",
      action: "围树拍摄一圈，标注蛀孔位置，上报林木病害防治。",
      model: "yolo11s-obb",
    });

    const fire = fireSite(-5.6, -8.2, 1.15);
    add({
      ...fire,
      id: "f-fire",
      name: "明火 / 烟雾",
      owner: "组员",
      sev: "alarm",
      pos: [-5.6, 0.55, -8.2],
      stand: [-4.3, -6.6],
      cls: "open_fire",
      conf: 0.97,
      desc: "检测到持续明火与上升烟羽，火焰高度约 0.5 m，距离林缘不足 15 m。",
      action: "立即高音告警并回传火点坐标，后撤 3 m 保持监视，联动防火指挥中心。",
      model: "yolo11s-fire",
    });

    const smoke2 = smokeSource(-8.8, -14.2, 1.1);
    add({
      ...smoke2,
      id: "f-smoke2",
      name: "明火烟雾（远景）",
      owner: "组员",
      sev: "alarm",
      pos: [-8.8, 1.3, -14.2],
      stand: [-7.2, -11.8],
      cls: "smoke_plume",
      conf: 0.79,
      desc: "林间出现柱状灰白烟羽，遮挡树冠，疑似地下阴燃或初期林火。",
      action: "切换热成像复核，上报疑似火点并请求无人机抵近侦察。",
      model: "yolo11s-smoke",
    });

    return { root, targets, spawn: this.spawn };
  },
};
