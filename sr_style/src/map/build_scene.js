import * as THREE from "three";
import { PACKAGE, MAP, WORLD, px_to_world } from "./coords.js";
import { nearest_walkable_px, spread_spots } from "./pathfind.js";
import { nav_for } from "./nav_grid.js";
import { Crowd, crowd_cluster } from "../core/crowd.js";
import { build_hill, scatter_hill_trees, inside_polygon } from "./terrain.js";
import * as K from "../core/kit.js";
import { asphaltTex, facadeTex, signTex } from "../core/tex.js";
import EXTRA from "./data/scene_extra.json";

/* ══════════════════════════════════════════════════════════════════════════
   build_scene — 场景构建的唯一入口

   契约（见 docs/03 第 5.1 节）：
     build_scene(scene_id) -> {
       root, targets, spawns, extent, env, name, title
     }

   坐标：一律使用地图像素坐标，转世界坐标只在 coords.js 发生。

   四个场景的来源：
     campus     新图蓝色轮廓 + 原图迁移过来的 20 栋建筑 + 东山远景
     community  新图品红轮廓 + scene_extra 里的环路、中轴、行列住宅楼
     forest     西山地形（scene_extra）+ 山脚巡检空地
     subway     新图棕色多边形（单独建）+ 站台、停止线、进出站列车

   比例尺 1 像素 = 0.5 米，校园约 454 × 586 米。
   ══════════════════════════════════════════════════════════════════════════ */

const GROUND_URL = new URL("./data/ground.png", import.meta.url).href;

/* 建筑按用途配色，取自原图的图例习惯 */
const KIND_COLOR = {
  residential: 0xd8d2c4,
  teaching: 0xc9d1d8,
  lab: 0xc9b6a8,
  sports: 0xb9c7b0,
  plaza: 0xaab0b6,
  green: 0x4d7a3c,
  water: 0x3d6b8a,
  public: 0xdde1e5,
  reserved: 0xc7c2a8,
};

const KIND_LABEL = {
  residential: "学生公寓",
  teaching: "教学建筑",
  lab: "实验中心",
  sports: "体育场地",
  plaza: "广场",
  green: "绿地",
  water: "水体",
  public: "公共建筑",
  reserved: "待建区域",
};

/* ── 入口 ─────────────────────────────────────────────────────────── */

export function build_scene(scene_id) {
  if (scene_id === "campus") return build_campus();
  if (scene_id === "community") return build_community();
  if (scene_id === "forest") return build_forest();
  if (scene_id === "subway") return build_subway();
  throw new Error(`未知场景：${scene_id}`);
}

/* ── 通用构件 ─────────────────────────────────────────────────────── */

/** 整幅地面：贴图由 Python 预处理生成，路面与绿地已经画好 */
function ground_plane() {
  const geo = new THREE.PlaneGeometry(WORLD.width, WORLD.depth);
  geo.rotateX(-Math.PI / 2);

  const tex = new THREE.TextureLoader().load(GROUND_URL);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  /* 底图象素密度低（约 2 像素/米），近处会糊。
     叠一张高重复的沥青法线颗粒，近看才有路面质感。 */
  const detail = asphaltTex();
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.repeat.set(160, 230);

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    bumpMap: detail,
    bumpScale: 1.2,
    roughness: 0.92,
    metalness: 0,
    /* 绿地、广场、水面都是贴着地面的薄片，远处会与地面深度打架（拉出条纹）。
       把地面本身往后推一点，让上层薄片永远赢 */
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });

  /* 底图颜色乘以高频颗粒，近处才有路面质感而不是一片糊 */
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.u_detail = { value: detail };
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform sampler2D u_detail;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         vec3 grain = texture2D(u_detail, vMapUv * 210.0).rgb;
         diffuseColor.rgb *= (0.72 + grain * 0.56);`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** 多边形 → 世界坐标的 Shape（注意 z 取反，配合 rotateX(-90°)） */
function shape_of(polygon_px, holes_px = []) {
  const to_pts = (poly) =>
    poly.map(([px, py]) => {
      const w = px_to_world(px, py);
      return new THREE.Vector2(w.x, -w.z);
    });
  const shape = new THREE.Shape(to_pts(polygon_px));
  for (const h of holes_px) {
    if (h.length >= 3) shape.holes.push(new THREE.Path(to_pts(h)));
  }
  return shape;
}

/** 带内洞的多边形 → 贴地平面网格。道路中间有岛，必须支持 holes */
function shape_patch(polygon_px, holes_px, material, y) {
  const geo = new THREE.ShapeGeometry(shape_of(polygon_px, holes_px));
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 按高度挤出建筑体块。
 * 立面用窗户贴图，按米数推算层数，窗格尺寸与真实楼层接近。
 * 屋顶用同色深一档的平面，外墙与屋顶分组，不让窗户贴图糊到屋顶上。
 */
function extrude(polygon_px, height_m, material) {
  const shape = shape_of(polygon_px);
  const depth = Math.max(0.6, height_m);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 4,
  });

  /* ExtrudeGeometry 的 group 0 是顶/底面，group 1 是侧墙。
     侧墙用窗户立面，顶面用屋顶材质。 */
  const floors = Math.max(1, Math.round(height_m / 3.6));
  const wall = material.userData.wall_mat || material;
  const roof = material.userData.roof_mat || material;

  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, [roof, wall]);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.floors = floors;
  return mesh;
}

/** 平地要素：广场、绿地、水体，抬高一点避免与地面 z-fighting */
function flat_patch(polygon_px, material, y = 0.06) {
  const shape = shape_of(polygon_px);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 道路层：黑沥青路面 + 白色边线，两层叠放。
 * 边线层是路面向外扩 0.45 米后的轮廓，压在路面上方一点点，
 * 只有露在外面的那一圈是白的，看起来就是双白边。
 */
function road_layer() {
  const R = PACKAGE.roads;
  if (!R) return null;
  const g = new THREE.Group();
  g.name = "roads";

  /* 白线：略高于地面与绿地，避免与 flat_patch（0.06）打架 */
  const line_mat = new THREE.MeshStandardMaterial({
    color: 0xf2f2ee,
    roughness: 0.82,
    metalness: 0,
  });

  /* 黑路面：沥青贴图压暗，粗颗粒与近处的裂缝保留 */
  const asphalt = asphaltTex();
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(0.42, 0.42); // 1 像素对应 1 米世界坐标，0.42 让贴图约 2.4 米一循环
  asphalt.anisotropy = 8;

  const road_mat = new THREE.MeshStandardMaterial({
    map: asphalt,
    color: 0x4a4d52, // 贴图本身是中灰，乘这个系数压到接近黑
    roughness: 0.93,
    metalness: 0.02,
    envMapIntensity: 0.5,
  });

  /* 白边先铺，黑面再压上去，只留外沿一圈白。
     两层必须拉开足够高度：只差一两厘米时，俯视两百米外会出现深度精度不够的
     黑百相间条纹（典型的 z-fighting）。这里差 8 厘米，肉眼看不出来，但不再闪。 */
  line_mat.polygonOffset = true;
  line_mat.polygonOffsetFactor = 2;
  line_mat.polygonOffsetUnits = 2;
  road_mat.polygonOffset = true;
  road_mat.polygonOffsetFactor = -2;
  road_mat.polygonOffsetUnits = -2;

  for (const s of R.edge) g.add(shape_patch(s.outer, s.holes, line_mat, 0.06));
  for (const s of R.surface) g.add(shape_patch(s.outer, s.holes, road_mat, 0.14));

  return g;
}

/**
 * 行道树与灌木。
 * 点位由 Python 预先算好，已避开建筑、水面与路面。
 * 用 InstancedMesh 绘制：一棵树拆成「树干 + 树冠」两次实例化，
 * 两百多棵也只有 4 次绘制调用，而不是几千次。
 */
function street_trees(root, spots, bushes) {
  if (!spots || !spots.length) return;

  const rng = mulberry32(20261104);
  const count = spots.length;

  /* 树干：低面数圆柱，实例化时按树高拉伸 */
  const trunk_geo = new THREE.CylinderGeometry(0.13, 0.2, 1, 6);
  trunk_geo.translate(0, 0.5, 0);
  const trunk_mat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.96 });
  const trunks = new THREE.InstancedMesh(trunk_geo, trunk_mat, count);
  trunks.castShadow = false;
  trunks.receiveShadow = true;

  /* 树冠：两层低面数多面体，一层压低一层偏高，做出层次 */
  const crown_geo = new THREE.IcosahedronGeometry(1, 1);
  const crown_mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true,
  });
  const crowns = new THREE.InstancedMesh(crown_geo, crown_mat, count * 2);
  crowns.castShadow = false;
  crowns.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const c = new THREE.Color();

  const LEAF = [0x4f7a34, 0x3f6a2c, 0x5b8740, 0x35592a];

  for (let i = 0; i < count; i++) {
    const [px, py] = spots[i];
    const w = px_to_world(px, py);
    const h = 4.6 + rng() * 2.6;

    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    pos.set(w.x, 0, w.z);
    scl.set(0.9 + rng() * 0.35, h, 0.9 + rng() * 0.35);
    trunks.setMatrixAt(i, m.compose(pos, q, scl));

    /* 树冠两团：低的一团压住主干上半段，高的一团收顶，避免棒棒糖形 */
    const r = 1.7 + rng() * 0.55;
    for (let k = 0; k < 2; k++) {
      const idx = i * 2 + k;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      pos.set(
        w.x + (rng() - 0.5) * 0.55,
        h * (k === 0 ? 0.62 : 0.86),
        w.z + (rng() - 0.5) * 0.55
      );
      const rr = r * (k === 0 ? 1 : 0.68);
      scl.set(rr * 1.18, rr * 1.0, rr * 1.18);
      crowns.setMatrixAt(idx, m.compose(pos, q, scl));
      crowns.setColorAt(idx, c.setHex(LEAF[(i + k) % LEAF.length]));
    }
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  root.add(trunks, crowns);

  /* 灌木：贴地的一团，同样实例化 */
  if (bushes && bushes.length) {
    const bush_geo = new THREE.IcosahedronGeometry(1, 0);
    const bush_mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, flatShading: true,
    });
    const inst = new THREE.InstancedMesh(bush_geo, bush_mat, bushes.length);
    inst.receiveShadow = true;
    for (let i = 0; i < bushes.length; i++) {
      const [px, py] = bushes[i];
      const w = px_to_world(px, py);
      const r = 0.5 + rng() * 0.35;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      pos.set(w.x, r * 0.55, w.z);
      scl.set(r * 1.25, r * 0.75, r * 1.25);
      inst.setMatrixAt(i, m.compose(pos, q, scl));
      inst.setColorAt(i, c.setHex(LEAF[(i * 3) % LEAF.length]));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    root.add(inst);
  }
}

/** 轻量确定性随机，保证每次打开地图上植物位置一致 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 建筑材质：墙体纯色，窗洞由几何薄板表现（见 add_windows），不用贴图 */
function material_of(kind, seed = 0) {
  const base = new THREE.Color(KIND_COLOR[kind] ?? 0xc8ccd2);
  const jitter = 0.95 + ((seed * 37) % 11) / 100;
  base.multiplyScalar(jitter);

  if (kind === "water") {
    return new THREE.MeshPhysicalMaterial({
      color: 0x2c5f7e, roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08,
    });
  }
  if (kind === "green" || kind === "plaza") {
    return new THREE.MeshStandardMaterial({ color: base, roughness: 0.95 });
  }

  const wall = new THREE.MeshStandardMaterial({ color: base, roughness: 0.85, metalness: 0.02 });
  const roof = new THREE.MeshStandardMaterial({
    color: base.clone().multiplyScalar(0.72).lerp(new THREE.Color(0x6f7880), 0.35),
    roughness: 0.9,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2b3c4c, roughness: 0.25, metalness: 0.4, envMapIntensity: 1.4,
  });
  const mat = new THREE.MeshStandardMaterial({ color: base });
  mat.userData.wall_mat = wall;
  mat.userData.roof_mat = roof;
  mat.userData.glass_mat = glass;
  return mat;
}

/**
 * 几何窗：沿每面外墙按真实开间（3.3 米）与层高（3.6 米）排布深色窗板。
 * 窗板比墙面外凸 0.04 米，光线下有明暗，近看是窗，远看是窗带。
 * 只在墙高超过一层时布置，且跳过过小的墙段。
 */
function add_windows(group, polygon_px, height_m, glass_mat) {
  const bay = 3.3;
  const floor_h = 3.6;
  const floors = Math.floor((height_m - 1.2) / floor_h);
  if (floors < 1) return;

  const pts = polygon_px.map(([px, py]) => px_to_world(px, py));
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2b3c4c, roughness: 0.25, metalness: 0.4, envMapIntensity: 1.4,
  });

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < bay * 1.5) continue;

    const nx = -dz / len; // 朝外的法线
    const nz = dx / len;
    /* BoxGeometry 的宽边在 X 轴、薄边在 Z 轴。窗板宽边应沿墙，薄边应沿法线，
       所以绕 Y 轴的角度取墙方向（dx, dz）在 X 轴上的投影，而不是 atan2(dx, dz)。 */
    const ang = Math.atan2(-dz, dx);
    const bays = Math.floor(len / bay);
    const step = len / bays;

    for (let f = 0; f < floors; f++) {
      const y = 1.2 + f * floor_h + floor_h / 2;
      for (let k = 0; k < bays; k++) {
        const t = (k + 0.5) / bays;
        const x = a.x + dx * t + nx * 0.02;
        const z = a.z + dz * t + nz * 0.02;
        const win = new THREE.Mesh(new THREE.BoxGeometry(step * 0.62, 1.7, 0.08), glass);
        win.position.set(x, y, z);
        win.rotation.y = ang;
        group.add(win);
      }
    }
  }
}

function extent_of(points_px) {
  const xs = points_px.map((p) => p[0]);
  const ys = points_px.map((p) => p[1]);
  const cx_px = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy_px = (Math.min(...ys) + Math.max(...ys)) / 2;
  const c = px_to_world(cx_px, cy_px);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * MAP.meters_per_px;
  return { cx: c.x, cz: c.z, span: Math.max(40, span * 1.12) };
}

/** 朝向某个像素点所需的偏航角。实体前向是 +Z，故用 atan2(dx, dz) */
function heading_toward(px, py, tx, ty) {
  return Math.atan2(tx - px, ty - py);
}

/** 在建筑旁边找一个可站立的点，返回像素坐标 */
function stand_near(polygon_px) {
  const cx = polygon_px.reduce((a, p) => a + p[0], 0) / polygon_px.length;
  const cy = polygon_px.reduce((a, p) => a + p[1], 0) / polygon_px.length;
  const p = nearest_walkable_px(cx, cy);
  if (p) return p;
  return [cx, cy];
}


/** 多边形内判定，射线法（原名 inside_polygon，与 terrain.js 导出的同名工具区分） */
function point_in_poly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * 屋顶设备：几个小箱体随机落在屋顶，打破平顶的单调。
 * 建筑被道路切过之后可能变成 L 形或三角块，必须逐点判内，
 * 否则箱体会悬在屋顶外面。
 */
function roof_clutter(b, mat) {
  const g = new THREE.Group();
  const xs = b.polygon.map((p) => p[0]);
  const ys = b.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const span = Math.max(x1 - x0, y1 - y0);
  const count = span > 120 ? 3 : 1;
  const unit = new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.7, metalness: 0.3 });

  let placed = 0;
  for (let i = 0; i < count * 4 && placed < count; i++) {
    const px = x0 + 4 + Math.random() * Math.max(1, x1 - x0 - 8);
    const py = y0 + 4 + Math.random() * Math.max(1, y1 - y0 - 8);
    if (!point_in_poly(b.polygon, px, py)) continue;
    const w = px_to_world(px, py);
    const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 2.6), unit);
    box.position.set(w.x, b.height_m + 0.8, w.z);
    box.castShadow = false;
    g.add(box);
    placed++;
  }
  return g;
}

/* ── 校园 ─────────────────────────────────────────────────────────── */

/* 巡检点位：直接挂在实际建筑上，位置真实，不是凭空摆的 */
const CAMPUS_TARGETS = [
  { building: "north_dorm", id: "t-dorm", name: "北区公寓楼 楼道堆物", sev: "warn", cls: "corridor_clutter", model: "yolo11s-seg", action: "标记堆物位置并推送宿管清理" },
  { building: "teaching_1", id: "t-teach", name: "1 号教学楼 消防通道", sev: "warn", cls: "fire_lane", model: "yolo11s-seg", action: "记录占用车辆并语音提示驶离" },
  { building: "library", id: "t-lib", name: "图书馆 出入口人流", sev: "warn", cls: "crowd_density", model: "yolo11s-pose", action: "统计人流并提示分流" },
  { building: "lab_center", id: "t-lab", name: "实验中心 门窗状态", sev: "info", cls: "door_window", model: "yolo11s-cls", action: "记录开闭状态，异常时生成工单" },
  { building: "gym", id: "t-gym", name: "体育馆 设施完好性", sev: "info", cls: "facility", model: "yolo11m-obb", action: "记录设施编号并纳入月度台账" },
  { building: "c1", id: "t-c1", name: "中央院系区 地面破损", sev: "warn", cls: "tile_broken", model: "yolo11s-seg", action: "标记破损范围并提交维修工单" },
  { building: "water_south", id: "t-water", name: "南部水体 水位与漂浮物", sev: "info", cls: "water_level", model: "yolo11s-seg", action: "记录水位刻度，漂浮物超量时告警" },
  { building: "south_green", id: "t-smoke", name: "南区绿地 明火烟雾", sev: "alarm", cls: "smoke_fire", model: "yolo11s-fire", action: "立即高音告警并回传火点坐标" },
];

function build_campus() {
  const root = new THREE.Group();
  root.name = "campus";
  root.add(ground_plane());

  /* 道路：铺在建筑之前加，后面的平地要素与体块都压在规划好的位置 */
  const roads = road_layer();
  if (roads) root.add(roads);

  /* 建筑体块 */
  let bi = 0;
  for (const b of PACKAGE.buildings) {
    if (!b.polygon || b.polygon.length < 3) continue;
    const mat = material_of(b.kind, bi++);

    if (b.height_m <= 0.01) {
      const patch = flat_patch(b.polygon, mat, 0.05);
      patch.name = `bldg:${b.id}`;
      root.add(patch);
    } else {
      const body = extrude(b.polygon, b.height_m, mat);
      body.name = `bldg:${b.id}`;
      root.add(body);
      const clutter = roof_clutter(b, mat);
      clutter.name = `bldg:${b.id}:roof`;
      root.add(clutter);
      const win_group = new THREE.Group();
      win_group.name = `bldg:${b.id}:win`;
      add_windows(win_group, b.polygon, b.height_m, mat.userData.glass_mat);
      root.add(win_group);
    }

    /* 林地与水面上不放树 */
    if (b.kind === "green" || b.kind === "water") continue;
  }

  /* 东山：校园远景。不出场景根，只做视觉层次，不参与寻路与调度 */
  const east = EXTRA.hills.filter((h) => h.side === "east");
  for (const h of east) {
    const m = build_hill(h, { seg: 40 });
    root.add(m);
    const trees = scatter_hill_trees(h, m, { count: 140, seed: 9 + h.id.length });
    if (trees) root.add(trees);
  }

  /* 西山：校园里只做远景，与森林场景共用同一份地形数据。
     不再用旧的绿色矩形占位，那块与真实山形无关 */
  const west = EXTRA.hills.filter((h) => h.side === "west");
  for (const h of west) {
    const m = build_hill(h, { seg: 44 });
    root.add(m);
    const trees = scatter_hill_trees(h, m, { count: 120, seed: 5 + h.id.length });
    if (trees) root.add(trees);
  }

  /* 行道树与灌木：点位在 Python 里按「离路沿 2.2~4.2 米、避开建筑」算好 */
  if (PACKAGE.roads) street_trees(root, PACKAGE.roads.trees, PACKAGE.roads.bushes);

  /* 行人：沿校园道路走，人自然出现在路上而不是草地中央。
     不给 center，让 Crowd 自己在可走网格里找落脚点。 */
  root.add(
    new Crowd({
      scene_id: "campus",
      nav_kind: "road",
      count: 18,
      seed: 20261106,
      radius_px: 220,
    }).build()
  );

  /* 巡检点位 */
  const targets = [];
  for (const t of CAMPUS_TARGETS) {
    const b = PACKAGE.buildings.find((x) => x.id === t.building);
    if (!b) continue;
    const stand = stand_near(b.polygon);
    const c = b.polygon.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map((v) => v / b.polygon.length);
    targets.push({
      id: t.id,
      name: t.name,
      sev: t.sev,
      cls: t.cls,
      model: t.model,
      action: t.action,
      x: c[0],
      y: c[1],
      stand_x: stand[0],
      stand_y: stand[1],
      height: Math.max(1.2, b.height_m * 0.55),
    });
  }

  /* 站位：用最远点采样撒开，四台设备分散在不同区域。
     机器狗用 all 网格（哪都能去），人形机器人用 road 网格（只走马路）。 */
  const campus_poly = PACKAGE.zones.campus.polygon;
  const ccx = campus_poly.reduce((a, p) => a + p[0], 0) / campus_poly.length;
  const ccy = campus_poly.reduce((a, p) => a + p[1], 0) / campus_poly.length;

  const to_spawn = ([x, y]) => ({ x, y, heading: heading_toward(x, y, ccx, ccy) });
  const dog_nav = nav_for("campus", "all");
  const road_nav = nav_for("campus", "road");

  const spawns = spread_spots(dog_nav, 4, 230).map(to_spawn);
  const road_spawns = spread_spots(road_nav, 3, 180).map(to_spawn);
  if (!spawns.length) spawns.push({ x: ccx, y: ccy, heading: Math.PI });
  if (!road_spawns.length) road_spawns.push(...spawns);

  /* 自动巡检的航点：沿道路取样，人形与狗共用 */
  const patrol_points = spread_spots(road_nav, 10, 120);

  return {
    root,
    targets,
    spawns,
    road_spawns,
    patrol_points,
    extent: extent_of(campus_poly),
    env: big_env(),
    name: "校园",
    title: "校园安全与设施巡检",
  };
}

/** 大场地用的环境参数：雾拉远、阴影关闭（几百米范围内阴影贴图会糊成一片） */
function big_env() {
  return {
    env: "city",
    sky: 0xa9c4da,
    fogNear: 700,
    fogFar: 2400,
    sunColor: 0xffe9c8,
    sunInt: 2.9,
    hemiSky: 0xcfe2f2,
    hemiGround: 0x6b6a5c,
    hemiInt: 1.05,
    sunPos: [160, 260, 180],
    exposure: 1.0,
    shadows: false,
  };
}

/** 在给定多边形内部撒树。clear 为需要留空的像素坐标点，radius 单位米 */
function add_trees(root, polygon_px, count, scale = 1, clear = [], radius = 8) {
  const xs = polygon_px.map((p) => p[0]);
  const ys = polygon_px.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);

  /* 点在多边形内判定，用射线法 */
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = polygon_px.length - 1; i < polygon_px.length; j = i++) {
      const [xi, yi] = polygon_px[i];
      const [xj, yj] = polygon_px[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const x = x0 + Math.random() * (x1 - x0);
    const y = y0 + Math.random() * (y1 - y0);
    if (!inside(x, y)) continue;
    if (clear.some(([cxp, cyp]) => Math.hypot(x - cxp, y - cyp) < radius / MAP.meters_per_px)) continue;
    const w = px_to_world(x, y);
    const t = K.tree({ h: (5 + Math.random() * 4) * scale, r: 0.2 * scale, kind: Math.random() > 0.45 ? "broad" : "conifer" });
    t.position.set(w.x, 0, w.z);
    root.add(t);
    placed++;
  }
}

/** 出生点朝向微调，两台设备不完全平行 */
function theme_heading(h) {
  return (h ?? Math.PI) + 0.18;
}

/* ── 小区 ─────────────────────────────────────────────────────────── */

/**
 * 折线加宽成路面多边形。
 * 道路数据只给中心线与宽度，这里按每段的法线向两侧推，拐角处直接相连。
 * 拐点不做斜接，直接在两侧各自连点，角度不大的小区路看不出缺口。
 */
function ribbon_polygon(points_px, width_m, closed = false) {
  const hw = width_m / 2 / MAP.meters_per_px; // 像素半宽
  const pts = points_px.map(([px, py]) => ({ x: px, y: py }));

  const left = [];
  const right = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;

  for (let i = 0; i < n; i++) {
    /* 每个顶点的方向取前后两段的平均，拐角才不会被切掉 */
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const nx = -dy * hw;
    const ny = dx * hw;
    left.push([pts[i].x + nx, pts[i].y + ny]);
    right.push([pts[i].x - nx, pts[i].y - ny]);
  }

  /* 左边正序 + 右边倒序，围成一个封闭环 */
  return left.concat(right.reverse());
}

/**
 * 把一组环状顶点夹回多边形内部。
 * 对每个落在界外的点，沿多边形最近的那条边求一个内侧附近点，
 * 再退 0.6 米，保证裁出来紧贴边界又不越界。
 */
function clamp_ring_to_poly(ring, poly) {
  return ring.map(([px, py]) => {
    if (point_in_poly(poly, px, py)) return [px, py];

    /* 找最近的边 */
    let best = null;
    let best_d = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = a[0] + dx * t;
      const qy = a[1] + dy * t;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best_d) {
        best_d = d;
        best = { qx, qy, dx, dy, L: Math.sqrt(L2) || 1 };
      }
    }
    if (!best) return [px, py];

    /* 沿边法线往内退 0.6 米。法线方向取「点 → 边」的反向，再用中心点判内修正 */
    const nx = -best.dy / best.L;
    const ny = best.dx / best.L;
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const s = (cx - best.qx) * nx + (cy - best.qy) * ny > 0 ? 1 : -1;
    return [best.qx + nx * s * 0.6 / MAP.meters_per_px, best.qy + ny * s * 0.6 / MAP.meters_per_px];
  });
}

function build_community() {
  const root = new THREE.Group();
  root.name = "community";

  const C = EXTRA.community;
  if (!C) return build_community_fallback();

  const poly = PACKAGE.zones.community.polygon;

  root.add(ground_plane());

  /* 场地铺装：比校园暗一档，小区是沥青路 + 草坪，不是铺装广场 */
  const ground_mat = new THREE.MeshStandardMaterial({ color: 0x737870, roughness: 0.95 });
  root.add(flat_patch(poly, ground_mat, 0.05));

  /* 草地：环路以内除道路外的部分 */
  const lawn_mat = new THREE.MeshStandardMaterial({ color: 0x4d6b3a, roughness: 1 });
  root.add(flat_patch(poly, lawn_mat, 0.055));

  /* 道路：黑沥青路面。小区里不画白边线：场地尺度小，
     白边在这块 200 米的场地上过粗，反而像画框。 */
  const asphalt = asphaltTex();
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(0.42, 0.42);
  asphalt.anisotropy = 8;
  const road_mat = new THREE.MeshStandardMaterial({
    map: asphalt, color: 0x44474c, roughness: 0.93, metalness: 0.02, envMapIntensity: 0.5,
  });
  road_mat.polygonOffset = true;
  road_mat.polygonOffsetFactor = -2;
  road_mat.polygonOffsetUnits = -2;

  for (const r of C.roads) {
    /* 路面与边线都裁进小区轮廓：环路是按内接矩形算的，
       但拐角斜接会向外鼓出几米，直接画会落到场地外的黑色背景上。
       这里把每个顶点夹回轮廓内（沿多边形最近边取内侧点）。 */
    const face = clamp_ring_to_poly(ribbon_polygon(r.points, r.width_m, r.closed), poly);
    root.add(flat_patch(face, road_mat, 0.15));
  }

  /* 住宅楼：数据里的矩形直接挤出，窗户沿用校园那套几何排布 */
  const targets = [];
  C.buildings.forEach((b, i) => {
    if (!b.polygon || b.polygon.length < 3) return;
    const mat = material_of("residential", i);
    const body = extrude(b.polygon, b.height_m, mat);
    root.add(body);
    const win_group = new THREE.Group();
    add_windows(win_group, b.polygon, b.height_m, mat.userData.glass_mat);
    root.add(win_group);

    /* 单元门口的道具：电动车与杂物，正好对上巡检任务 */
    const cx = b.polygon.reduce((a, p) => a + p[0], 0) / b.polygon.length;
    const cy = b.polygon.reduce((a, p) => a + p[1], 0) / b.polygon.length;
    const door = px_to_world(cx, cy + 9);
    const ebike = K.ebike(0x2f3a44);
    ebike.position.set(door.x, 0, door.z);
    ebike.rotation.y = (i % 4) * 0.6;
    root.add(ebike);
  });

  /* 车棚：简易顶棚 + 四根柱 */
  if (C.shed && C.shed.polygon && C.shed.in_zone !== false) {
    const shed = C.shed;
    const sx = shed.polygon.reduce((a, p) => a + p[0], 0) / shed.polygon.length;
    const sy = shed.polygon.reduce((a, p) => a + p[1], 0) / shed.polygon.length;
    const sw = px_to_world(sx, sy);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.25, 5),
      new THREE.MeshStandardMaterial({ color: 0x5f6a72, roughness: 0.7, metalness: 0.35 })
    );
    roof.position.set(sw.x, shed.height_m, sw.z);
    roof.castShadow = false;
    root.add(roof);
    const post_mat = new THREE.MeshStandardMaterial({ color: 0x8b9299, roughness: 0.6, metalness: 0.4 });
    for (const [dx, dz] of [[-10, -2], [10, -2], [-10, 2], [10, 2]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, shed.height_m, 0.16), post_mat);
      post.position.set(sw.x + dx, shed.height_m / 2, sw.z + dz);
      root.add(post);
    }
    /* 棚下停一排车 */
    for (let i = 0; i < 6; i++) {
      const c = K.car({ color: [0xb9bec4, 0x2f3a44, 0x8a3b2f][i % 3], type: "sedan" });
      c.position.set(sw.x - 8 + i * 3.1, 0, sw.z + 0.6);
      c.rotation.y = Math.PI / 2;
      root.add(c);
    }
  }

  /* 大门道闸：横杆 + 立柱，正对中轴路 */
  if (C.gate) {
    const g = px_to_world(C.gate.x, C.gate.y);
    const post_mat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), post_mat);
    post.position.set(g.x, 0.55, g.z);
    root.add(post);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 5.5),
      new THREE.MeshStandardMaterial({ color: 0xd8452f, roughness: 0.55 })
    );
    bar.position.set(g.x, 1.05, g.z - 2.6);
    root.add(bar);
  }

  /* 行道树：沿环路内外侧手动排，密度比校园稀 */
  const rng = mulberry32(20261105);
  const ring_road = C.roads[0];
  if (ring_road) {
    const pts = ring_road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const L = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.floor(L / 26);
      for (let k = 0; k <= steps; k++) {
        const t = steps ? k / steps : 0;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        const nx = -(y2 - y1) / (L || 1);
        const ny = (x2 - x1) / (L || 1);
        for (const side of [-1, 1]) {
          const tx = px + nx * 5.2 * side;
          const ty = py + ny * 5.2 * side;
          if (!point_in_poly(poly, tx, ty)) continue;
          const w = px_to_world(tx, ty);
          const t = K.tree({ h: 5.5 + rng() * 2.5, r: 0.2, kind: "broad" });
          t.position.set(w.x, 0, w.z);
          root.add(t);
        }
      }
    }
  }

  /* 巡检点位：挂在真实楼栋上 */
  const NAMES = [
    ["单元门前 电动车入楼", "ebike_indoor", "alarm"],
    ["楼道口 杂物堆放", "corridor_clutter", "warn"],
    ["防火门 开启状态", "fire_door", "warn"],
    ["车棚 充电线路", "charging_risk", "alarm"],
    ["主干道 车辆占道", "obstacle", "warn"],
    ["垃圾分类点 满溢", "litter", "info"],
  ];

  /* 行人：在小区环路与中轴上走动 */
  root.add(
    new Crowd({
      scene_id: "community",
      nav_kind: "road",
      count: 10,
      seed: 20261107,
      radius_px: 90,
    }).build()
  );

  /* 单元门前的人群：有电动车入楼告警，楼下就该有人 */
  const first = C.buildings[0];
  if (first) {
    const fx = first.polygon.reduce((a, p) => a + p[0], 0) / first.polygon.length;
    const fy = first.polygon.reduce((a, p) => a + p[1], 0) / first.polygon.length;
    root.add(crowd_cluster({ center_px: [fx, fy + 16], count: 5, seed: 71, radius_px: 10 }));
  }

  C.buildings.slice(0, 4).forEach((b, i) => {
    const cx = b.polygon.reduce((a, p) => a + p[0], 0) / b.polygon.length;
    const cy = b.polygon.reduce((a, p) => a + p[1], 0) / b.polygon.length;
    const [name, cls, sev] = NAMES[i % NAMES.length];
    targets.push({
      id: `t-cm-${i + 1}`,
      name,
      sev,
      cls,
      model: cls === "charging_risk" ? "yolo11s-seg" : "yolo11s-pose",
      action:
        cls === "ebike_indoor"
          ? "语音劝阻并推送物业，记录车辆特征"
          : cls === "charging_risk"
          ? "断电并推送隐患工单"
          : "拍照留存并生成处置工单",
      x: cx,
      y: cy,
      stand_x: cx,
      stand_y: cy + 12,
      height: 2.2,
    });
  });

  /* 出生点：分散在环形路与中轴上。狗用 all，人形用 road。 */
  const fc = C.frame.origin;
  const to_spawn = ([x, y]) => ({ x, y, heading: heading_toward(x, y, fc[0], fc[1]) });
  const spawns = spread_spots(nav_for("community", "all"), 2, 70).map(to_spawn);
  const road_spawns = spread_spots(nav_for("community", "road"), 2, 60).map(to_spawn);

  if (!spawns.length) spawns.push({ x: fc[0], y: fc[1], heading: Math.PI });
  if (!road_spawns.length) road_spawns.push(...spawns);

  const patrol_points = spread_spots(nav_for("community", "road"), 6, 26);

  return {
    root, targets, spawns, road_spawns, patrol_points,
    extent: extent_of(poly),
    env: big_env(),
    name: "小区",
    title: "小区安全与秩序巡检",
  };
}

/** 数据包缺小区数据时的兜底：保持旧行为，不至于打不开 */
function build_community_fallback() {
  const root = new THREE.Group();
  root.name = "community";
  const zone = PACKAGE.zones.community;
  const poly = zone.polygon;
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;

  root.add(ground_plane());
  const ground_mat = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.95 });
  root.add(flat_patch(poly, ground_mat, 0.05));

  const targets = [];
  const spawns = [];
  for (let i = 0; i < 3; i++) {
    const bx = cx + (i - 1) * 26;
    const by = cy - 10;
    const g = building_block(34, 16, 21, 0xdcd6ca);
    const wp = px_to_world(bx, by);
    g.position.set(wp.x, 0, wp.z);
    root.add(g);
    targets.push({
      id: `t-cm-${i + 1}`,
      name: ["东单元 电动车入楼", "中单元 楼道堆物", "西单元 防火门开启"][i],
      sev: i === 0 ? "alarm" : "warn",
      cls: "ebike_indoor",
      model: "yolo11s-seg",
      action: "语音劝阻并推送物业，记录车辆特征",
      x: bx, y: by, stand_x: bx, stand_y: by + 16, height: 3,
    });
  }
  for (const [dx, dy] of [[-30, 26], [0, 30], [30, 26], [0, 0]]) {
    spawns.push({ x: cx + dx, y: cy + dy, heading: Math.PI });
  }

  return {
    root, targets, spawns,
    extent: extent_of(poly),
    env: big_env(),
    name: "小区",
    title: "小区安全与秩序巡检",
  };
}

function building_block(w, d, h, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = h / 2;
  m.receiveShadow = true;
  return m;
}

/* ── 森林 ─────────────────────────────────────────────────────────── */

function build_forest() {
  const root = new THREE.Group();
  root.name = "forest";

  const F = EXTRA.forest;
  const hill = F ? EXTRA.hills.find((h) => h.id === F.hill_id) : null;

  root.add(ground_plane());

  /* 山体：起伏地形，山脚压到 0 与地面接上。
     巡检空地所在范围压平，否则地形会从空地底下顶起来把地面埋掉 */
  let hill_mesh = null;
  const clearing = F ? F.clearing : PACKAGE.zones.forest.polygon;
  const smooth = F ? F.flatten_smooth ?? 26 : 18;
  if (hill) {
    hill_mesh = build_hill(hill, { seg: 64, flatten: [clearing], flatten_smooth: smooth });
    root.add(hill_mesh);
    const trees = scatter_hill_trees(hill, hill_mesh, { count: 260, seed: 31 });
    if (trees) root.add(trees);
  }

  /* 山脚巡检空地：平缓的一小片，机器狗在这里跑与扫描 */
  const grass = new THREE.MeshStandardMaterial({ color: 0x4a6b38, roughness: 1 });
  root.add(flat_patch(clearing, grass, 0.08));

  const cx = clearing.reduce((a, p) => a + p[0], 0) / clearing.length;
  const cy = clearing.reduce((a, p) => a + p[1], 0) / clearing.length;

  /* 空地边缘补一圈灌木，界定场地范围，也挡住山脚的断边 */
  const rng = mulberry32(20261105);
  const edge = [];
  for (let i = 0; i < clearing.length; i++) {
    const [x1, y1] = clearing[i];
    const [x2, y2] = clearing[(i + 1) % clearing.length];
    const L = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.floor(L / 4.5);
    for (let k = 0; k <= steps; k++) {
      const t = steps ? k / steps : 0;
      edge.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  }
  for (const [px, py] of edge) {
    const w = px_to_world(px, py);
    const b = K.bush(0.34 + rng() * 0.26);
    b.position.set(w.x, 0.14, w.z);
    root.add(b);
  }

  /* 空地外围再撒一圈乔木，形成林缘 */
  add_trees(root, clearing, 26, 1.1, [[cx, cy], [cx, cy + 20]], 16);

  /* 行人：林间空地散步的人 */
  root.add(
    new Crowd({
      scene_id: "forest",
      nav_kind: "all",
      count: 6,
      seed: 20261108,
      center: [cx, cy],
      radius_px: 30,
    }).build()
  );

  const fx = cx - 22;
  const fz = cy - 16;
  const targets = [
    { id: "t-f-fire", name: "林区 明火烟雾", sev: "alarm", cls: "smoke_fire", model: "yolo11s-fire",
      action: "立即高音告警并回传火点坐标", x: fx, y: fz, stand_x: fx, stand_y: fz + 14, height: 1.4 },
    { id: "t-f-trash", name: "林间 垃圾堆放", sev: "warn", cls: "litter", model: "yolo11s-seg",
      action: "标记清理点位并通知保洁", x: cx + 26, y: cy - 8, stand_x: cx + 26, stand_y: cy + 8, height: 0.8 },
    { id: "t-f-pest", name: "树干虫害", sev: "warn", cls: "pest", model: "yolo11s-cls",
      action: "采集近景样本并定位病株坐标", x: cx + 12, y: cy + 26, stand_x: cx + 12, stand_y: cy + 40, height: 2.2 },
  ];

  /* 火点冒烟，让远处也能看见告警位置。fireFlame 自带火苗与余烬动画 */
  const fire_pt = px_to_world(fx, fz);
  const smoke = K.smokePlume({ rate: 12, size: 1.1, rise: 1.8 });
  smoke.position.set(fire_pt.x, 0.5, fire_pt.z);
  root.add(smoke);
  const flame = K.fireFlame({ size: 0.8 });
  flame.position.set(fire_pt.x, 0.1, fire_pt.z);
  root.add(flame);

  /* 出生点：站在空地东南侧，面朝西山，第一人称一开就是山坡 */
  const site = F && F.site ? F.site : { x: cx, y: cy + 34, heading: Math.PI };
  const spawns = [
    { x: site.x, y: site.y, heading: site.heading ?? Math.PI },
    { x: site.x - 18, y: site.y + 6, heading: theme_heading(site.heading) },
  ];

  /* 自动巡检航点：空地上取四个角，狗会自己绕着场地走 */
  const fx0 = Math.min(...clearing.map((p) => p[0]));
  const fx1 = Math.max(...clearing.map((p) => p[0]));
  const fy0 = Math.min(...clearing.map((p) => p[1]));
  const fy1 = Math.max(...clearing.map((p) => p[1]));
  const patrol_points = [
    [fx0 + 12, fy0 + 12], [fx1 - 12, fy0 + 12],
    [fx1 - 12, fy1 - 12], [fx0 + 12, fy1 - 12],
    [(fx0 + fx1) / 2, (fy0 + fy1) / 2],
  ];

  return {
    root, targets, spawns, road_spawns: spawns, patrol_points,
    extent: extent_of(clearing.map((p) => p).concat(hill ? hill.polygon : [])),
    env: {
      env: "forest",
      sky: 0x8fb4d4,
      fogNear: 160,
      fogFar: 640,
      sunColor: 0xfff2d6,
      sunInt: 2.5,
      hemiSky: 0xcfe3f5,
      hemiGround: 0x33481f,
      hemiInt: 1.0,
      sunPos: [70, 150, 80],
      exposure: 1.0,
      shadows: false,
    },
    name: "森林",
    title: "森林防火与林木巡检",
  };
}

/* ── 地铁站 ───────────────────────────────────────────────────────── */

/**
 * 地铁站：站厅 + 岛式站台 + 双线轨道 + 进出站列车。
 *
 * 几何口径（scene_extra.json 的 subway 段）：
 *   站厅  185 × 47 米，净高 6 米
 *   站台  居中，宽 12 米，抬高 0.9 米，两端距墙 6 米设停止线
 *   轨道  站台两侧各一条，轨距 1435 毫米
 *   列车  6 节编组，周期 30 秒，停站 8 秒
 *
 * 列车动画注册在场景自己的 ticker 上，切走后不再执行。
 */
function build_subway() {
  const root = new THREE.Group();
  root.name = "subway";

  const S = EXTRA.subway;
  const brown = PACKAGE.zones.subway.polygon;

  const xs = brown.map((p) => p[0]);
  const ys = brown.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = (x1 - x0) * MAP.meters_per_px;
  const d = (y1 - y0) * MAP.meters_per_px;
  const cw = px_to_world(cx, cy);

  const H = S ? S.hall.height_m : 6.0;
  const plat_w = S ? S.platform.width_m : 12.0;
  const plat_h = S ? S.platform.height_m : 0.9;
  const track_w = S ? S.track.width_m : 4.4;

  /* 站厅地坪 */
  const floor_mat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.7 });
  root.add(flat_patch(brown, floor_mat, 0.06));

  /* 轨行区：两条深色带铺在站厅地面上。真实地铁的轨面低于站台，
     这里没有做地面挖洞，改为把轨道带抬到地面之上几厘米：
     从站台边缘俯视时，视觉上仍是「站台高、轨道低」，画面成立即可。
     若日后要做真正的下沉槽，需要在地坪多边形上挖洞。 */
  const track_mat = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.95 });
  const track_z_off = plat_w / 2 + track_w / 2;
  for (const sign of [-1, 1]) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, track_w), track_mat);
    bed.position.set(cw.x, 0.09, cw.z + sign * track_z_off);
    root.add(bed);

    /* 钢轨：两条，按 1435 毫米轨距分 */
    const rail_mat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.32, metalness: 0.88 });
    for (const rs of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(w, S ? S.track.rail_h_m : 0.16, 0.09),
        rail_mat
      );
      rail.position.set(cw.x, 0.16, cw.z + sign * track_z_off + rs * 0.72);
      root.add(rail);
    }

    /* 轨枕：实例化 */
    const sleeper_step = S ? S.track.sleep_step_m : 1.3;
    const n_sleep = Math.floor(w / sleeper_step);
    if (n_sleep > 0) {
      const sleeper_geo = new THREE.BoxGeometry(0.24, 0.1, track_w * 0.82);
      const sleeper_mat = new THREE.MeshStandardMaterial({ color: 0x6e5f52, roughness: 0.95 });
      const inst = new THREE.InstancedMesh(sleeper_geo, sleeper_mat, n_sleep);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n_sleep; i++) {
        m.makeTranslation(
          cw.x - w / 2 + (i + 0.5) * sleeper_step,
          0.13,
          cw.z + sign * track_z_off
        );
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      root.add(inst);
    }
  }

  /* 岛式站台本体 */
  const plat_mat = new THREE.MeshStandardMaterial({ color: 0xb9bfc6, roughness: 0.82 });
  const plat_len = w - 12;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(plat_len, plat_h, plat_w), plat_mat);
  platform.position.set(cw.x, plat_h / 2, cw.z);
  platform.receiveShadow = true;
  root.add(platform);

  /* 站台边缘：黄色安全线 + 盲道 */
  const band = S ? S.platform.edge_band_m : 1.2;
  const tactile = S ? S.platform.tactile_m : 0.5;
  const yellow_mat = new THREE.MeshStandardMaterial({ color: 0xe8b81c, roughness: 0.62 });
  const tactile_mat = new THREE.MeshStandardMaterial({ color: 0xd9c274, roughness: 0.9 });
  for (const sign of [-1, 1]) {
    const y_line = new THREE.Mesh(new THREE.BoxGeometry(plat_len, 0.03, band), yellow_mat);
    y_line.position.set(cw.x, plat_h + 0.015, cw.z + sign * (plat_w / 2 - band / 2));
    root.add(y_line);

    const t_line = new THREE.Mesh(new THREE.BoxGeometry(plat_len, 0.04, tactile), tactile_mat);
    t_line.position.set(cw.x, plat_h + 0.02, cw.z + sign * (plat_w / 2 - band - tactile / 2 - 0.3));
    root.add(t_line);
  }

  /* 停止线：站台两端各一道，横向贯穿站台，列车停车位以此为准 */
  const stop_from_end = S ? S.platform.stop_line_from_end_m : 6.0;
  const stop_mat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.7 });
  const stop_w = S ? S.platform.stop_line_m : 0.25;
  for (const sign of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(stop_w, 0.03, plat_w), stop_mat);
    line.position.set(cw.x + sign * (plat_len / 2 - stop_from_end), plat_h + 0.02, cw.z);
    root.add(line);
  }

  /* 后墙、两侧墙、顶棚 */
  const wall_mat = new THREE.MeshStandardMaterial({ color: 0xc3cad2, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.8), wall_mat);
  const bw = px_to_world(cx, y0 + 2);
  back.position.set(bw.x, H / 2, bw.z);
  root.add(back);

  for (const sx of [x0, x1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.8, H, d), wall_mat);
    const sw = px_to_world(sx, cy);
    side.position.set(sw.x, H / 2, sw.z);
    root.add(side);
  }

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.5, d),
    new THREE.MeshStandardMaterial({ color: 0xe4e9ee, roughness: 0.85 })
  );
  ceiling.position.set(cw.x, H + 0.25, cw.z);
  root.add(ceiling);

  /* 立柱与吊灯：站台中线上，间距 20 米 */
  const pillar_mat = new THREE.MeshStandardMaterial({ color: 0xd0d6dd, roughness: 0.75 });
  const lamp_mat = new THREE.MeshStandardMaterial({
    color: 0xfff6e2, emissive: new THREE.Color(0xfff0cc), emissiveIntensity: 1.4, roughness: 0.6,
  });
  const n_pillar = Math.floor(plat_len / 20);
  for (let i = 0; i <= n_pillar; i++) {
    const x = cw.x - plat_len / 2 + 4 + i * 20;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, H - plat_h, 12), pillar_mat);
    p.position.set(x, plat_h + (H - plat_h) / 2, cw.z);
    root.add(p);

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.6), lamp_mat);
    lamp.position.set(x, H - 0.5, cw.z);
    root.add(lamp);

    /* 每三根柱一盏实时点光，全开太贵 */
    if (i % 3 === 0) {
      const light = new THREE.PointLight(0xffeccc, 22, 42, 2);
      light.position.set(x, H - 1.0, cw.z);
      root.add(light);
    }
  }

  /* 站名灯箱，贴在站台正中的立柱旁 */
  const sign_tex = sign_tex_of("嘉陵江路");
  if (sign_tex) {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 1.1, 0.12),
      new THREE.MeshStandardMaterial({ map: sign_tex, roughness: 0.6, emissive: 0x222222, emissiveMap: sign_tex, emissiveIntensity: 0.6 })
    );
    sign.position.set(cw.x, plat_h + 2.6, cw.z - plat_w / 2 + 0.4);
    root.add(sign);
  }

  /* 列车：两条轨道各开一列，错开半个周期，画面一直有车 */
  if (S) build_trains(root, S, cw, plat_len, d);

  /* 乘客：站台上等车的人。站台只有 12 米宽，人群沿长轴排开 */
  const plat_cx_px = cx;
  const plat_cy_px = cy;
  root.add(
    new Crowd({
      scene_id: "subway",
      nav_kind: "all",
      count: 14,
      seed: 20261109,
      center: [plat_cx_px, plat_cy_px],
      radius_px: plat_len / 2 / MAP.meters_per_px * 0.8,
      /* 站台抬高 0.9 米，乘客也要抬上去，否则腿埋在台面里只剩上半身 */
      floor_y: plat_h,
    }).build()
  );

  /* 巡检点全部用像素坐标（接口约定），这里按站台长度换算 */
  const px_plat_half = plat_len / 2 / MAP.meters_per_px;
  const targets = [
    { id: "t-m-fire", name: "站台 明火烟雾", sev: "alarm", cls: "smoke_fire", model: "yolo11s-fire",
      action: "即时语音制止并推送站务",
      x: cx - px_plat_half * 0.62, y: cy - 6, stand_x: cx - px_plat_half * 0.62, stand_y: cy - 1, height: 1.4 },
    { id: "t-m-density", name: "站厅 人员密度", sev: "warn", cls: "crowd_density", model: "yolo11s-pose",
      action: "语音提示分流，联动站务引导乘客",
      x: cx + 4, y: cy + 2, stand_x: cx + 4, stand_y: cy + 7, height: 1.6 },
    { id: "t-m-luggage", name: "通道 行李杂物", sev: "warn", cls: "obstacle", model: "yolo11s-seg",
      action: "标记位置并通知站务清理",
      x: cx + px_plat_half * 0.66, y: cy - 4, stand_x: cx + px_plat_half * 0.66, stand_y: cy + 1, height: 1.0 },
  ];

  /* 两台设备站在站台两端，面朝彼此，第一人称一开就是站台纵深。
     站台有 0.9 米高差，设备活动范围只给站台面，不能下到轨道。 */
  const spawns = [
    { x: cx - px_plat_half * 0.78, y: cy, heading: Math.PI / 2 },
    { x: cx + px_plat_half * 0.78, y: cy, heading: -Math.PI / 2 },
  ];
  const patrol_points = [
    [cx - px_plat_half * 0.7, cy],
    [cx - px_plat_half * 0.2, cy],
    [cx + px_plat_half * 0.2, cy],
    [cx + px_plat_half * 0.7, cy],
  ];

  return {
    root, targets, spawns, road_spawns: [spawns[1], spawns[0]], patrol_points,
    /* 站台抬高 0.9 米，设备站在台面上 */
    floor_y: plat_h,
    extent: extent_of(brown),
    env: {
      env: "indoor",
      sky: 0x22272d,
      fogNear: 70,
      fogFar: 340,
      sunColor: 0xfff0d2,
      sunInt: 0.5,
      hemiSky: 0xdce6f0,
      hemiGround: 0x4a5057,
      hemiInt: 1.5,
      sunPos: [40, 90, 30],
      exposure: 1.1,
      shadows: false,
    },
    name: "地铁",
    title: "地铁站安全与设备巡检",
  };
}

function sign_tex_of(text) {
  try {
    return signTex(text, { w: 512, h: 96, bg: "#12365c", fg: "#ffffff" });
  } catch (e) {
    return null;
  }
}

/**
 * 进出站列车。
 *
 * 一条时间的相位函数决定列车位置：周期 cycle_s，其中一段用于进站减速、
 * 中段停车 dwell_s、末段加速出站。速度用分段线性积分，位置连续、加减速可见。
 * 两列车的相位差半个周期，画面里总有一列在动。
 *
 * 动画走 addTick，会被 engine 捕获为该场景私有，切到别的场景就停，不占 CPU。
 */
function build_trains(root, S, cw, plat_len, hall_d) {
  const T = S.train;
  const car_len = T.car_len_m;
  const gap = T.car_gap_m;
  const train_len = T.cars * car_len + (T.cars - 1) * gap;
  const half_run = T.approach_m / 2 + train_len / 2;

  /* 一条轨道一列，两列车对开：0 号轨向东，1 号轨向西。
     早期两列都从西往东开，看起来像同一条线跑两趟。 */
  for (let line = 0; line < 2; line++) {
    const sign = line === 0 ? -1 : 1;
    const dir = line === 0 ? 1 : -1;   // 行驶方向
    const train = make_train(T, line === 0 ? 0xdfe3e8 : 0xe6e9ee);
    const z_off = sign * (S.platform.width_m / 2 + S.track.width_m / 2);
    /* 车底贴轨面：轨面 0.16 米，车体从这之上开始。
       z 必须加上站厅中心的 cw.z，否则两列车会停在图幅原点附近而不是轨道上 */
    train.position.set(0, 0.18, cw.z + z_off);
    /* 反向行驶的车头朝另一侧 */
    if (dir < 0) train.rotation.y = Math.PI;
    root.add(train);

    const phase = line * 0.5;
    train.position.x = cw.x - half_run;

    K.addTick((t) => {
      const u = ((t / T.cycle_s) + phase) % 1;
      const x = train_x(u, T, half_run, cw.x);
      /* 反向：位置以站厅中心镜像，车头方向也已经转过来 */
      train.position.x = dir > 0 ? x : 2 * cw.x - x;
    });
  }
}

/**
 * 归一化周期 → 列车位置（世界 x，列车编组中心）。
 * u 在 [0, 1)：
 *   0    ~ a  进站减速，从 cx - half_run 到 cx（车组中心停在站台中心）
 *   a    ~ b  停站，位置保持 cx
 *   b    ~ 1  加速出站，到 cx + half_run
 */
function train_x(u, T, half_run, cx) {
  /* 时间分配：进站 35%、停车 dwell/cycle、出站余下 */
  const a = 0.35;
  const b = a + T.dwell_s / T.cycle_s;

  if (u < a) {
    /* 减速：缓出曲线，末段速度趋近 0 */
    const k = u / a;
    return cx - half_run + half_run * (1 - (1 - k) * (1 - k));
  }
  if (u < b) {
    return cx;
  }
  const k = (u - b) / Math.max(0.001, 1 - b);
  return cx + half_run * (k * k);
}

/** 一列车：车头 + 若干车厢，车厢带窗带、门与车顶空调 */
function make_train(T, body_color) {
  const g = new THREE.Group();
  const gap = T.car_gap_m;
  const total = T.cars * T.car_len_m + (T.cars - 1) * gap;

  const body_mat = new THREE.MeshStandardMaterial({
    color: body_color, roughness: 0.38, metalness: 0.28, envMapIntensity: 1.5,
  });
  const glass_mat = new THREE.MeshStandardMaterial({ color: 0x1b2a36, roughness: 0.15, metalness: 0.6, envMapIntensity: 1.6 });
  const stripe_mat = new THREE.MeshStandardMaterial({ color: 0x1f6fa8, roughness: 0.5, metalness: 0.2 });
  const door_mat = new THREE.MeshStandardMaterial({ color: 0x2a6fb0, roughness: 0.48, metalness: 0.25 });
  const roof_mat = new THREE.MeshStandardMaterial({ color: 0xa9b0b7, roughness: 0.7, metalness: 0.3 });

  for (let i = 0; i < T.cars; i++) {
    const x = -total / 2 + T.car_len_m / 2 + i * (T.car_len_m + gap);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(T.car_len_m, T.height_m, T.width_m),
      body_mat
    );
    body.position.set(x, T.height_m / 2, 0);
    g.add(body);

    /* 侧窗带：连续的一条深色玻璃，比逐窗做省得多 */
    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(T.car_len_m * 0.82, 1.15, 0.06),
        glass_mat
      );
      win.position.set(x, T.height_m * 0.66, s * (T.width_m / 2 + 0.01));
      g.add(win);

      /* 腰线：一条贯穿的配色带，深色车身上才看得出是列车 */
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(T.car_len_m * 0.96, 0.42, 0.05),
        stripe_mat
      );
      band.position.set(x, T.height_m * 0.34, s * (T.width_m / 2 + 0.02));
      g.add(band);

      /* 车门：两处，浅色板 */
      for (const dk of [-0.28, 0.28]) {
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, T.height_m * 0.78, 0.05),
          door_mat
        );
        door.position.set(x + dk * T.car_len_m, T.height_m * 0.42, s * (T.width_m / 2 + 0.03));
        g.add(door);
      }
    }

    /* 车顶空调与受电弓 */
    const ac = new THREE.Mesh(new THREE.BoxGeometry(T.car_len_m * 0.36, 0.34, T.width_m * 0.62), roof_mat);
    ac.position.set(x, T.height_m + 0.17, 0);
    g.add(ac);
    if (i === 1) {
      const panto = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), roof_mat);
      panto.position.set(x, T.height_m + 0.42, 0);
      g.add(panto);
    }
  }

  /* 车头灯：两节端车各一对，加一点自发光便于暗处看见 */
  const head_mat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xfff0cc, emissiveIntensity: 1.6, roughness: 0.4 });
  for (const s of [-1, 1]) {
    for (const dz of [-0.34, 0.34]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.34), head_mat);
      lamp.position.set(s * (total / 2 + 0.1), T.height_m * 0.62, dz * T.width_m);
      g.add(lamp);
    }

    /* 端面风窗：驾驶室前挡风，没有它端面就是一块空白灰板 */
    const wind = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, T.height_m * 0.34, T.width_m * 0.72),
      glass_mat
    );
    wind.position.set(s * (total / 2 + 0.04), T.height_m * 0.72, 0);
    g.add(wind);

    /* 端面腰线，和侧面贯通 */
    const end_band = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.42, T.width_m * 0.98),
      stripe_mat
    );
    end_band.position.set(s * (total / 2 + 0.03), T.height_m * 0.34, 0);
    g.add(end_band);
  }
  return g;
}
