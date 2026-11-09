/* ══════════════════════════════════════════════════════════════════════════
   demo_feed — 离线演示数据源（四模型 · 四场景轮换）

   手机页连不上本机总线时（服务没起、只拿到一个静态包、或者总线挂了），
   由它按真实监控层的节奏假装在推送，页面不至于空着。
   事件结构与 cinematic_main.js 发出的一致，source 标成 demo，
   UI 会把「演示模式」明确写在页面上，不假装成真实数据。

   展台要讲的是「四个场景各一个模型」：
     校园巡检模型 → 校园      小区安防模型 → 小区
     地铁客运模型 → 地铁      森林火险模型 → 森林
   没有大屏的时候，这里按上面顺序轮换场景，每换一个场景发一条 scene 事件，
   手机端的场景条、模型徽标、模型总览高亮会跟着换，观众不用碰大屏也能
   把四个模型各看一遍。每个场景报两起，然后切下一个模型。

   节奏对着 cine/monitor.js 抄：发现 → 一秒内派单 → 按距离赶路 →
   到场扫 1.8 秒 → 处置 3.2 秒 → 完成；场景内部隔十来秒再报一起。
   异常名称按场景做了本地化（同一套 fire/crowd/trash 图标，
   在森林是「火险烟雾」，在地铁是「通道遗留物」），别让观众觉得
   四个场景报的是同一件事。
   ══════════════════════════════════════════════════════════════════════════ */

import { MODEL_ORDER, SCENE_MODELS } from "./contract.js";

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ── 四场景的演示配置 ──────────────────────────────────────────────────
   区域名用各场景里讲得通的位置；px 只是契约占位，手机端不画地图。
   名称按场景本地化，kind 仍是 fire/crowd/trash，图标与等级保持一致。 */
const KIND_LEVEL = { fire: 3, crowd: 2, trash: 1 };
const KINDS = ["fire", "crowd", "trash"];

const SCENE_PLAN = {
  campus: {
    scene: "campus",
    label: "校园",
    sites: [
      { area: "教学区 12东侧", px: [421, 318], camera: "cam-1" },
      { area: "教学区 16北侧", px: [512, 402], camera: "cam-2" },
      { area: "宿舍区 19南侧", px: [346, 655], camera: "cam-3" },
      { area: "教学区 23西侧", px: [604, 287], camera: "cam-1" },
      { area: "宿舍区 27东侧", px: [288, 742], camera: "cam-2" },
      { area: "教学区 32南侧", px: [455, 520], camera: "cam-3" },
      { area: "配套用房 34西侧", px: [372, 861], camera: "cam-1" },
      { area: "图书馆北侧", px: [530, 640], camera: "cam-2" },
    ],
  },
  community: {
    scene: "community",
    label: "小区",
    sites: [
      { area: "小区北门", px: [862, 1078], camera: "cam-1" },
      { area: "7 号楼单元门口", px: [904, 1128], camera: "cam-2" },
      { area: "地下车库入口", px: [832, 1182], camera: "cam-3" },
      { area: "小区篮球场", px: [948, 1116], camera: "cam-1" },
      { area: "中心环路", px: [884, 1152], camera: "cam-2" },
      { area: "车棚东侧", px: [928, 1086], camera: "cam-3" },
    ],
  },
  subway: {
    scene: "subway",
    label: "地铁",
    sites: [
      { area: "站厅 A 口", px: [540, 1258], camera: "cam-1" },
      { area: "站台中部", px: [562, 1302], camera: "cam-2" },
      { area: "1 号出口闸机", px: [602, 1280], camera: "cam-3" },
      { area: "无障碍通道", px: [520, 1290], camera: "cam-1" },
      { area: "售票机区域", px: [580, 1268], camera: "cam-2" },
      { area: "换乘通道", px: [612, 1312], camera: "cam-3" },
    ],
  },
  forest: {
    scene: "forest",
    label: "森林",
    sites: [
      { area: "西山脊防火道", px: [252, 602], camera: "cam-1" },
      { area: "山脚林带", px: [302, 682], camera: "cam-2" },
      { area: "林间巡检空地", px: [272, 722], camera: "cam-3" },
      { area: "西山东坡", px: [222, 652], camera: "cam-1" },
      { area: "防火瞭望点", px: [332, 612], camera: "cam-2" },
      { area: "林区步道", px: [292, 762], camera: "cam-3" },
    ],
  },
};

/* 每个场景报两起就换下一个模型，给每起留出「前往中 → 到场」的展示时间 */
const ALARMS_PER_SCENE = 2;
const ALARM_GAP = [9000, 12500];
const SWITCH_GAP = [11000, 14000];

const DEVICES = [
  { name: "dog-1", type: "dog" },
  { name: "dog-2", type: "dog" },
  { name: "dog-3", type: "dog" },
  { name: "person-1", type: "person" },
  { name: "person-2", type: "person" },
];

export function create_demo_feed({ on_event, start_delay = 1100, speed = 1 } = {}) {
  let timers = new Set();
  let started = false;
  let stopped = false;
  let seq = 0;
  let scene_idx = 0;
  let alarms_in_scene = 0;
  /* 每次创建数据源都给一个随机段：刷新页面后演示流程会从头开始，
     若 id 还是 demo-0、demo-1，会和 localStorage 里上一场留下的已处置卡片串号 */
  const run_id = Math.random().toString(36).slice(2, 8);
  const busy = new Set();   // 正在处置的设备名

  const later = (delay, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, Math.max(0, delay / speed));
    timers.add(id);
    return id;
  };

  const plan_of = (idx) => SCENE_PLAN[MODEL_ORDER[idx]] || SCENE_PLAN.campus;

  const emit = (type, incident, extra = {}) => {
    if (stopped || typeof on_event !== "function") return;
    /* 事件归属跟着 incident 自己的场景走，不跟当前轮换指针走：
       场景切走之后，上一场景的「前往中/到场/处置完成」还在陆续发出，
       用新场景的 label 会把它们张冠李戴 */
    const plan = plan_of(scene_idx);
    const scene = incident?.scene || plan.scene;
    const scene_label = incident?.scene_label || plan.label;
    on_event({
      v: 1,
      type,
      source: "demo",
      scene,
      scene_label,
      ts: Date.now(),
      incident,
      ...extra,
    });
  };

  function idle_device() {
    const free = DEVICES.filter((d) => !busy.has(d.name));
    return free.length ? pick(free) : null;
  }

  /* ── 一起异常的完整生命周期 ───────────────────────────────────────── */

  function new_incident() {
    if (stopped) return;
    const plan = plan_of(scene_idx);
    const site = pick(plan.sites);
    const kind = pick(KINDS);
    const model = SCENE_MODELS[plan.scene] || SCENE_MODELS.campus;
    const incident = {
      id: `demo-${run_id}-${seq++}`,
      kind,
      name: model.alert_names?.[kind] || kind,
      scene: plan.scene,
      scene_label: plan.label,
      area: site.area,
      camera: site.camera,
      round: Math.floor(seq / 4),
      px: site.px,
      level: KIND_LEVEL[kind],
    };

    emit("alarm", incident, { note: `${incident.name}由${plan.label}场景模型识别` });
    try_dispatch(incident);

    alarms_in_scene++;
    if (alarms_in_scene >= ALARMS_PER_SCENE) {
      later(rand(...SWITCH_GAP), switch_scene);
    } else {
      later(rand(...ALARM_GAP), new_incident);
    }
  }

  /** 换到下一个模型：发 scene 事件，手机端会把旧场景没闭环的预警收尾 */
  function switch_scene() {
    if (stopped) return;
    scene_idx = (scene_idx + 1) % MODEL_ORDER.length;
    alarms_in_scene = 0;
    emit("scene", null, { note: "演示模式 · 自动轮换场景模型" });
    later(900, new_incident);
  }

  /** 没有空闲设备就停在待派，过几秒再试——观众能看到「待派单」状态 */
  function try_dispatch(incident) {
    const agent = idle_device();
    if (!agent) {
      later(4200, () => try_dispatch(incident));
      return;
    }

    const distance_m = Math.round(rand(14, 42));
    const eta_s = Math.max(6, Math.round(distance_m / rand(1.2, 1.6)));
    busy.add(agent.name);
    dispatch(incident, agent, distance_m, eta_s);
  }

  function dispatch(incident, agent, distance_m, eta_s) {
    emit("dispatched", incident, {
      agent: { name: agent.name, type: agent.type },
      distance_m,
      eta_s,
    });

    later(eta_s * 1000, () => {
      emit("arrive", incident, {
        agent: { name: agent.name, type: agent.type },
        distance_m: 0,
        eta_s: 0,
      });

      /* 到场扫 1.8 秒 → 处置 3.2 秒 */
      later(1800, () => {
        emit("handling", incident, { agent: { name: agent.name, type: agent.type } });
        later(3200, () => {
          emit("resolved", incident, { agent: { name: agent.name, type: agent.type } });
          busy.delete(agent.name);
        });
      });
    });
  }

  /* ── 对外 ──────────────────────────────────────────────────────────── */

  return {
    start() {
      if (started) return;
      started = true;
      stopped = false;
      scene_idx = 0;
      alarms_in_scene = 0;
      emit("scene", null, { note: "演示数据 · 未连接指挥大屏" });
      later(start_delay, new_incident);
    },
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      busy.clear();
    },
    get running() {
      return started && !stopped;
    },
  };
}
