import * as THREE from "three";
import { Cinematic } from "./core/cinematic.js";
import * as PBR from "./core/pbr.js";
import { merge_static } from "./core/merge_static.js";
import { build_campus } from "./cine/scene_campus.js";
import { add_people, make_scene_prop } from "./cine/life.js";
import { tickers, clearTicks } from "./core/kit.js";
import { build_subway } from "./cine/scene_subway.js";
import { build_forest } from "./cine/scene_forest.js";
import { Monitor } from "./cine/monitor.js";
import { px_to_world, world_to_px } from "./map/coords.js";
import PACKAGE from "./map/data/map_package.json";

/* 观感版预览页：两个场景可切换，无 UI 遮挡，只用来验证画质。
   素材：AmbientCG 材质 + Poly Haven 天空，均 CC0。 */

const stage = document.getElementById("stage");
const cine = new Cinematic(stage);
window.__cine = cine;            // 调试用：验收脚本要读渲染状态
window.__cine_three = THREE;
window.__pbr = PBR;

const hud = document.getElementById("hud");
const tip = document.getElementById("tip");
const tabs = document.querySelectorAll("[data-scene]");

/* 每个场景的机位：
   相机目标由场景包围盒自动算，距离按场地尺度缩放。
   小区在图纸上的位置不在原点，写死坐标会对着一片空地。 */
/* 机位的中心与跨度按数据包里的区域轮廓算，换图不用改这里。
   只有角度、仰角、取景系数与雾距是看画面定的。 */
const MAP_W = PACKAGE.image.width;
const MAP_H = PACKAGE.image.height;
const MPP = PACKAGE.scale.meters_per_px;

function bbox_of(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

function view_of(polys, extra) {
  const b = bbox_of(polys);
  if (!isFinite(b.x0)) return { ...extra };
  return {
    center: [((b.x0 + b.x1) / 2 - MAP_W / 2) * MPP, ((b.y0 + b.y1) / 2 - MAP_H / 2) * MPP],
    span: Math.max(b.x1 - b.x0, b.y1 - b.y0) * MPP,
    ...extra,
  };
}

const CAMPUS_POLY = PACKAGE.zones?.campus?.polygon || [];
const COMM_POLY = PACKAGE.zones?.community?.polygon || [];
const FOREST_POLYS = PACKAGE.zones?.forest?.forests?.length
  ? PACKAGE.zones.forest.forests
  : [PACKAGE.zones?.forest?.polygon].filter(Boolean);

const VIEWS = {
  campus: view_of([CAMPUS_POLY], { theta: 5.29, phi: 1.02, fit: 0.95, fog: [900, 2400], env: 0.55 }),
  community: view_of([COMM_POLY], { theta: 0.95, phi: 1.00, fit: 1.1, fog: [420, 1300], env: 0.58 }),
  forest: view_of(FOREST_POLYS, { theta: 0.85, phi: 0.72, fit: 1.15, fog: [260, 1100], env: 0.6 }),
  subway: { theta: 1.5708, phi: 0.02, fit: 0.34, fog: [110, 420], env: 0.55 },
};

/* 小区页签不再单独建场景：它就在校园东南角，是同一块地上的一部分。
   两个页签共用校园场景，切换只是换机位，不需要重建。 */
const BUILDERS = {
  campus: build_campus,
  community: build_campus,
  forest: build_forest,
  subway: build_subway,
};

/* 共用同一个场景的页签，切换时走快路径，只重设机位 */
const SAME_SCENE = { campus: "community", community: "campus" };

/* 一个场景里可能有两组设备：校园本体一组，小区一组（add_community 自己加的）。
   按场景 id 取对应的一组，否则小区页签会列出一串三百米外的校园设备。 */
function collect_agents(root, scene_id) {
  const out = [];
  root.traverse((o) => {
    const list = o.userData?.agents;
    if (!list) return;
    for (const a of list) if (!scene_id || a.scene === scene_id) out.push(a);
  });
  return out;
}

/* 小区页签复用校园场景，监控点位要限制在小区范围内，
   否则讲解到小区时画面里一个报警点都没有。
   小区范围在像素 x 799~1007、y 1048~1255，取中心与半径。 */
const COMM_BOX = bbox_of([COMM_POLY]);
const MONITOR_AREA = {
  community: {
    center_px: [(COMM_BOX.x0 + COMM_BOX.x1) / 2, (COMM_BOX.y0 + COMM_BOX.y1) / 2],
    radius_px: Math.max(COMM_BOX.x1 - COMM_BOX.x0, COMM_BOX.y1 - COMM_BOX.y0) * 0.45,
  },
};

/** 建监控层。tab 是页签名，root 是当前场景根节点，list 是本页签的设备 */
function make_monitor(tab, root, list) {
  const m = new Monitor({
    root,
    /* 小区与校园是同一份地图数据，寻路与网格都按 campus 走 */
    scene: tab === "community" ? "campus" : tab,
    agents: list,
    floor_y: list[0]?.entity.root.position.y ?? 0,
    make_prop: make_scene_prop,
    hooks: {
      on_alarm: on_camera_alarm,
      on_dispatched,
      on_arrive,
      on_resolve: on_resolved,
      on_manual_arrive,
    },
  });
  m.build({ count: 3, ...(MONITOR_AREA[tab] || {}) });
  window.__monitor = m;   // 调试用：验收脚本要读摄像头点位与报警状态
  return m;
}

/**
 * 取景。
 *
 * 不能用 Box3.setFromObject：场景里有一张几百米见方的地面，
 * 包围盒会被它撑满，相机退到三百米外，雾把一切都吞掉。
 * 场景构建时在 root.userData.frame 里给出本体范围（中心 + 跨度）。
 */
function frame_object(root, v) {
  const base = root.userData.frame || { center: [0, 0], span: 120 };
  /* 共用场景的页签（小区）自己给机位中心与跨度，其余沿用场景包围盒 */
  const f = v.center ? { ...base, center: v.center, span: v.span ?? base.span } : base;
  cine.bind_orbit(new THREE.Vector3(f.center[0], f.y ?? 8, f.center[1]));
  /* bind_orbit 会清空上一场景的包围盒，这里由新场景重新声明 */
  cine.cam_clamp = f.cam_clamp || null;
  cine.theta = v.theta;
  cine.phi = v.phi;
  cine.distance = f.span * v.fit;
}

/** 粗判设备档位：核数与像素总量，够用就行，不必精确 */
function auto_quality() {
  const cores = navigator.hardwareConcurrency || 4;
  const px = innerWidth * innerHeight;
  if (cores <= 4 || px > 2_600_000) return "low";
  if (cores >= 12 && px <= 2_200_000) return "high";
  return "medium";
}

let current = null;
let current_root = null;   // 当前挂进场景的根节点
let busy = false;
let monitor = null;        // 监控与报警调度，切场景时重建

/** 切场景：卸掉旧场景、建新场景、重设机位 */
async function show(name) {
  if (busy || current === name) return;
  busy = true;
  tabs.forEach((t) => t.classList.toggle("on", t.dataset.scene === name));

  /* 校园与小区共用同一个场景：只换机位，不重建。
     重建一次校园要几秒，来回切页签会很难受。 */
  if (SAME_SCENE[name] === current && current_root) {
    /* 设备换组：小区页签跟随的是小区那两台狗和一台人形 */
    agents = collect_agents(current_root, name);
    follow_idx = -1;
    cine.set_follow(null);
    sync_follow_ui();
    build_markers();
    build_agent_rows();

    /* 监控点位也换到新页签的范围里 */
    monitor?.dispose();
    monitor = make_monitor(name, current_root, agents);

    frame_object(current_root, VIEWS[name]);
    const fc = current_root.userData.frame || { center: [0, 0] };
    cine.focus_sun(fc.center, Math.max(80, fc.span * 0.8), VIEWS[name].theta + 1.15);
    current = name;
    busy = false;
    return;
  }

  /* 监控层持有 setTimeout：切场景前必须清掉，否则残留的定时器
     会把状态写到已经卸载的设备上 */
  monitor?.dispose();
  monitor = null;

  /* 按保存的根节点卸载，不按页签名找：小区页签挂的是校园的根节点，
     名字对不上会漏删，两个场景就叠在一起了 */
  if (current_root) {
    cine.scene.remove(current_root);
    current_root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    current_root = null;
  }

  /* 切场景先清掉上一场景注册的动画（列车等）与 kit 的 ticker（火焰、行人） */
  cine.clear_updaters();
  clearTicks();
  const root = await BUILDERS[name](cine);

  /* 合并在挂进场景之前做：此时所有网格的父节点都还是场景自己的组，
     不会误伤相机、灯光等常驻对象 */
  merge_static(root);

  cine.scene.add(root);
  cine.register_csm(root);
  current_root = root;

  /* 设备列表跟着场景换；旧的跟随对象已经卸载，必须解除，
     否则相机会追一个不在场景里的实体 */
  follow_idx = -1;
  cine.set_follow(null);
  sync_follow_ui();
  agents = collect_agents(root, name);

  /* 行人、设备牌、情景道具都在合并之后加：
     它们要动，进静态几何就会被烘死 */
  root.add(marker_group);
  build_markers();
  build_agent_rows();
  /* 地面高度从设备身上取：地铁站台比地坪高 0.9 米，
     摄像头、光圈、行人都要跟着抬起来 */
  const floor_y = agents[0]?.entity.root.position.y ?? 0;

  const people_n = { campus: 18, community: 12, forest: 1, subway: 12 }[name] ?? 10;
  /* 地铁站台只有十几米宽，行人撒得太开就会压到黄线甚至轨道上。
     给人群一个更小的活动半径，只在台面中线附近走动 */
  let crowd_area = {};
  if (name === "subway") {
    const b = bbox_of([PACKAGE.zones?.subway?.polygon || []]);
    crowd_area = {
      center: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2],
      radius_px: Math.max(8, (b.y1 - b.y0) * 0.35),
    };
  }
  add_people(root, { scene_id: name, count: people_n, seed: 1106, floor_y, ...crowd_area });

  /* 摄像头点位、报警与就近调度 */
  monitor?.dispose();
  monitor = make_monitor(name, root, agents);

  frame_object(root, VIEWS[name]);

  /* 光照跟随场景中心，否则阴影相机罩不到，画面有光没影 */
  const f = root.userData.frame || { center: [0, 0] };
  /* 太阳方位 = 相机方位 + 1.15 弧度，光从镜头左前上方来 */
  cine.focus_sun(f.center, Math.max(80, f.span * 0.8), VIEWS[name].theta + 1.15);

  current = name;
  busy = false;
}

tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.scene)));

/* ── 画质档位与帧率 ───────────────────────────────────────────────── */

const qButtons = document.querySelectorAll(".q");
const fpsEl = document.getElementById("fps");

function set_quality_ui(level) {
  cine.set_quality(level);
  qButtons.forEach((b) => b.classList.toggle("on", b.dataset.q === level));
}

qButtons.forEach((b) => b.addEventListener("click", () => set_quality_ui(b.dataset.q)));

/* 重置视角：把角度与距离拉回当前场景的默认机位。
   转到某个死角出不来时，按 R 或点右上角 ⟳ 就能回去。 */
function reset_view() {
  if (!current || !current_root) return;
  /* 正在跟随时先解除，否则机位被跟随逻辑每帧覆盖，按了没反应 */
  if (follow_idx >= 0) back_to_overview();
  frame_object(current_root, VIEWS[current]);
}

document.getElementById("reset")?.addEventListener("click", reset_view);
addEventListener("keydown", (e) => {
  if (e.code === "KeyR") reset_view();
});

/* ── 设备跟随与小窗第一视角 ────────────────────────────────────────
   主画面第三人称跟着设备走，右上角小窗是第一人称。
   小窗用第二个渲染器画同一棵场景：主渲染器带着后期管线，
   把视口缩到角落会破坏整条后期链，另起一个小渲染器反而干净。 */

const pipbox = document.getElementById("pipbox");
const pipwho = document.getElementById("pipwho");
const pip_renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("pip"),
  antialias: true,
});
pip_renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
pip_renderer.outputColorSpace = THREE.SRGBColorSpace;
pip_renderer.toneMapping = THREE.AgXToneMapping;
pip_renderer.toneMappingExposure = 0.9;
/* 阴影贴图由主渲染器每帧更新，这里只采样，不再重复烘一遍 */
pip_renderer.shadowMap.enabled = false;
const pip_cam = new THREE.PerspectiveCamera(70, 672 / 378, 0.15, 3000);

let agents = [];        // 当前场景里的设备
let follow_idx = -1;    // 正在跟随的设备下标，-1 为自由视角
let pip_on = true;

const eye_of = (a) => (a.type === "dog" ? 1.15 : 1.62);

function sync_follow_ui() {
  if (follow_idx < 0) {
    pipbox.classList.remove("on");
    return;
  }
  const a = agents[follow_idx];
  pipwho.textContent = `${a.type === "dog" ? "机器狗" : "人形机器人"} ${follow_idx + 1}`;
  pipbox.classList.toggle("on", pip_on);
}

/** 进入跟随：主画面第三人称，右上角小窗第一人称 */
function follow_agent(i) {
  if (!agents.length) return;
  follow_idx = Math.max(0, Math.min(agents.length - 1, i));
  const a = agents[follow_idx];
  cine.set_follow(a.entity, { mode: "third", eye_y: eye_of(a) });
  sync_follow_ui();
}

/** 回到全局：解除跟随，机位回到当前页签的默认取景 */
function back_to_overview() {
  follow_idx = -1;
  cine.set_follow(null);
  sync_follow_ui();
  if (current && current_root) frame_object(current_root, VIEWS[current]);
}

/** 小窗渲染：相机挂在设备头部，机身临时隐藏，避免自己的模型糊在镜头前 */
function render_pip() {
  if (follow_idx < 0 || !pip_on || !cine.follow) return;
  const a = agents[follow_idx];
  const e = a.entity;
  const yaw = e.viewYaw ? e.viewYaw() : e.heading;
  const pitch = e.viewPitch ? e.viewPitch() : 0;
  const p = e.position;

  pip_cam.position.set(p.x + Math.sin(yaw) * 0.22, cine.follow.eye_y, p.z + Math.cos(yaw) * 0.22);
  pip_cam.quaternion.setFromEuler(new THREE.Euler(-pitch, yaw + Math.PI, 0, "YXZ"));

  const was = e.root.visible;
  e.root.visible = false;
  pip_renderer.render(cine.scene, pip_cam);
  e.root.visible = was;
}

/* ── 设备标记 / 情景 / 发现播报 ──────────────────────────────────
   俯视时机器只有一米多，隔五百米就是两个像素，等于看不见。
   给每台设备挂一个不随距离缩小的牌子，俯视也能一眼找到人在哪。 */

const marker_group = new THREE.Group();
marker_group.name = "markers";
marker_group.userData.no_merge = true;

function label_of(a, i) {
  /* 按类型分别编号：dog-1、dog-2、person-1，讲解员报得出来 */
  const same = agents.slice(0, i).filter((x) => x.type === a.type).length + 1;
  return `${a.type === "dog" ? "dog" : "person"}-${same}`;
}

const BADGE_H = 128;
const badge_font = (size) => `600 ${size}px "Microsoft YaHei", system-ui, sans-serif`;

/* 标签宽度按文字自动算。设备牌只有「dog-1」，报警气泡是
   「1号教学楼东侧 · 明火」，固定 256 宽塞不下，所以要量一遍再开画布。
   sizeAttenuation 关掉后 scale 是相对视口的比例，宽度得按画布比例给。 */
function make_badge(text, { bg = "rgba(12,22,34,.82)", fg = "#8fd8ff", ring = "#3aa8e0" } = {}) {
  const probe = document.createElement("canvas").getContext("2d");
  let font = 46;
  probe.font = badge_font(font);
  /* 超过 460 就缩字号，始终单行显示 */
  while (probe.measureText(text).width > 460 && font > 24) {
    font -= 2;
    probe.font = badge_font(font);
  }
  const tw = probe.measureText(text).width;

  const c = document.createElement("canvas");
  c.width = Math.max(120, Math.ceil(tw + 60));
  c.height = BADGE_H;
  const x = c.getContext("2d");

  /* 圆角底板 */
  const m = 6;                     // 画布内边距，给描边留位置
  const w = c.width - m * 2;
  const h = 84;
  const y0 = (BADGE_H - h) / 2;
  const r = 24;
  x.beginPath();
  x.moveTo(m + r, y0);
  x.lineTo(m + w - r, y0);
  x.quadraticCurveTo(m + w, y0, m + w, y0 + r);
  x.lineTo(m + w, y0 + h - r);
  x.quadraticCurveTo(m + w, y0 + h, m + w - r, y0 + h);
  x.lineTo(m + r, y0 + h);
  x.quadraticCurveTo(m, y0 + h, m, y0 + h - r);
  x.lineTo(m, y0 + r);
  x.quadraticCurveTo(m, y0, m + r, y0);
  x.closePath();
  x.fillStyle = bg;
  x.fill();
  x.strokeStyle = ring;
  x.lineWidth = 4;
  x.stroke();

  x.font = badge_font(font);
  x.fillStyle = fg;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, c.width / 2, y0 + h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    sizeAttenuation: false,   // 不随距离缩小，俯视才看得见
  });
  const sp = new THREE.Sprite(mat);
  /* 0.0425 是固定的屏幕高度占比，宽度按画布长宽比走 */
  sp.scale.set((c.width / BADGE_H) * 0.0425, 0.0425, 1);
  sp.renderOrder = 20;
  return sp;
}

let markers = [];
let bubbles = [];
let toast_timer = 0;
let ui_last = 0;   // 设备列表刷新节流（按墙钟，不按仿真时间）
const toast_el = document.getElementById("toast");

/* 地面光圈：头顶标签是屏幕空间的，俯视时看得见牌子，却不知道脚下踩在哪。
   给每台设备在地面画一个圈，待命青、出警橙。

   尺寸取 8 米直径：全局俯视时全场五百米压在 1600 像素里，
   8 米约 24 像素，读得出来；跟随时又不会糊成一摊。
   圈分「淡面 + 亮边」两层，远处看是亮点，近处看是标线。 */

function ring_material(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const RING = {
  idle: [ring_material(0x43e0ff, 0.14), ring_material(0x43e0ff, 0.8)],
  task: [ring_material(0xff9a4a, 0.2), ring_material(0xff9a4a, 0.9)],
};
let rings = [];

function build_markers() {
  markers = [];
  rings = [];
  /* 旧场景的气泡挂在已卸载的设备上，留着每帧还会去读那两个实体 */
  bubbles = [];
  marker_group.clear();
  agents.forEach((a, i) => {
    const sp = make_badge(label_of(a, i));
    sp.userData.agent = a;
    marker_group.add(sp);
    markers.push(sp);

    /* 光圈几何体每场景新建：切场景时 current_root.traverse 会把挂在上面的
       几何体全部 dispose，共享一份的话第二次进来就画不出来了。 */
    const rg = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(4, 36), RING.idle[0]);
    const edge = new THREE.Mesh(new THREE.RingGeometry(3.55, 4.15, 40), RING.idle[1]);
    for (const m of [fill, edge]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 6;
      rg.add(m);
    }
    rg.userData.agent = a;
    rg.userData.parts = [fill, edge];
    marker_group.add(rg);
    rings.push(rg);
  });
}

function show_toast(text) {
  if (!toast_el) return;
  toast_el.textContent = text;
  toast_el.classList.add("on");
  toast_timer = 5.5;
}

const BUBBLE_RED = { bg: "rgba(58,20,16,.88)", fg: "#ffd9c2", ring: "#ff8a5c" };
const BUBBLE_GREEN = { bg: "rgba(12,34,24,.88)", fg: "#bdffd8", ring: "#46e39a" };

/**
 * 气泡。anchor 取 { agent } 时跟着设备走，取 { px } 时钉在固定点位。
 * 俯视五百米的时候，两点相距十几米只有几个像素，摄像头与事发点各冒一个
 * 会叠在一起，所以一起报警只报一个，位置放在事发点上。
 */
function pop_bubble_at(anchor, y, text, style = BUBBLE_RED) {
  const sp = make_badge(text, style);
  sp.userData.anchor = anchor;
  sp.userData.y = y;
  sp.userData.life = 6;
  marker_group.add(sp);
  bubbles.push(sp);
}

/* ── 设备列表 / 事件流 / 点击派单 ─────────────────────────────────
   讲解时要指得出「几台机器、现在在哪、系统记了什么」，
   所以给画面配两块面板。面板和顶栏同一套底样式，不抢注意力；
   按 H 收起，接大屏时只留画面。 */

const agentCountEl = document.getElementById("agentCount");
const agentRowsEl = document.getElementById("agentRows");
const feedRowsEl = document.getElementById("feedRows");

const STATUS_TEXT = { idle: "待命", moving: "前往中", on_site: "到场", busy: "处置中" };
let agent_rows = [];

/** 按当前设备重建列表。切场景时设备组会换，必须重建 */
function build_agent_rows() {
  if (!agentRowsEl) return;
  agentRowsEl.innerHTML = "";
  agent_rows = [];
  agents.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "agent-row";
    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label_of(a, i);
    const st = document.createElement("span");
    st.className = "st";
    st.textContent = STATUS_TEXT[a.status] || "待命";
    b.append(dot, name, st);
    b.addEventListener("click", () => follow_agent(i));
    agentRowsEl.appendChild(b);
    agent_rows.push({ el: b, st, agent: a });
  });
  if (agentCountEl) agentCountEl.textContent = `${agents.length} 台`;
}

/** 每 0.25 秒刷一次状态，逐帧写 DOM 没必要 */
function update_agent_rows() {
  for (let i = 0; i < agent_rows.length; i++) {
    const r = agent_rows[i];
    const s = r.agent.status || "idle";
    const txt = STATUS_TEXT[s] || s;
    if (r.st.textContent !== txt) r.st.textContent = txt;
    r.el.classList.toggle("task", s !== "idle");
    r.el.classList.toggle("on", i === follow_idx);
  }
}

/** 事件流：最新在上，超过八条丢最老的 */
function log_event(text, kind = "") {
  if (!feedRowsEl) return;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const row = document.createElement("div");
  row.className = "feed-row" + (kind ? " " + kind : "");
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  row.append(t, document.createTextNode(text));
  feedRowsEl.prepend(row);
  while (feedRowsEl.children.length > 8) feedRowsEl.lastChild.remove();
}

/** 点击地面：射线打到地平面，换算成像素坐标派最近的一台过去 */
const pick_ray = new THREE.Raycaster();
const pick_ndc = new THREE.Vector2();
const pick_plane = new THREE.Plane();

function px_at_pointer(ev) {
  const el = cine.renderer.domElement;
  const rect = el.getBoundingClientRect();
  pick_ndc.set(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1
  );
  pick_ray.setFromCamera(pick_ndc, cine.camera);
  /* 地铁站台比地坪高，地平面要跟着抬，否则点哪儿都落到台面下面 */
  pick_plane.set(new THREE.Vector3(0, 1, 0), -(monitor?.floor_y ?? 0));
  const hit = new THREE.Vector3();
  if (!pick_ray.ray.intersectPlane(pick_plane, hit)) return null;
  const p = world_to_px(hit.x, hit.z);
  return [p.x, p.y];
}

/** 点击处留一个小圈，四秒后自己消失 */
function mark_pick(px) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.9, 32),
    new THREE.MeshBasicMaterial({
      color: 0x8fd8ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  const w = px_to_world(px[0], px[1]);
  ring.position.set(w.x, (monitor?.floor_y ?? 0) + 0.12, w.z);
  ring.renderOrder = 7;
  marker_group.add(ring);
  setTimeout(() => {
    marker_group.remove(ring);
    ring.geometry.dispose();
    ring.material.dispose();
  }, 4000);
}

/* 拖动与点击要分开：按下到抬起之间挪动超过 6 像素，或者按住超过 0.6 秒，
   都按拖动处理，不派单 */
let pick_down = null;
{
  const el = cine.renderer.domElement;
  el.addEventListener("pointerdown", (e) => {
    if (e.button === 0) pick_down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  el.addEventListener("pointerup", (e) => {
    if (!pick_down) return;
    const moved = Math.hypot(e.clientX - pick_down.x, e.clientY - pick_down.y);
    const held = performance.now() - pick_down.t;
    pick_down = null;
    if (moved > 6 || held > 600) return;

    const px = px_at_pointer(e);
    if (!px) return;
    /* 正在跟某台设备时点地面，就派它去——讲解时「点哪儿它去哪儿」最直观；
       它不空闲才退回最近的空闲设备 */
    const prefer = follow_idx >= 0 ? agents[follow_idx] : null;
    const r = monitor?.dispatch_to(px, prefer);
    if (!r) {
      show_toast("没有空闲设备可派，等它处置完再点");
      return;
    }
    const dev = label_of(r.agent, agents.indexOf(r.agent));
    show_toast(
      `已派 ${dev} 前往（约 ${Math.round(r.distance_m)} 米，预计 ${Math.round(r.eta_s)} 秒到位）`
    );
    log_event(`手动派 ${dev} 前往（约 ${Math.round(r.distance_m)} 米）`);
    mark_pick(px);
  });
}

/** 设备头顶的气泡 */
function pop_bubble(agent, text, style = BUBBLE_RED) {
  pop_bubble_at({ agent }, agent.type === "dog" ? 3.4 : 4.1, text, style);
}

/* ── 监控层回调 ────────────────────────────────────────────────────
   镜头一律不抢。报警只在事发点冒气泡、底部弹消息条，
   想细看自己按数字键跟上去，符合 docs/03 定的「不抢占视角」。 */

function on_camera_alarm({ inc }) {
  const fy = monitor?.floor_y ?? 0;
  /* 抬到 5.5 米：气泡画在事发点正上方，放得太低会把地面的光圈整个盖住 */
  pop_bubble_at({ px: inc.px }, fy + 5.5, `${inc.area}发现${inc.name}`);
  log_event(`${inc.area}发现${inc.name}`, "warn");
}

function on_dispatched({ inc, agent, distance_m, eta_s }) {
  const n = agents.indexOf(agent) + 1;
  const dev = label_of(agent, n - 1);
  show_toast(
    `${inc.area}发现${inc.name}，已呼叫最近的 ${dev} 前往` +
      `（约 ${Math.round(distance_m)} 米，预计 ${Math.round(eta_s)} 秒到位）· 按 ${n} 跟随`
  );
  pop_bubble(agent, `${dev} · 前往处置`);
  log_event(`派 ${dev} 前往${inc.area}（约 ${Math.round(distance_m)} 米）`);
}

function on_arrive({ inc, agent }) {
  const dev = label_of(agent, agents.indexOf(agent));
  show_toast(`${dev} 已到${inc.area}，开始识别`);
  log_event(`${dev} 到达${inc.area}`);
}

function on_resolved({ inc, agent }) {
  const dev = label_of(agent, agents.indexOf(agent));
  show_toast(`${inc.area}${inc.name}已处置，${dev} 恢复巡检`);
  pop_bubble_at({ px: inc.px }, (monitor?.floor_y ?? 0) + 3.4, `已处置 · ${inc.name}`, BUBBLE_GREEN);
  log_event(`${inc.area}${inc.name}已处置`, "ok");
}

function on_manual_arrive({ agent }) {
  const dev = label_of(agent, agents.indexOf(agent));
  log_event(`${dev} 到达指定位置，恢复巡检`);
}

/* 帧率用真实墙钟统计，不能用逐帧 dt 累加（低帧率时会虚高） */
let frames = 0;
let t0 = performance.now();
cine.onFrame = (dt, t) => {
  /* kit 的 ticker：行人摆臂、火焰与烟柱都挂在这里 */
  for (const fn of tickers) fn(t, dt);

  /* 设备标记跟着实体走，标签压在头顶 */
  for (const sp of markers) {
    const a = sp.userData.agent;
    const h = a.type === "dog" ? 2.3 : 3.0;
    sp.position.set(a.entity.position.x, h, a.entity.position.z);
  }

  /* 地面光圈贴着脚底，出警时换色。
     头顶的品牌子是屏幕空间的，固定约九十像素宽；地面圈是世界尺寸的，
     远景时只有二十几像素，整个被牌子压住等于没画。
     所以按镜头距离放大：近处八米，五百米外放大到四十多米，
     始终比牌子大一圈，俯视才看得出「人站在这儿」。 */
  const fy = monitor?.floor_y ?? 0;
  const zoom = Math.min(6, Math.max(1, cine.distance / 90));
  for (const rg of rings) {
    const a = rg.userData.agent;
    rg.position.set(a.entity.position.x, fy + 0.08, a.entity.position.z);
    rg.scale.setScalar(zoom);
    const want = a.status === "idle" ? RING.idle : RING.task;
    const [fill, edge] = rg.userData.parts;
    if (fill.material !== want[0]) {
      fill.material = want[0];
      edge.material = want[1];
    }
  }
  /* 气泡：六秒后消失。挂设备上的跟着走，挂点位的原地不动 */
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const sp = bubbles[i];
    const anc = sp.userData.anchor;
    sp.userData.life -= dt;
    if (anc.agent) {
      const a = anc.agent;
      sp.position.set(a.entity.position.x, sp.userData.y, a.entity.position.z);
    } else {
      const w = px_to_world(anc.px[0], anc.px[1]);
      sp.position.set(w.x, sp.userData.y, w.z);
    }
    sp.material.opacity = Math.min(1, sp.userData.life / 1.2);
    if (sp.userData.life <= 0) {
      marker_group.remove(sp);
      bubbles.splice(i, 1);
    }
  }

  /* 监控：报警计时、就近调度、指示灯与光圈 */
  monitor?.tick(dt);

  /* 设备状态每 250 毫秒同步一次到列表，逐帧写 DOM 没必要。
     这里用墙钟：dt 有上限，低帧率时仿真时间比真实时间慢，界面会显得卡住 */
  const wall = performance.now();
  if (wall - ui_last > 250) {
    ui_last = wall;
    update_agent_rows();
  }

  if (toast_timer > 0) {
    toast_timer -= dt;
    if (toast_timer <= 0) toast_el?.classList.remove("on");
  }

  render_pip();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) {
    if (fpsEl) fpsEl.textContent = Math.round((frames * 1000) / (now - t0)) + " fps";
    frames = 0;
    t0 = now;
  }
};

addEventListener("keydown", (e) => {
  if (e.code.startsWith("Digit")) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 9) follow_agent(n - 1);
  } else if (e.code === "KeyG" || e.code === "Escape") {
    back_to_overview();
  } else if (e.code === "Space") {
    e.preventDefault();
    pip_on = !pip_on;
    sync_follow_ui();
  } else if (e.code === "KeyH") {
    document.body.classList.toggle("clean");
  }
});

async function boot() {
  /* 天空与环境光 */
  await cine.load_sky(new URL("cinematic/sky.jpg", document.baseURI).href, {
    intensity: 0.7,
    horizon: 0xbcc9d4,
    zenith: 0x6e9ccb,
  });

  /* 雾的颜色取天空地平线的灰蓝，远处过渡不突兀 */
  /* 雾按场景尺度给，见 VIEWS 里的 fog */


  /* 画质档位：URL 里带 q= 优先，否则按设备给默认值 */
  const q = new URLSearchParams(location.search).get("q") || auto_quality();
  set_quality_ui(q);

  await show(new URLSearchParams(location.search).get("scene") || "campus");

  if (hud) hud.style.display = "none";
  if (tip) tip.style.opacity = "1";
}

boot().catch((e) => {
  console.error(e);
  if (hud) hud.textContent = "加载失败：" + e.message;
});
