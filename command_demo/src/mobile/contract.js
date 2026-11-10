/* ══════════════════════════════════════════════════════════════════════════
   contract — 预警接收页与指挥大屏之间的数据契约（v1）

   大屏（cinematic_main.js）把监控层状态机的事件发到本机总线，
   手机页从总线订阅；离线时由 demo_feed.js 按同一套结构假装在推送。
   UI 只认下面这一种消息，不需要知道数据到底从哪来。

   一条消息 = 一次状态推进：
     scene       切换页签，手机页把旧场景没闭环的预警收尾
     alarm       摄像头发现异常             → pending
     dispatched  派最近的空闲设备前往       → dispatched
     arrive      设备到场开始识别           → on_site
     handling    识别完成、开始处置         → handling
     resolved    处置完成                   → resolved

   incident 只描述「这起异常是什么」，状态与派单信息放事件顶层：
   同一起异常会先后被多个事件描述，UI 按 incident.id 合并成一张卡片。

   为什么不直接跨设备广播：手机与电脑是两个页面实例，BroadcastChannel
   出不了本机。走开发服里的一小块内存总线（vite 插件），大屏 POST、
   手机 SSE 订阅，房间里几台手机看到的是同一份状态。总线只保存最近
   一段事件日志，新手机连上时按顺序回放，不另外维护一份快照结构。
   ══════════════════════════════════════════════════════════════════════════ */

export const BUS_VERSION = 1;

export const SCENE_LABELS = {
  campus: "校园",
  community: "小区",
  forest: "西山林区",
  subway: "地铁站厅",
};

/* ── 四大模型 · 场景应用 ────────────────────────────────────────────────
   四个场景各配一个专属模型，统一接入指挥中枢，按场景路由：
     校园 → 校园巡检模型   小区 → 小区安防模型
     地铁 → 地铁客运模型   森林 → 森林火险模型

   展台演示里模型输出是模拟的（规则 + 占位文案），但展示口径按真实能力
   清单来写：能力项来自 `source/各组人员任务表.md` 的四个场景任务盘点，
   "演示接入"只列当前 demo 真的会产生预警的几类异常，避免把所有能力
   都吹成已跑通。接真实模型时，在事件 incident 里补 analysis 即可，
   页面不用改。 */
export const SCENE_MODELS = {
  campus: {
    id: "campus",
    scene: "campus",
    scene_label: "校园",
    name: "校园巡检模型",
    short: "校园巡检",
    tagline: "校园消防、实验室与设施巡检",
    accent: "#43e0ff",
    coverage: "覆盖校园 30 项视觉识别任务",
    capabilities: ["消防与人员聚集", "实验室安全（泄漏 / 仪表 / 开关）", "道路与设施异常（积水 / 障碍 / 井盖）"],
    demo_alerts: ["明火隐患", "违规吸烟", "消防栓异常", "疏散通道堵塞"],
    /* 同一套事件模型，按场景换成讲得通的异常名；
       alert_kinds 是本场景自动报警会轮到的类型，也是图卡能出真照片的类型 */
    alert_kinds: ["smoke", "ebike", "parking", "hydrant", "exit"],
    alert_names: {
      fire: "明火隐患",
      smoke: "违规吸烟",
      crowd: "人员聚集",
      trash: "垃圾堆积",
      hydrant: "消防栓被埋压",
      ext: "灭火器异常",
      exit: "安全出口标识异常",
      ebike: "非机动车载人",
      parking: "车辆违停占道",
    },
  },
  community: {
    id: "community",
    scene: "community",
    scene_label: "小区",
    name: "小区安防模型",
    short: "小区安防",
    tagline: "小区出入口、楼栋与消防通道安防",
    accent: "#ffb454",
    coverage: "覆盖小区 11 组 21 项识别任务",
    capabilities: ["出入口拥挤与人员聚集", "电动车入楼 / 楼道堆物", "消防通道与积水隐患"],
    demo_alerts: ["出入口拥挤", "灭火器缺失", "安全出口堵塞", "消防栓被埋压"],
    alert_kinds: ["ext", "exit", "hydrant"],
    alert_names: {
      fire: "烟雾火灾",
      smoke: "楼道吸烟",
      crowd: "出入口拥挤",
      trash: "垃圾满溢",
      hydrant: "消防栓被埋压",
      ext: "灭火器缺失",
      exit: "安全出口堵塞",
      ebike: "电动车入楼",
      parking: "消防通道占用",
    },
  },
  subway: {
    id: "subway",
    scene: "subway",
    scene_label: "地铁",
    name: "地铁客运模型",
    short: "地铁客运",
    tagline: "站厅通行、遗留物品与客流安全",
    accent: "#a78bfa",
    coverage: "覆盖地铁 16 组 32 项识别任务",
    capabilities: ["通道占用与遗留物品", "人员密度与异常行为", "积水渗漏与设施状态"],
    demo_alerts: ["人员密度异常", "灭火器异常", "安全出口堵塞"],
    alert_kinds: ["door", "ext", "exit"],
    alert_names: {
      fire: "明火烟雾",
      smoke: "站台吸烟",
      crowd: "人员密度异常",
      trash: "通道遗留物",
      hydrant: "消防栓异常",
      ext: "灭火器异常",
      exit: "安全出口堵塞",
      ebike: "非机动车进站",
      parking: "通道占用",
      door: "屏蔽门状态异常",
    },
  },
  forest: {
    id: "forest",
    scene: "forest",
    scene_label: "森林",
    name: "森林火险模型",
    short: "森林火险",
    tagline: "林区火险、病虫害与林道障碍",
    accent: "#43e0a0",
    coverage: "覆盖森林 7 项火险与林业识别任务",
    capabilities: ["明火 / 烟雾 / 微烟雾", "林木病虫害与倒木断枝", "林道障碍与林区垃圾"],
    demo_alerts: ["火险烟雾", "林区吸烟", "人员活动异常", "消防栓异常"],
    alert_kinds: ["fire", "smoke", "hydrant"],
    alert_names: {
      fire: "火险烟雾",
      smoke: "林区吸烟",
      crowd: "人员活动异常",
      trash: "林区垃圾",
      hydrant: "消防栓异常",
      ext: "灭火器异常",
      exit: "疏散通道堵塞",
      ebike: "林道骑车",
      parking: "林道占用",
    },
  },
};

/** 模型清单顺序：手机端「模型总览」、演示模式的场景轮换都按这个顺序 */
export const MODEL_ORDER = ["campus", "community", "subway", "forest"];

/** 应用链路：从模型识别到手机收到预警，四段是固定的讲解口径 */
export const MODEL_CHAIN = [
  { key: "sense", label: "模型识别", note: "按场景路由到专属模型，识别异常目标" },
  { key: "judge", label: "风险研判", note: "输出等级、置信度与研判理由" },
  { key: "dispatch", label: "就近调度", note: "A* 路径选择最近的空闲执行体" },
  { key: "notify", label: "移动触达", note: "预警与处置进度实时推到手机" },
];

/** 按场景取模型；未知场景返回 null，UI 自己兜底 */
export function model_for_scene(scene) {
  return SCENE_MODELS[scene] || null;
}

/* 三类情景与等级。明火最急、人员聚集次之、垃圾堆积最低。
   颜色与图标只在这里定义一次，列表、详情、角标都从这里取。 */
export const KIND_META = {
  fire: {
    kind: "fire",
    name: "明火",
    level: 3,
    level_label: "高危",
    color: "#ff5a4a",
    glow: "rgba(255, 90, 74, .45)",
    soft: "rgba(255, 74, 56, .12)",
    icon: "fire",
    hint: "现场有明火，需要立即核实",
  },
  crowd: {
    kind: "crowd",
    name: "人员聚集",
    level: 2,
    level_label: "中危",
    color: "#ffb454",
    glow: "rgba(255, 180, 84, .4)",
    soft: "rgba(255, 180, 84, .12)",
    icon: "crowd",
    hint: "人群密度异常，注意疏导",
  },
  trash: {
    kind: "trash",
    name: "垃圾堆积",
    level: 1,
    level_label: "低危",
    color: "#ffd166",
    glow: "rgba(255, 209, 102, .36)",
    soft: "rgba(255, 209, 102, .1)",
    icon: "trash",
    hint: "堆积物需要清运",
  },
  /* 下面几类是「有实拍照片、就一定有对应事件」的扩展情景：
     照片拍的是吸烟、消防栓、灭火器、安全出口，事件就按这些讲，
     不再让垃圾或人群去套消防设施的照片。 */
  smoke: {
    kind: "smoke",
    name: "违规吸烟",
    level: 2,
    level_label: "中危",
    color: "#ff8a5c",
    glow: "rgba(255, 138, 92, .4)",
    soft: "rgba(255, 138, 92, .12)",
    icon: "fire",
    hint: "林带 / 楼道内吸烟，存在火源隐患",
  },
  hydrant: {
    kind: "hydrant",
    name: "消防栓异常",
    level: 2,
    level_label: "中危",
    color: "#ff6f5e",
    glow: "rgba(255, 111, 94, .4)",
    soft: "rgba(255, 111, 94, .12)",
    icon: "shield",
    hint: "消防栓被埋压、遮挡或锈蚀",
  },
  ext: {
    kind: "ext",
    name: "灭火器异常",
    level: 2,
    level_label: "中危",
    color: "#e2554a",
    glow: "rgba(226, 85, 74, .4)",
    soft: "rgba(226, 85, 74, .12)",
    icon: "shield",
    hint: "灭火器缺失、过期或被遮挡",
  },
  exit: {
    kind: "exit",
    name: "疏散通道堵塞",
    level: 2,
    level_label: "中危",
    color: "#ffc35c",
    glow: "rgba(255, 195, 92, .4)",
    soft: "rgba(255, 195, 92, .12)",
    icon: "arrow",
    hint: "安全出口前堆放杂物，通道变窄",
  },
  ebike: {
    kind: "ebike",
    name: "非机动车载人",
    level: 2,
    level_label: "中危",
    color: "#f7a04a",
    glow: "rgba(247, 160, 74, .4)",
    soft: "rgba(247, 160, 74, .12)",
    icon: "arrow",
    hint: "电动车带人、逆行或驶入禁行路段",
  },
  parking: {
    kind: "parking",
    name: "车辆违停占道",
    level: 2,
    level_label: "中危",
    color: "#ffcb6b",
    glow: "rgba(255, 203, 107, .4)",
    soft: "rgba(255, 203, 107, .12)",
    icon: "arrow",
    hint: "车辆停在黄格线或消防通道上",
  },
  door: {
    kind: "door",
    name: "屏蔽门状态异常",
    level: 2,
    level_label: "中危",
    color: "#8fb8ff",
    glow: "rgba(143, 184, 255, .4)",
    soft: "rgba(143, 184, 255, .12)",
    icon: "shield",
    hint: "站台屏蔽门未闭合或指示灯异常",
  },
};

/* 状态机。phase 与 PHASES 对齐，列表上的五段进度条直接读它。 */
export const STATUS_META = {
  pending: {
    key: "pending",
    label: "待派单",
    phase: 1,
    tone: "danger",
    hint: "等待最近的执行体接单",
  },
  dispatched: {
    key: "dispatched",
    label: "前往中",
    phase: 2,
    tone: "warn",
    hint: "最近执行体已出发",
  },
  on_site: {
    key: "on_site",
    label: "已到场",
    phase: 3,
    tone: "info",
    hint: "执行体到场，正在识别",
  },
  handling: {
    key: "handling",
    label: "处置中",
    phase: 4,
    tone: "info",
    hint: "现场处置进行中",
  },
  resolved: {
    key: "resolved",
    label: "已处置",
    phase: 5,
    tone: "ok",
    hint: "现场已恢复，设备返回巡检",
  },
};

export const PHASES = [
  { phase: 1, label: "发现", short: "发现" },
  { phase: 2, label: "派单", short: "派单" },
  { phase: 3, label: "到场", short: "到场" },
  { phase: 4, label: "处置", short: "处置" },
  { phase: 5, label: "完成", short: "完成" },
];

export const EVENT_TYPES = ["scene", "alarm", "dispatched", "arrive", "handling", "resolved"];

const EVENT_STATUS = {
  alarm: "pending",
  dispatched: "dispatched",
  arrive: "on_site",
  handling: "handling",
  resolved: "resolved",
};

export const EVENT_LABELS = {
  scene: "切换场景",
  alarm: "发现异常",
  dispatched: "派出执行体",
  arrive: "到场识别",
  handling: "开始处置",
  resolved: "处置完成",
};

/* ── 元数据查询：未知值一律给安全兜底，总线上的东西不能直接信 ───────── */

export function kind_meta(kind) {
  return KIND_META[kind] || KIND_META.fire;
}

export function status_meta(status) {
  return STATUS_META[status] || STATUS_META.pending;
}

export function scene_label(scene) {
  return SCENE_LABELS[scene] || (scene ? String(scene) : "场内");
}

export function status_of_event(type) {
  return EVENT_STATUS[type] || null;
}

export function is_active_status(status) {
  return status !== "resolved";
}

export function is_active_incident(inc) {
  return !!inc && inc.status !== "resolved";
}

/* ── 归一化 ────────────────────────────────────────────────────────────
   事件可能来自另一台页面、甚至以后来自别的接入方，字段不齐就补默认值，
   类型不对就整条丢掉。归一化之后 UI 与 store 可以少写一堆判空。 */

function as_number(v, fallback = null) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function as_text(v, max = 120) {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, max);
}

function as_px(v) {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = as_number(v[0]);
  const y = as_number(v[1]);
  return x === null || y === null ? null : [Math.round(x), Math.round(y)];
}

/* ── 模型输出（研判结果）─────────────────────────────────────────────
   真实模型接进来之前，这层负责生成稳定的模拟输出：置信度按 id + 区域
   做哈希，同一起异常每次刷新都是同一个数；研判理由与处置建议按异常
   类型给模板，文案对准展台讲解，不出现"大概""可能"这类含糊表述。
   接真实模型后，在 incident.analysis 里带上同名三个字段即可覆盖。 */

const ANALYSIS_DEFAULT = {
  fire: {
    rationale: (area, name) =>
      `${area}画面出现${name}并伴随烟雾扩散，目标持续可见，判定为需立即处置的消防风险。`,
    suggestion: "就近调度执行体到场处置，同步通知安保并按消防预案升级。",
  },
  crowd: {
    rationale: (area, name) =>
      `${area}${name}持续超过阈值，存在拥挤与疏散风险，判定为需现场疏导的中危事件。`,
    suggestion: "派员现场疏导，打开备用通道并广播提示，持续观察密度变化。",
  },
  trash: {
    rationale: (area, name) =>
      `${area}检测到${name}，面积超限且持续存在，属于环境卫生事件，建议尽快清运。`,
    suggestion: "调度巡检执行体清运或复位现场，记录点位后安排复核。",
  },
  smoke: {
    rationale: (area, name) =>
      `${area}画面中人员手持火源并伴随烟雾，周边为可燃植被，判定为${name}引发的火险隐患。`,
    suggestion: "就近调度执行体到场劝阻并检查周边，确认无明火残留后记录。",
  },
  hydrant: {
    rationale: (area, name) =>
      `${area}${name}：栓体被植被与堆物遮挡，取水口无法快速开启，影响应急取水。`,
    suggestion: "调度执行体到场清理遮挡物，核查阀门与压力，恢复取水口净空。",
  },
  ext: {
    rationale: (area, name) =>
      `${area}${name}：灭火器箱体破损 / 压力表指针异常，现场无法确认器材可用。`,
    suggestion: "通知消防维保补充或更换器材，复位后拍照回传复核。",
  },
  exit: {
    rationale: (area, name) =>
      `${area}${name}：安全出口前被杂物占用，疏散宽度不足，夜间标识可见性下降。`,
    suggestion: "调度执行体清走占道物，复核出口开启方向与指示标识。",
  },
};

function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * 生成/补全一条模型输出。
 * @param kind   fire / crowd / trash
 * @param fields { id, name, area, camera }
 */
export function default_analysis(kind, fields = {}) {
  const base = ANALYSIS_DEFAULT[kind] || ANALYSIS_DEFAULT.fire;
  const area = fields.area || "现场";
  const name = fields.name || kind_meta(kind).name;
  const seed = hash01(`${fields.id || ""}|${area}|${name}`);
  return {
    confidence: Math.round((0.86 + seed * 0.12) * 100) / 100,
    detect: fields.camera ? `${fields.camera} 视觉检测` : "视觉检测",
    rationale: base.rationale(area, name),
    suggestion: base.suggestion,
  };
}

/** 总线上的 analysis 若存在就覆盖默认值；字段缺省逐项回退 */
function normalize_analysis(raw, kind, fields) {
  const fallback = default_analysis(kind, fields);
  if (!raw || typeof raw !== "object") return fallback;
  const confidence = as_number(raw.confidence, fallback.confidence);
  return {
    confidence: Math.min(0.999, Math.max(0, confidence)),
    detect: as_text(raw.detect, 60) || fallback.detect,
    rationale: as_text(raw.rationale, 200) || fallback.rationale,
    suggestion: as_text(raw.suggestion, 160) || fallback.suggestion,
  };
}

/** 把总线消息整理成标准事件；返回 null 表示这条不能用 */
export function normalize_event(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = EVENT_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;

  const ts = as_number(raw.ts, Date.now());
  const inc_raw = raw.incident && typeof raw.incident === "object" ? raw.incident : null;
  const scene = as_text(raw.scene, 16) || as_text(inc_raw?.scene, 16) || null;

  let incident = null;
  if (inc_raw) {
    const kind = KIND_META[inc_raw.kind] ? inc_raw.kind : null;
    if (!kind) return null;   // 不认识的异常类型没有展示意义
    const id = as_text(inc_raw.id, 80);
    if (!id) return null;     // 没有 id 无法把生命周期合并到同一张卡片
    incident = {
      id,
      kind,
      name: as_text(inc_raw.name, 24) || kind_meta(kind).name,
      scene,
      scene_label: scene_label(inc_raw.scene || scene),
      area: as_text(inc_raw.area, 60) || scene_label(scene),
      camera: as_text(inc_raw.camera, 24),
      round: as_number(inc_raw.round, 0),
      px: as_px(inc_raw.px),
      level: as_number(inc_raw.level, kind_meta(kind).level),
      /* 观众参与：手机上报后被指挥中心受理的异常，页面会挂「观众上报」徽标 */
      visitor: inc_raw.visitor === true,
      analysis: normalize_analysis(inc_raw.analysis, kind, {
        id,
        name: as_text(inc_raw.name, 24) || kind_meta(kind).name,
        area: as_text(inc_raw.area, 60) || scene_label(scene),
        camera: as_text(inc_raw.camera, 24),
      }),
    };
  }

  if (type !== "scene" && !incident) return null;

  let agent = null;
  if (raw.agent && typeof raw.agent === "object") {
    const name = as_text(raw.agent.name, 24);
    if (name) {
      agent = {
        name,
        type: raw.agent.type === "person" ? "person" : "dog",
      };
    }
  }

  return {
    v: as_number(raw.v, BUS_VERSION),
    type,
    ts,
    source: raw.source === "demo" ? "demo" : "cinematic",
    scene,
    scene_label: scene_label(scene),
    incident,
    status: status_of_event(type),
    agent,
    distance_m: as_number(raw.distance_m),
    eta_s: as_number(raw.eta_s),
    note: as_text(raw.note, 160) || null,
  };
}

/** 服务端快照：{ v, server_ts, events:[...] }，事件按时间顺序回放 */
export function normalize_snapshot(raw) {
  const events = Array.isArray(raw?.events)
    ? raw.events.map(normalize_event).filter(Boolean)
    : [];
  return {
    v: as_number(raw?.v, BUS_VERSION),
    server_ts: as_number(raw?.server_ts, Date.now()),
    events,
  };
}

/* ── 时间格式化（手机页只展示时分秒，相对时间做提示） ───────────────── */

const pad = (n) => String(n).padStart(2, "0");

export function format_hms(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function format_hm(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 今天 / 昨天 / 月-日 */
export function format_day(ts, now = Date.now()) {
  const d = new Date(ts);
  const n = new Date(now);
  if (Number.isNaN(d.getTime())) return "";
  const same_day =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (same_day) return "今天";
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "昨天";
  }
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function relative_time(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const s = Math.round(diff / 1000);
  if (s < 10) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

/** 秒数说成人话：58 秒 / 1 分 20 秒 */
export function format_seconds(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

/** 距离取整到米，超出一公里说公里 */
export function format_distance(meters) {
  if (!Number.isFinite(meters)) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} 公里`;
  return `${Math.max(0, Math.round(meters))} 米`;
}

