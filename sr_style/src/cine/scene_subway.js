import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { add_robots } from "./robots.js";
import EXTRA from "../map/data/scene_extra.json";
import PACKAGE from "../map/data/map_package.json" with { type: "json" };

/* ══════════════════════════════════════════════════════════════════════════
   scene_subway — 地铁站（观感版）

   站厅尺度来自 map_package 的棕色地块（约 185 × 47 米），
   内部构造按真实岛式站台做：
     中间岛式站台抬高 0.9 米，两侧各一条 4.4 米轨行区，
     站台边缘黄色安全线 + 盲道，两端停止线，
     两条轨道对开列车，周期 30 秒停 8 秒。

   光是这个场景最难的：地下无天空，全靠顶部灯带与站台灯箱，
   所以用少量点光 + 自发光材质，配合 Bloom 出光晕。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;
const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];

/** 列车相位 → 车组中心位置，与联动演示里的算法一致 */
function train_x(u, T, half_run, cx) {
  const a = 0.35;
  const b = a + T.dwell_s / T.cycle_s;
  if (u < a) {
    const k = u / a;
    return cx - half_run + half_run * (1 - (1 - k) * (1 - k));
  }
  if (u < b) return cx;
  const k = (u - b) / Math.max(0.001, 1 - b);
  return cx + half_run * (k * k);
}

function make_train(T, body_color) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: body_color, roughness: 0.36, metalness: 0.3, envMapIntensity: 1.4,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x121b22, roughness: 0.08, metalness: 0.3, clearcoat: 1,
    clearcoatRoughness: 0.05, envMapIntensity: 2.0,
  });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x1f6fa8, roughness: 0.5, metalness: 0.2 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xa9b0b7, roughness: 0.7, metalness: 0.3 });
  const head = new THREE.MeshStandardMaterial({
    color: 0xfff4d8, emissive: 0xfff0cc, emissiveIntensity: 2.2, roughness: 0.4,
  });

  const gap = T.car_gap_m;
  const total = T.cars * T.car_len_m + (T.cars - 1) * gap;

  for (let i = 0; i < T.cars; i++) {
    const x = -total / 2 + T.car_len_m / 2 + i * (T.car_len_m + gap);

    const shell = new THREE.Mesh(new THREE.BoxGeometry(T.car_len_m, T.height_m, T.width_m), body);
    shell.position.set(x, T.height_m / 2, 0);
    g.add(shell);

    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(T.car_len_m * 0.82, 1.1, 0.05), glass
      );
      win.position.set(x, T.height_m * 0.66, s * (T.width_m / 2 + 0.02));
      g.add(win);

      const band = new THREE.Mesh(
        new THREE.BoxGeometry(T.car_len_m * 0.96, 0.4, 0.04), stripe
      );
      band.position.set(x, T.height_m * 0.34, s * (T.width_m / 2 + 0.03));
      g.add(band);
    }

    const ac = new THREE.Mesh(new THREE.BoxGeometry(T.car_len_m * 0.34, 0.3, T.width_m * 0.6), roof);
    ac.position.set(x, T.height_m + 0.15, 0);
    g.add(ac);
  }

  for (const s of [-1, 1]) {
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.08, T.height_m * 0.34, T.width_m * 0.7), glass);
    wind.position.set(s * (total / 2 + 0.04), T.height_m * 0.72, 0);
    g.add(wind);

    for (const dz of [-0.32, 0.32]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.3), head);
      lamp.position.set(s * (total / 2 + 0.12), T.height_m * 0.58, dz * T.width_m);
      g.add(lamp);
    }
  }
  return g;
}

export async function build_subway(cine) {
  await preload(["concrete_floor", "concrete_wall", "tiles", "metal", "tactile"]);

  const S = EXTRA.subway;
  const brown = PACKAGE.zones.subway.polygon;
  const xs = brown.map((p) => p[0]);
  const ys = brown.map((p) => p[1]);
  const cx_px = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy_px = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [cx, cz] = PW(cx_px, cy_px);

  const hallW = (Math.max(...xs) - Math.min(...xs)) * MPP;
  const hallD = (Math.max(...ys) - Math.min(...ys)) * MPP;

  const H_HALL = S.hall.height_m;
  const platW = S.platform.width_m;
  const platH = S.platform.height_m;
  const trackW = S.track.width_m;

  const root = new THREE.Group();
  root.name = "subway";

  /* 站厅地坪。BoxGeometry 的 UV 是 0~1（一个面对应一整套 0~1），
     所以 repeat 要按「面尺寸 / 贴图米数」给，长宽不等大时就分开给 u、v，
     否则 185 × 47 的地面会把贴图拉成横条。 */
  const floorMat = pbr("concrete_floor", {
    repeat: [hallW / 3, hallD / 3], tint: 0x9aa1aa, normalScale: 0.7,
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.2, hallD), floorMat);
  floor.position.set(cx, -0.1, cz);
  floor.receiveShadow = true;
  root.add(floor);

  /* 轨行区与钢轨 */
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.95 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.9 });
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b5c50, roughness: 0.95 });
  const zOff = platW / 2 + trackW / 2;

  for (const sign of [-1, 1]) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.06, trackW), trackMat);
    bed.position.set(cx, 0.09, cz + sign * zOff);
    root.add(bed);

    for (const rs of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.14, 0.09), railMat);
      rail.position.set(cx, 0.16, cz + sign * zOff + rs * 0.72);
      root.add(rail);
    }

    const step = S.track.sleep_step_m;
    const n = Math.floor(hallW / step);
    for (let i = 0; i < n; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, trackW * 0.84), sleeperMat);
      sl.position.set(cx - hallW / 2 + (i + 0.5) * step, 0.13, cz + sign * zOff);
      root.add(sl);
    }
  }

  /* 岛式站台 */
  const platLen = hallW - 12;
  const platMat = pbr("tiles", {
    repeat: [platLen / 2.4, platW / 2.4], tint: 0xc8ccd0, normalScale: 0.6,
  });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(platLen, platH, platW), platMat);
  platform.position.set(cx, platH / 2, cz);
  platform.castShadow = true;
  platform.receiveShadow = true;
  root.add(platform);

  /* 安全线与盲道 */
  const band = S.platform.edge_band_m;
  const tac = S.platform.tactile_m;
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xe8b81c, roughness: 0.6 });
  /* 盲道是一条 173 米长、0.5 米宽的窄条。u、v 按同一个米数换算，
     贴图才不会被拉成木纹那样的横条。 */
  const tacMat = pbr("tactile", {
    repeat: [platLen / 1.2, tac / 1.2], tint: 0xd9c274, normalScale: 1.4,
  });

  for (const sign of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(platLen, 0.03, band), yellowMat);
    line.position.set(cx, platH + 0.015, cz + sign * (platW / 2 - band / 2));
    root.add(line);

    const t = new THREE.Mesh(new THREE.BoxGeometry(platLen, 0.04, tac), tacMat);
    t.position.set(cx, platH + 0.02, cz + sign * (platW / 2 - band - tac / 2 - 0.25));
    root.add(t);
  }

  /* 停止线 */
  const stopMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.7 });
  for (const sign of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(S.platform.stop_line_m, 0.03, platW), stopMat);
    line.position.set(cx + sign * (platLen / 2 - S.platform.stop_line_from_end_m), platH + 0.02, cz);
    root.add(line);
  }

  /* 墙体、顶棚。前后墙长 185 米、侧墙长 47 米，同一个材质会把侧墙拉花，
     所以两套参数分开给。 */
  const wallMat = pbr("concrete_wall", {
    repeat: [hallW / 2.5, H_HALL / 2.5], tint: 0xc3cad2, normalScale: 0.7,
  });
  const sideWallMat = pbr("concrete_wall", {
    repeat: [hallD / 2.5, H_HALL / 2.5], tint: 0xc3cad2, normalScale: 0.7,
  });
  const back = new THREE.Mesh(new THREE.BoxGeometry(hallW, H_HALL, 0.8), wallMat);
  back.position.set(cx, H_HALL / 2, cz - hallD / 2 + 0.4);
  back.receiveShadow = true;
  root.add(back);

  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.8, H_HALL, hallD), sideWallMat);
    side.position.set(cx + s * (hallW / 2 - 0.4), H_HALL / 2, cz);
    root.add(side);
  }

  /* 另一侧的墙也要有：只做三面时，从站台回看会直接看到天空 */
  const front = new THREE.Mesh(new THREE.BoxGeometry(hallW, H_HALL, 0.8), wallMat);
  front.position.set(cx, H_HALL / 2, cz + hallD / 2 - 0.4);
  root.add(front);

  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(hallW, 0.4, hallD),
    pbr("concrete_floor", {
      repeat: [hallW / 4, hallD / 4], tint: 0xf2f6fa, normalScale: 0.3,
    })
  );
  ceil.position.set(cx, H_HALL + 0.2, cz);
  root.add(ceil);

  /* 立柱与灯带 */
  const pillarMat = pbr("metal", { repeat: 2, tint: 0xc8ced4, metalness: 0.7, envIntensity: 1.2 });
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e6, emissive: 0xffeecb, emissiveIntensity: 4.0, roughness: 0.5,
  });

  /* 站厅是封闭空间，补一盏半球光当环境光，
     否则背光面全黑、顶棚一片死灰 */
  const fill = new THREE.HemisphereLight(0xe8f2fb, 0x6a7078, 1.1);
  fill.position.set(cx, H_HALL, cz);
  root.add(fill);

  const nPillar = Math.floor(platLen / 20);
  for (let i = 0; i <= nPillar; i++) {
    const x = cx - platLen / 2 + 4 + i * 20;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, H_HALL - platH, 14), pillarMat);
    p.position.set(x, platH + (H_HALL - platH) / 2, cz);
    root.add(p);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.1, 0.5), stripMat);
    strip.position.set(x, H_HALL - 0.35, cz);
    root.add(strip);

    if (i % 3 === 0) {
      const light = new THREE.PointLight(0xffeccc, 140, 80, 2);
      light.position.set(x, H_HALL - 1.2, cz);
      root.add(light);
    }
  }

  /* 列车：两条轨道对开，相位差半个周期 */
  const T = S.train;
  const trainLen = T.cars * T.car_len_m + (T.cars - 1) * T.car_gap_m;
  const halfRun = T.approach_m / 2 + trainLen / 2;

  for (let line = 0; line < 2; line++) {
    const sign = line === 0 ? -1 : 1;
    const dir = line === 0 ? 1 : -1;
    const train = make_train(T, line === 0 ? 0xdfe3e8 : 0xe6e9ee);
    /* 列车要动，不能被 merge_static 烘进静态几何——
       烘进去以后组还在、网格已经合走，动画就成了空转，车一直停在原位 */
    train.userData.no_merge = true;
    train.position.set(cx, 0.2, cz + sign * zOff);
    if (dir < 0) train.rotation.y = Math.PI;
    root.add(train);

    const phase = line * 0.5;
    /* 动画注册到 cine.updaters，切换场景时由外层清空 */
    if (cine) {
      cine.add_updater((dt, t) => {
        const u = ((t / T.cycle_s) + phase) % 1;
        const x = train_x(u, T, halfRun, cx);
        train.position.x = dir > 0 ? x : 2 * cx - x;
      });
    }
  }

  /* 站厅是封闭盒子，相机必须放在里面。
     y 给站台面高度附近，跨度按厅长的六成，配合低仰角就能沿站台看纵深。 */
  /* 站台面上的设备：2 台人形 + 1 台狗。台面高 0.9 米，要抬上去 */
  add_robots(root, {
    scene: "subway", cine, dogs: 1, humans: 2,
    floor_y: platH, seed: 4405,
  });

  /* 封闭盒子：轨道相机不加约束会退到厅外，看到盒子外面的天空与地块边缘。
     夹在厅内并留 4 米余量，贴太近时近裁剪面会把墙面切掉半块。 */
  root.userData.frame = {
    center: [cx, cz],
    y: 2.6,
    span: 210,
    cam_clamp: {
      x: [cx - hallW / 2 + 4, cx + hallW / 2 - 4],
      y: [1.0, H_HALL - 0.6],
      z: [cz - hallD / 2 + 4, cz + hallD / 2 - 4],
    },
  };
  return root;
}
