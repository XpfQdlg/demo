import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { make_building, glass_material, add_roof_clutter, add_distant_town } from "./building.js";
import { tree, street_lamp, bench, bin, railing } from "./props.js";
import { build_hill, scatter_hill_trees } from "../map/terrain.js";
import { add_community } from "./scene_community.js";
import { add_robots } from "./robots.js";
import { slabify } from "./rectify.js";
import PACKAGE from "../map/data/map_package.json";
import GROUND_URL from "../map/data/ground.png";

/* ══════════════════════════════════════════════════════════════════════════
   scene_campus — 整个校园（观感版）

   数据全部来自 map_package.json：
     20 栋建筑（已按道路裁边）、道路多边形（含岛洞）、行道树点位、比例尺

   与广场版的区别：不再是手摆的四栋楼，而是整张图上的真实布局。
   场景尺度约 540 × 777 米，所以雾和远景都要按这个尺度给。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;

const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];
const to_world = (poly) => poly.map(([x, y]) => PW(x, y));

/** 建筑用途 → 材质与配色。参考真实校园的常见做法 */
const KIND_STYLE = {
  residential: { slug: "concrete_wall", tint: 0xe4ded2, h: 1.0 },
  teaching: { slug: "concrete_wall", tint: 0xecebe6, h: 1.0 },
  lab: { slug: "brick", tint: 0xd8c8b4, h: 1.0 },
  sports: { slug: "concrete_floor", tint: 0xc8c4bc, h: 0.6 },
  public: { slug: "concrete_wall", tint: 0xe0e4e6, h: 1.0 },
  /* 预留用地：底图上是实心建筑块，与其它楼同一种填色，只是描图时给了最低等级。
     早先按「空地」处理，用水泥地材质配 4 米高度，远看就是两块没盖东西的矮台。
     现在高度改到 14 米，材质也换成正常外墙，与校园其它楼一致。 */
  reserved: { slug: "concrete_wall", tint: 0xdcd7cc, h: 1.0 },
};

function make_ground() {
  const g = new THREE.Group();

  /* 远处用纯色底盘：草地贴图铺 650 次，掠射角下会叠出摩尔纹横条，
     而六百米外的地面本来也看不出纹理 */
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    /* 风格化：外围压成接近背景的深色，校园主体才浮得出来 */
    new THREE.MeshStandardMaterial({ color: 0x1b232b, roughness: 0.96 })
  );
  lawn.rotation.x = -Math.PI / 2;
  /* 一公里见方的地面接阴影会出自遮挡条纹（shadow acne），地面不接 */
  lawn.receiveShadow = false;
  g.add(lawn);

  /* 近景草地那一层去掉了。它和底盘只差 1 厘米，俯视时两层深度打架，
     写实版颜色接近还看不出来，平涂成一深一浅之后就是满地斜条纹。
     平涂本来也不需要这层贴图细节。 */

  /* 地面贴图试过一版：一张图铺满一平方公里，掠射角下全是摩尔纹横条，
     调各向异性也压不住。改回草地底盘，贴地要素（水、绿地、操场）仍由数据包的
     贴地薄片提供颜色。 */

  return g;
}

/** 点在多边形内（射线法），坐标用像素 */
function inside_poly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * 西侧森林带：按数据包的森林轮廓撒树。
 *
 * 换新图时删掉了旧版手写的两座小山，注释说「森林由数据包描述」，
 * 但校园场景没有消费这份数据，周边就只剩空草地。
 * 这里补回 3D 树，同时压一层深绿地面，树缝里不露草坪色。
 */
function add_forest_belt(root) {
  const forests = PACKAGE.zones?.forest?.forests?.length
    ? PACKAGE.zones.forest.forests
    : [PACKAGE.zones?.forest?.polygon].filter(Boolean);
  if (!forests.length) return;

  const campus = PACKAGE.zones?.campus?.polygon || [];
  const path = PACKAGE.forest_path?.polygon || [];

  /* 林下地面：深绿薄片，边界一眼能认出是林地 */
  for (const poly of forests) {
    const pts = to_world(poly).map(([x, z]) => new THREE.Vector2(x, -z));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const patch = new THREE.Mesh(
      geo,
      pbr("grass", { repeat: 1 / 6, normalScale: 1.2, tint: 0x4b6338 })
    );
    patch.position.y = 0.02;
    patch.receiveShadow = true;
    root.add(patch);
  }

  let seed = 20261108;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (const poly of forests) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const area_ha = ((x1 - x0) * (y1 - y0) * MPP * MPP) / 10000;
    /* 每公顷 60 棵，上限 1800 棵。合并静态几何后只多几次绘制调用 */
    const n = Math.min(1800, Math.round(area_ha * 60));
    let placed = 0;
    for (let i = 0; i < n * 8 && placed < n; i++) {
      const px = x0 + rnd() * (x1 - x0);
      const py = y0 + rnd() * (y1 - y0);
      if (!inside_poly(poly, px, py)) continue;
      /* 不往校园里长树，也不挡林间道路 */
      if (campus.length >= 3 && inside_poly(campus, px, py)) continue;
      if (path.length >= 3 && inside_poly(path, px, py)) continue;
      const [x, z] = PW(px, py);
      const t = tree({ h: 7 + rnd() * 6, seed: 7000 + placed, tone: placed });
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI * 2;
      root.add(t);
      placed++;
    }
  }
}

/** 道路：直接铺 map_package 里的路面多边形，含中间的岛洞 */
function make_roads(group) {
  const R = PACKAGE.roads;
  if (!R) return;

  /* 沥青路面：压到接近黑，环境反射调低，否则整条路会泛白 */
  const road_mat = pbr("asphalt", { repeat: 1 / 4, tint: 0x2a2b2d, normalScale: 1.3, envIntensity: 0.35 });
  const line_mat = new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.82 });

  for (const s of R.surface) {
    const pts = to_world(s.outer).map(([x, z]) => new THREE.Vector2(x, -z));
    const shape = new THREE.Shape(pts);
    for (const hole of s.holes || []) {
      shape.holes.push(new THREE.Path(to_world(hole).map(([x, z]) => new THREE.Vector2(x, -z))));
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, road_mat);
    mesh.position.y = 0.05;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return line_mat;
}

export async function build_campus(cine) {
  await preload(
    ["grass", "asphalt", "concrete_wall", "brick", "concrete_floor", "metal", "wood", "paving", "facade"]
  );

  const root = new THREE.Group();
  root.name = "campus";

  root.add(make_ground());

  /* 校园本体铺一层略浅的草地。
     和外面同一块底图时，边界完全读不出来，整片就是一个大草坪；
     铺一层不同色调的地面，加上围栏，校园才像「一个地方」。 */
  {
    const pts = to_world(PACKAGE.zones.campus.polygon).map(([x, z]) => new THREE.Vector2(x, -z));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(
      geo,
      pbr("grass", { repeat: 1 / 4, normalScale: 1.0, tint: 0x33443f })
    );
    base.position.y = 0.02;
    base.receiveShadow = true;
    root.add(base);
  }

  make_roads(root);

    /* 校园尺度大，玻璃若按近景参数调会整片泛白，
     这里压暗并降低环境反射强度 */
  const glass = glass_material(0x141d24);
  glass.envMapIntensity = 1.3;
  const frame_mat = pbr("concrete_wall", { repeat: 2, tint: 0xf0ece2, normalScale: 0.4 });

  /* 建筑：按 kind 分材质，逐栋建 */
  let seed = 20261113;
  for (const b of PACKAGE.buildings) {
    if (!b.polygon || b.polygon.length < 3) continue;

    const h = b.height_m || 0;
    const style = KIND_STYLE[b.kind] || KIND_STYLE.teaching;

    /* 绿地、广场、水面是贴地薄片，不做体块 */
    if (h <= 0.01) {
      /* 贴地要素按用途分材质。
         早先一律用混凝土，结果整片校园铺满灰色水泥地，像工地。 */
      let flatMat;
      if (b.kind === "water") {
        flatMat = new THREE.MeshPhysicalMaterial({
          color: 0x2f5f74, roughness: 0.06, metalness: 0.25,
          clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2,
        });
      } else if (b.kind === "green") {
        flatMat = pbr("grass", { repeat: 1 / 4, tint: 0x6d8a46, normalScale: 1.1 });
      } else if (b.kind === "plaza") {
        flatMat = pbr("paving", { repeat: 1 / 2, tint: 0xb2aea4, normalScale: 0.9 });
      } else if (b.kind === "sports") {
        /* 田径场：跑道圈是砖红，内部是草绿，用平均值折中成偏暖的暗红 */
        flatMat = pbr("concrete_floor", { repeat: 1 / 3, tint: 0x9a5c48, normalScale: 0.9 });
      } else {
        flatMat = pbr("grass", { repeat: 1 / 4, tint: 0x778852, normalScale: 1.0 });
      }

      const pts = to_world(b.polygon).map(([x, z]) => new THREE.Vector2(x, -z));
      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
      geo.rotateX(-Math.PI / 2);
      const patch = new THREE.Mesh(geo, flatMat);
      patch.position.y = b.kind === "water" ? 0.08 : 0.03;
      patch.receiveShadow = true;
      root.add(patch);
      continue;
    }

    const outline = to_world(b.polygon);

    /* 居民楼改成规则板楼（见 rectify.js）。描图得到的是沿路走的弧线与锯齿，
       落到 3D 里是一块形状随意的糖；现实中宿舍是一栋一栋直角体块。
       拆不动（形状太刁或剩下太少）就保留原轮廓。 */
    const slabs = b.kind === "residential" ? slabify(outline, { depth: 13 }) : [];
    const pieces = slabs.length ? slabs : [outline];

    /* 切出来的段（id 形如 xxx_s1）与邻段共边，数据上间距是 0 米。
       没拆成板楼时按质心缩 2.6 米让出山墙；拆成板楼后每条自带间隙，
       稍微缩一点就够，缩多了板楼会变成一块块小盒子。 */
    const seg = /_s(\d+)$/.exec(b.id);
    const seg_shrink = seg ? 2.2 + ((Number(seg[1]) * 7 + b.id.length) % 11) * 0.1 : 0;
    const shrink = slabs.length ? seg_shrink * 0.45 : seg_shrink;

    for (const piece of pieces) {
      const g = make_building({
        outline: piece,
        height: h,
        wall_mat: pbr(style.slug, { repeat: 1 / 3.5, tint: style.tint, normalScale: style.h }),
        glass_mat: glass,
        frame_mat,
        floor_h: 3.6,
        bay: 3.5,
        /* 描图轮廓被道路裁成多块，每块各套一圈女儿墙、压顶互相外溢，
           所以不规则楼体关掉女儿墙；拆成板楼的每条是独立矩形，可以带 */
        parapet: slabs.length > 0,
        shrink,
      });

      /* 屋顶设备：只有够大的楼才放，小配楼放了反而乱 */
      const xs = piece.map((p) => p[0]);
      const zs = piece.map((p) => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bd = Math.max(...zs) - Math.min(...zs);
      if (bw > 22 && bd > 14 && h > 8) {
        add_roof_clutter(g, {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          z: (Math.min(...zs) + Math.max(...zs)) / 2,
          w: bw, d: bd, y: h,
          seed: seed++,
          count: 3,
          outline: piece,
        });
      }

      root.add(g);
    }
  }

  /* 行道树：点位由 Python 预算好，已避开建筑、水面与路面 */
  const spots = PACKAGE.roads?.trees || [];
  for (let i = 0; i < spots.length; i++) {
    const [px, py] = spots[i];
    const [x, z] = PW(px, py);
    const t = tree({ h: 6.2 + ((i * 37) % 11) * 0.22, seed: 1000 + i, tone: i });
    t.position.set(x, 0, z);
    t.rotation.y = (i * 1.7) % (Math.PI * 2);
    root.add(t);
  }

  /* 灌木 */
  for (let i = 0; i < (PACKAGE.roads?.bushes || []).length; i++) {
    const [px, py] = PACKAGE.roads.bushes[i];
    const [x, z] = PW(px, py);
    const b = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.6 + ((i * 13) % 5) * 0.08, 1),
      pbr("grass", { repeat: 2, tint: 0x445c2c, normalScale: 1.5 })
    );
    b.position.set(x, 0.45, z);
    b.scale.y = 0.72;
    root.add(b);
  }

  /* 路灯：沿主干道摆几盏。用道路多边形的顶点当参考点 */
  const roadOuter = PACKAGE.roads?.surface?.[0]?.outer || [];
  for (let i = 0; i < roadOuter.length; i += Math.max(1, Math.floor(roadOuter.length / 26))) {
    const [px, py] = roadOuter[i];
    const [x, z] = PW(px, py);
    const lamp = street_lamp({ h: 5.0, arm: 1.0 });
    lamp.position.set(x, 0, z);
    lamp.rotation.y = (i * 0.9) % (Math.PI * 2);
    root.add(lamp);
  }

  /* 中心广场一带加长椅与垃圾桶，让人气落在最显眼的地方 */
  const plaza = PACKAGE.buildings.find((b) => b.kind === "plaza");
  if (plaza) {
    const cx = plaza.polygon.reduce((a, p) => a + p[0], 0) / plaza.polygon.length;
    const cy = plaza.polygon.reduce((a, p) => a + p[1], 0) / plaza.polygon.length;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const [x, z] = PW(cx + Math.cos(a) * 9 / MPP * 0.5, cy + Math.sin(a) * 9 / MPP * 0.5);
      const b = bench();
      b.position.set(x, 0, z);
      b.rotation.y = a + Math.PI / 2;
      root.add(b);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const [x, z] = PW(cx + Math.cos(a) * 16 / MPP * 0.5, cy + Math.sin(a) * 16 / MPP * 0.5);
      const bb = bin();
      bb.position.set(x, 0, z);
      root.add(bb);
    }
  }

  /* 校园围栏：沿校园轮廓拉一圈，栏杆每隔 2.2 米一根立柱。
     校园周长达一千多米，围栏是最能把「这是一所有边界的学校」说清楚的元素。 */
  const fence_pts = to_world(PACKAGE.zones.campus.polygon);
  /* 轮廓点太密会重复摆柱子，按 12 米间隔抽稀 */
  const thinned = [];
  for (let i = 0; i < fence_pts.length; i++) {
    const p = fence_pts[i];
    const last = thinned[thinned.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 12) thinned.push(p);
  }
  if (thinned.length > 2) {
    thinned.push(thinned[0]);
    const fence = railing(thinned, { h: 1.25, step: 2.4 });
    root.add(fence);
  }

  /* 西侧森林带。
     旧版是手写的两座小山，换新图时删掉了，但新图只给了森林多边形，
     没有补 3D 树，结果校园周边只剩一片空草地。
     这里按数据包的森林轮廓撒树，森林页签用同一份数据。 */
  add_forest_belt(root);

  /* 东边紧挨着的小区：和「小区」页签是同一份数据、同一个函数，
     两处看到的楼一模一样，切换场景只是换了机位。 */
  /* 小区自带两台狗、一台人形：小区页签跟随的是这三台，
     而不是三百米外的校园设备 */
  add_community(root, { robots: true, cine, wall: true });

  /* 远景体量。避让校园、小区、森林与地铁，远景楼不能长在林地或校园里 */
  const avoid_world = [
    PACKAGE.zones?.campus?.polygon,
    PACKAGE.zones?.community?.polygon,
    PACKAGE.zones?.subway?.polygon,
    ...(PACKAGE.zones?.forest?.forests || [PACKAGE.zones?.forest?.polygon]),
  ].filter(Boolean).map(to_world);
  add_distant_town(root, {
    center: [0, 0], count: 70, seed: 20261114, rMin: 420, rMax: 720,
    avoid: avoid_world,
  });

  /* 设备：3 台机器狗（走建筑外全域）+ 2 台人形（只走道路） */
  /* 校园设备按校界卡航点：外出到校外的田里、或者钻进小区的院子，
     讲解时都会被问「我们的机器怎么跑那儿去了」。
     小区那片地在数据包的校园轮廓之内，所以要单独挖掉。 */
  add_robots(root, {
    scene: "campus",
    cine,
    dogs: 3,
    humans: 2,
    seed: 1105,
    area_px: PACKAGE.zones?.campus?.polygon,
    exclude_px: PACKAGE.zones?.community?.polygon ? [PACKAGE.zones.community.polygon] : [],
  });

  /* 取景：校园本体约 454 × 586 米，加上东侧小区的 350 米，
     合起来按 481 × 586 取景，机位才装得下两块地 */
  root.userData.frame = { center: [22, 20], span: 560 };
  return root;
}
