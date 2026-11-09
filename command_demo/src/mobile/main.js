/* ══════════════════════════════════════════════════════════════════════════
   mobile/main — 移动端预警接收页的界面层

   这里不关心数据是从本机总线来的还是 demo_feed 模拟的：store 推一份 state
   过来，页面按 state 重画。真正要紧的是「怎么重画」：

   1. 列表按 incident.id 复用 DOM。只有第一次出现的 id 才新建节点并播放入场
      动画；状态推进只改已有节点的文本和 class。整表 innerHTML 重建会让卡片
      闪烁、滚动位置丢失、动画每次重放，接收页在展台上会很难看。
   2. 筛选是纯前端的视图切换，不重新拉数据——数据最多几十条，重连总线反而
      会打断讲解。
   3. 声音/振动/抽屉都是「锦上添花」，任何一步失败都不能影响列表继续更新，
      所以 AudioContext、localStorage、navigator.vibrate 全部做能力检测和兜底。
   4. 四大模型只做「展示层」：模型元数据、研判结果都来自 contract.js，
      页面只负责把「哪个场景用哪个模型、模型怎么研判、链路走到哪」讲清楚，
      不在前端二次编造模型能力。模型总览是纯静态 + 今日计数的浮层，
      打开时锁正文滚动，关掉后完全不影响接收主流程。
   5. 观众参与闭环是「拍一张 → 四模型会诊 → 一键上报 → 总线回推 visitor
      预警 → 手机看处置进度」。照片只在本机预览（file 对象不进任何请求），
      会诊是本地模拟动画，真正的上报只发一条 visitor_report 指令给
      /api/commands，处置进度仍走原有 SSE 预警流，所以接收逻辑不用分叉。
   ══════════════════════════════════════════════════════════════════════════ */

import {
  MODEL_CHAIN,
  MODEL_ORDER,
  PHASES,
  SCENE_MODELS,
  default_analysis,
  format_day,
  format_distance,
  format_hms,
  format_seconds,
  is_active_incident,
  kind_meta,
  scene_label,
  status_meta,
} from "./contract.js";
import { create_alert_store, mode_label } from "./store.js";

/* ── 常量与小工具 ────────────────────────────────────────────────────── */

const SOUND_KEY = "warning_receiver.sound.v1";
const NEW_CARD_MS = 640;          // 新卡片高亮淡出时长，和 CSS 的过渡对齐
const TOAST_MS = 4000;            // 新预警 toast 停留 4 秒
const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_ACCENT = "#43e0ff";
const CLIENT_KEY = "warning_receiver.client.v1";

/* 观众参与：会诊结论按场景挑一类讲得通的异常，名称用场景本地化 alert_names */
const JOIN_KIND = { campus: "fire", community: "crowd", subway: "trash", forest: "fire" };
const JOIN_SECOND_LABEL = { fire: "烟雾扩散", crowd: "人群密度", trash: "堆积范围" };

const TONE_COLOR = {
  danger: "#ff5a4a",
  warn: "#ffb454",
  info: "#43e0ff",
  ok: "#43e0a0",
};

const GROUP_LABEL = { active: "正在处置", resolved: "已处置" };

/* 筛选口径与统计条保持一致：处置中 = 已派单 / 已到场 / 处置中 */
const FILTER_MATCH = {
  all: () => true,
  pending: (inc) => inc.status === "pending",
  handling: (inc) => is_active_incident(inc) && inc.status !== "pending",
  resolved: (inc) => !is_active_incident(inc),
};

/* store 的这些 mode_note 与 banner 主文案重复，再显示一行小字只会啰嗦 */
const REDUNDANT_NOTES = new Set([
  "未连接指挥大屏",
  "未连接指挥大屏，当前为模拟预警数据",
  "手动切换到演示模式",
  "实时连接中断，正在重连…",
]);

const $ = (id) => document.getElementById(id);

const dom = {
  conn: $("conn"),
  conn_text: $("conn-text"),
  badge: $("unread-badge"),
  sound: $("sound-toggle"),
  models_btn: $("models-btn"),
  scene_bar: $("scene-bar"),
  scene_text: $("scene-text"),
  scene_meta: $("scene-meta"),
  stat: {
    pending: $("stat-pending"),
    handling: $("stat-handling"),
    resolved: $("stat-resolved"),
    today: $("stat-today"),
  },
  filters: $("filters"),
  banner_slot: $("banner-slot"),
  list: $("list"),
  skeleton: $("skeleton"),
  empty: $("empty"),
  empty_title: $("empty-title"),
  empty_sub: $("empty-sub"),
  main: $("main"),
  toast_stack: $("toast-stack"),
  sheet: $("sheet"),
  sheet_panel: $("sheet-panel"),
  sheet_icon: $("sheet-icon"),
  sheet_icon_use: $("sheet-icon-use"),
  sheet_title: $("sheet-title"),
  sheet_sub: $("sheet-sub"),
  sheet_pill: $("sheet-pill"),
  sheet_info: $("sheet-info"),
  sheet_models: $("sheet-models"),
  sheet_chain: $("sheet-chain"),
  sheet_analysis: $("sheet-analysis"),
  analysis_confidence: $("analysis-confidence"),
  analysis_fill: $("analysis-fill"),
  analysis_rows: $("analysis-rows"),
  sheet_timeline: $("sheet-timeline"),
  sheet_close: $("sheet-close"),
  sheet_grip: $("sheet-grip"),
  models: $("models"),
  models_panel: $("models-panel"),
  models_close: $("models-close"),
  models_grid: $("models-grid"),
  models_chain: $("models-chain"),
  join_btn: $("join-btn"),
  empty_join: $("empty-join"),
  join: $("join"),
  join_panel: $("join-panel"),
  join_close: $("join-close"),
  join_body: $("join-body"),
  join_scenes: $("join-scenes"),
  join_photo_input: $("join-photo"),
  join_sample: $("join-sample"),
  join_preview: $("join-preview"),
  join_photo_empty: $("join-photo-empty"),
  join_scan: $("join-scan"),
  join_boxes: $("join-boxes"),
  join_box_1: document.querySelector('.join-box[data-box="1"]'),
  join_box_2: document.querySelector('.join-box[data-box="2"]'),
  join_box_label_1: $("join-box-label-1"),
  join_box_label_2: $("join-box-label-2"),
  join_analyze: $("join-analyze"),
  join_analyze_text: document.querySelector("#join-analyze .join-analyze-text"),
  join_model_rows: $("join-model-rows"),
  join_result: $("join-result"),
  join_result_kind: $("join-result-kind"),
  join_confidence: $("join-confidence"),
  join_result_rows: $("join-result-rows"),
  join_status: $("join-status"),
  join_submit: $("join-submit"),
  join_submit_text: $("join-submit-text"),
  visitor_pending: $("visitor-pending"),
  visitor_pending_text: $("visitor-pending-text"),
  sheet_visitor: $("sheet-visitor"),
  sheet_live: $("sheet-live"),
  live_frame: $("live-frame"),
  live_empty: $("live-empty"),
  live_meta: $("live-meta"),
  live_time: $("live-time"),
  app: $("app"),
  tabbar: $("tabbar"),
  tab_unread: $("tab-unread"),
  hero_online: $("hero-online"),
  models_tab_grid: $("models-tab-grid"),
  models_tab_chain: $("models-tab-chain"),
  models_full_btn: $("models-full-btn"),
  entry_photo: $("entry-photo"),
  entry_voice: $("entry-voice"),
  entry_ar: $("entry-ar"),
  entry_quiz: $("entry-quiz"),
  entry_voice_cmd: $("entry-voice-cmd"),
  battle_participants: $("battle-participants"),
  battle_reports: $("battle-reports"),
  battle_fastest: $("battle-fastest"),
  battle_kinds: $("battle-kinds"),
  battle_scenes: $("battle-scenes"),
  level_mini: $("level-mini"),
  me_avatar: $("me-avatar"),
  me_name: $("me-name"),
  me_role_label: $("me-role-label"),
  me_score: $("me-score"),
  role_grid: $("role-grid"),
  me_level: $("me-level"),
  me_joins: $("me-joins"),
  me_reports: $("me-reports"),
  me_rank: $("me-rank"),
  me_online: $("me-online"),
  me_board: $("me-board"),
  me_sound: $("me-sound"),
  me_sound_state: $("me-sound-state"),
  me_conn_info: $("me-conn-info"),
  me_client: $("me-client"),
  me_reset: $("me-reset"),
  voice: $("voice"),
  voice_kicker: $("voice-kicker"),
  voice_title: $("voice-title"),
  voice_sub: $("voice-sub"),
  voice_close: $("voice-close"),
  voice_hold: $("voice-hold"),
  voice_orb: $("voice-orb"),
  voice_hint: $("voice-hint"),
  voice_transcript: $("voice-transcript"),
  voice_text: $("voice-text"),
  voice_result: $("voice-result"),
  voice_result_kind: $("voice-result-kind"),
  voice_result_conf: $("voice-result-conf"),
  voice_result_rows: $("voice-result-rows"),
  voice_status: $("voice-status"),
  voice_submit: $("voice-submit"),
  voice_submit_text: $("voice-submit-text"),
  ar: $("ar"),
  ar_close: $("ar-close"),
  ar_markers: $("ar-markers"),
  ar_scan: $("ar-scan"),
  ar_scan_fill: $("ar-scan-fill"),
  ar_scan_text: $("ar-scan-text"),
  ar_hint: $("ar-hint"),
  ar_result: $("ar-result"),
  ar_result_title: $("ar-result-title"),
  ar_result_conf: $("ar-result-conf"),
  ar_result_text: $("ar-result-text"),
  ar_submit: $("ar-submit"),
  ar_rescan: $("ar-rescan"),
  ar_status: $("ar-status"),
  quiz: $("quiz"),
  quiz_close: $("quiz-close"),
  quiz_step: $("quiz-step"),
  quiz_score: $("quiz-score"),
  quiz_streak: $("quiz-streak"),
  quiz_image: $("quiz-image"),
  quiz_question: $("quiz-question"),
  quiz_options: $("quiz-options"),
  quiz_reveal: $("quiz-reveal"),
  quiz_status: $("quiz-status"),
  quiz_result: $("quiz-result"),
  quiz_final_score: $("quiz-final-score"),
  quiz_best_streak: $("quiz-best-streak"),
  quiz_rank: $("quiz-rank"),
  quiz_replay: $("quiz-replay"),
};

const filter_btns = Array.from(dom.filters.querySelectorAll("[data-filter]"));
const tab_btns = Array.from(dom.tabbar.querySelectorAll("[data-tab]"));
const view_panels = Array.from(document.querySelectorAll(".view[data-panel]"));

/** 只在值变化时写 DOM，避免无意义的文本节点重建 */
function set_text(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}

function icon_svg(symbol_id) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbol_id}`);
  svg.append(use);
  return svg;
}

/* ── 四大模型的展示辅助 ──────────────────────────────────────────────── */

/** 场景 → 专属模型；未知场景返回 null，由调用方兜底 */
function model_for(scene) {
  return SCENE_MODELS[scene] || null;
}

/** 事件里没带模型输出（老缓存 / 第三方接入）时，用契约里的规则补一份研判 */
function analysis_of(inc) {
  if (inc.analysis) return inc.analysis;
  return default_analysis(inc.kind, {
    id: inc.id,
    name: inc.name,
    area: inc.area,
    camera: inc.camera,
  });
}

function confidence_pct(inc) {
  const raw = analysis_of(inc).confidence;
  const value = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.9;
  return Math.round(value * 100);
}

function start_of_today(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 应用链路进度：报警事件已经带着模型研判，所以「识别 / 研判」在 pending 时
 * 就已完成；派单在 dispatched 完成；移动触达随进度推送一直进行到闭环。
 */
function chain_progress(status) {
  const done = { pending: 2, dispatched: 3, on_site: 3, handling: 3, resolved: 4 }[status];
  const done_count = Number.isFinite(done) ? done : 2;
  return { done: done_count, current: done_count < MODEL_CHAIN.length ? done_count : -1 };
}

/* ── 全局状态 ────────────────────────────────────────────────────────── */

const store = create_alert_store();
let state = null;
let filter = "all";

const cards = new Map();        // incident.id → { el, refs, timer }
const group_nodes = new Map();  // "active" / "resolved" → 分组标题节点
const model_cards = new Map();  // "campus" / ... → 模型总览里一张卡的节点

let banner_key = "";
let scene_key = "";

let models_open = false;
let models_hide_timer = 0;
let models_last_focus = null;

/* ── 提示音：默认开，状态存 localStorage ─────────────────────────────── */

let sound_on = load_sound();
let audio_ctx = null;
let last_beep_at = 0;
let user_gestured = false;   // 没有用户手势时浏览器会拦截振动 / 音频，先记一笔

function load_sound() {
  try {
    const saved = localStorage.getItem(SOUND_KEY);
    return saved === null ? true : saved === "on";
  } catch {
    return true;   // 隐私模式下读不到存储，按默认开处理
  }
}

function save_sound() {
  try {
    localStorage.setItem(SOUND_KEY, sound_on ? "on" : "off");
  } catch {
    /* 存不下也不影响当前会话 */
  }
}

function apply_sound_ui() {
  dom.sound.classList.toggle("is-muted", !sound_on);
  dom.sound.setAttribute("aria-pressed", sound_on ? "true" : "false");
  dom.sound.setAttribute("aria-label", sound_on ? "关闭提示音" : "开启提示音");
  if (dom.me_sound_state) dom.me_sound_state.textContent = sound_on ? "开" : "静音";
}

/** iOS 只有用户手势里创建/恢复的 AudioContext 才允许出声，所以首个 pointerdown 就解锁 */
function unlock_audio() {
  user_gestured = true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audio_ctx) audio_ctx = new Ctx();
    if (audio_ctx.state === "suspended") audio_ctx.resume().catch(() => {});
  } catch {
    audio_ctx = null;
  }
}

/**
 * 振动/音频都要求用户已有激活记录；没有手势时调 navigator.vibrate 会被
 * Chrome 当成违规调用并在控制台报错，所以先问 userActivation 再兜底。
 */
function can_vibrate() {
  try {
    const activation = navigator.userActivation;
    if (activation && typeof activation.hasBeenActive === "boolean") return activation.hasBeenActive;
  } catch {
    /* 老浏览器没有 userActivation，用自己记的手势标记兜底 */
  }
  return user_gestured;
}

/** 两声短提示音；同一秒内多条预警只响一次，避免叠音刺耳 */
function play_beep() {
  if (!sound_on || !audio_ctx || audio_ctx.state !== "running") return;
  const now = Date.now();
  if (now - last_beep_at < 1000) return;
  last_beep_at = now;
  try {
    const start = audio_ctx.currentTime + 0.02;
    [0, 0.16].forEach((offset, index) => {
      const osc = audio_ctx.createOscillator();
      const gain = audio_ctx.createGain();
      const at = start + offset;
      osc.type = "sine";
      osc.frequency.setValueAtTime(index === 0 ? 880 : 1318.5, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
      osc.connect(gain).connect(audio_ctx.destination);
      osc.start(at);
      osc.stop(at + 0.14);
    });
  } catch {
    /* 音频设备异常时静默降级，不影响预警展示 */
  }
}

/* ── 新预警 toast ────────────────────────────────────────────────────── */

function show_toast(text, variant = "") {
  const toast = document.createElement("div");
  toast.className = variant === "visitor" ? "toast is-visitor" : "toast";
  toast.append(icon_svg(variant === "visitor" ? "ic-camera" : "ic-bell-on"));
  const label = document.createElement("span");
  label.textContent = text;
  toast.append(label);
  dom.toast_stack.append(toast);

  /* 最多同时挂 3 条，展台上连续报警也不会把屏幕糊满 */
  while (dom.toast_stack.children.length > 3) {
    dom.toast_stack.firstElementChild.remove();
  }

  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 320);
  }, TOAST_MS);
}

function notify_new_alarm(event) {
  const inc = event && event.incident;
  if (!inc) return;
  const km = kind_meta(inc.kind);
  const area = inc.area || scene_label(inc.scene);
  const visitor = inc.visitor === true;
  show_toast(
    visitor
      ? `观众上报已进入指挥流程 · ${area} ${inc.name || km.name}`
      : `新预警 · ${area} ${inc.name || km.name}`,
    visitor ? "visitor" : ""
  );
  play_beep();
  if (can_vibrate()) {
    try {
      navigator.vibrate?.([40, 60, 40]);
    } catch {
      /* 桌面浏览器没有振动马达 */
    }
  }
}

/** 观众上报进入 dispatched/arrive/handling/resolved 时给一条轻量回执，不打断浏览 */
function notify_visitor_receipt(event) {
  if (!event || !event.incident || event.incident.visitor !== true) return;
  const agent = event.agent && event.agent.name ? event.agent.name : "执行体";
  let text = "";
  if (event.type === "dispatched") {
    const distance = Number.isFinite(event.distance_m) ? `（约 ${format_distance(event.distance_m)}）` : "";
    text = `你的上报：${agent} 已前往${distance}`;
  } else if (event.type === "arrive") {
    text = `你的上报：${agent} 已到场，开始核实`;
  } else if (event.type === "handling") {
    text = `你的上报：${agent} 开始处置`;
  } else if (event.type === "resolved") {
    text = "你的上报已处置完成，感谢参与！";
  }
  if (text) show_toast(text, "visitor");
}

/* ── 渲染：顶栏 / 场景条 / 统计 / 筛选 ───────────────────────────────── */

function render_topbar(next) {
  const unread = next.counts.unread;
  dom.badge.hidden = unread <= 0;
  set_text(dom.badge, unread > 99 ? "99+" : unread);
  if (dom.tab_unread) {
    dom.tab_unread.hidden = unread <= 0;
    set_text(dom.tab_unread, unread > 99 ? "99+" : unread);
  }

  if (dom.conn.dataset.mode !== next.mode) dom.conn.dataset.mode = next.mode;
  set_text(dom.conn_text, mode_label(next.mode));
}

function render_scene(next) {
  const scene = next.scene;
  const model = scene ? model_for(scene.id) : null;
  const key = scene ? `${scene.id}|${scene.label || ""}|${model ? model.name : ""}` : "none";

  if (key !== scene_key) {
    scene_key = key;
    dom.scene_bar.style.setProperty("--model-accent", model ? model.accent : FALLBACK_ACCENT);
    dom.scene_text.replaceChildren();
    if (!scene) {
      dom.scene_text.textContent = "等待大屏选择场景";
    } else if (model) {
      const name = document.createElement("b");
      name.className = "scene-model";
      name.textContent = model.name;
      const place = document.createElement("span");
      place.className = "scene-place";
      place.textContent = ` · ${scene.label || scene_label(scene.id)}`;
      dom.scene_text.append(name, place);
    } else {
      dom.scene_text.append(document.createTextNode("当前场景 · "));
      const name = document.createElement("b");
      name.textContent = scene.label || scene_label(scene.id);
      dom.scene_text.append(name);
    }
  }

  /* 右侧给「点位数量 + 最近更新时间」：讲解员一眼能看出画面还活不活 */
  const cameras = new Set();
  let latest = next.last_event_ts || 0;
  for (const inc of next.incidents) {
    if (inc.camera) cameras.add(inc.camera);
    if ((inc.updated_ts || 0) > latest) latest = inc.updated_ts || 0;
  }
  let meta = "监控点位 —";
  if (cameras.size && latest) {
    meta = `${cameras.size} 个点位 · 最近更新 ${format_hms(latest)}`;
  } else if (cameras.size) {
    meta = `${cameras.size} 个点位`;
  } else if (latest) {
    meta = `最近更新 ${format_hms(latest)}`;
  }
  set_text(dom.scene_meta, meta);
}

function render_stats(next) {
  set_text(dom.stat.pending, next.counts.pending);
  set_text(dom.stat.handling, next.counts.handling);
  set_text(dom.stat.resolved, next.counts.resolved_today);
  set_text(dom.stat.today, next.counts.total_today);
}

function render_filters(next) {
  const counts = { all: next.incidents.length, pending: 0, handling: 0, resolved: 0 };
  for (const inc of next.incidents) {
    if (inc.status === "pending") counts.pending += 1;
    else if (is_active_incident(inc)) counts.handling += 1;
    else counts.resolved += 1;
  }
  for (const btn of filter_btns) {
    const key = btn.dataset.filter;
    const counter = btn.querySelector(".filter-count");
    if (counter) set_text(counter, counts[key] ?? 0);
    const active = key === filter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
}

/* ── 渲染：连接状态 banner ───────────────────────────────────────────── */

function render_banner(next) {
  const key = `${next.mode}|${next.mode_note}`;
  if (key === banner_key) return;
  banner_key = key;

  if (next.mode === "live") {
    dom.banner_slot.replaceChildren();
    dom.banner_slot.hidden = true;
    return;
  }

  dom.banner_slot.hidden = false;
  const banner = document.createElement("div");
  banner.className = `banner is-${next.mode}`;
  banner.setAttribute("role", "status");

  if (next.mode === "connecting") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    banner.append(spinner);
    banner.append(banner_text("正在连接指挥大屏…", next.mode_note));
  } else if (next.mode === "reconnecting") {
    banner.append(banner_icon());
    banner.append(banner_text("实时连接中断，正在重连…", next.mode_note));
    banner.append(banner_button("使用演示数据", "demo"));
  } else {
    banner.append(banner_icon());
    banner.append(banner_text("演示模式 · 未连接指挥大屏，以下为模拟预警数据", next.mode_note));
    banner.append(banner_button("重新连接", "retry"));
  }

  dom.banner_slot.replaceChildren(banner);
}

function banner_text(title, note) {
  const box = document.createElement("div");
  box.className = "banner-text";
  const main = document.createElement("strong");
  main.textContent = title;
  box.append(main);
  const detail = note && !REDUNDANT_NOTES.has(note) ? note : "";
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    box.append(small);
  }
  return box;
}

function banner_icon() {
  const icon = document.createElement("span");
  icon.className = "banner-ico";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  return icon;
}

function banner_button(label, action) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "banner-btn";
  btn.dataset.action = action;
  btn.textContent = label;
  return btn;
}

/* ── 渲染：列表（按 id 复用 DOM） ────────────────────────────────────── */

function render_list(next) {
  const items = next.incidents.filter(FILTER_MATCH[filter] || FILTER_MATCH.all);
  const active_items = items.filter(is_active_incident);
  const resolved_items = items.filter((inc) => !is_active_incident(inc));
  const split_groups = filter === "all" && active_items.length > 0 && resolved_items.length > 0;

  const desired = [];
  if (split_groups) {
    desired.push(group_node("active", active_items.length));
    for (const inc of active_items) desired.push(card_node(inc));
    desired.push(group_node("resolved", resolved_items.length));
    for (const inc of resolved_items) desired.push(card_node(inc));
  } else {
    for (const inc of items) desired.push(card_node(inc));
  }

  reconcile(desired);

  /* 被数据层裁剪掉的 id 把节点和定时器一起清掉，卡片缓存不会无限增长 */
  const live_ids = new Set(next.incidents.map((inc) => inc.id));
  for (const [id, rec] of cards) {
    if (live_ids.has(id)) continue;
    clearTimeout(rec.timer);
    rec.el.remove();
    cards.delete(id);
  }

  const skeleton_visible = next.incidents.length === 0 && next.mode === "connecting";
  dom.skeleton.hidden = !skeleton_visible;
  dom.empty.hidden = skeleton_visible || items.length > 0;
  if (!dom.empty.hidden) {
    update_empty(next);
    dom.empty.classList.toggle("is-scanning", next.mode === "live" || next.mode === "demo");
  }
}

/** 按目标顺序摆放节点：已经在正确位置的不动，缺的插入、多的移除 */
function reconcile(desired) {
  const parent = dom.list;
  for (let i = 0; i < desired.length; i += 1) {
    const node = desired[i];
    const current = parent.children[i];
    if (current !== node) parent.insertBefore(node, current || null);
  }
  while (parent.children.length > desired.length) {
    parent.lastElementChild.remove();
  }
}

function group_node(kind, count) {
  let node = group_nodes.get(kind);
  if (!node) {
    node = document.createElement("div");
    node.className = "group-head";
    node.dataset.group = kind;
    node.innerHTML =
      '<span class="group-dot" aria-hidden="true"></span>' +
      '<span class="group-label"></span>' +
      '<span class="group-count"></span>';
    group_nodes.set(kind, node);
  }
  node.querySelector(".group-label").textContent = GROUP_LABEL[kind];
  node.querySelector(".group-count").textContent = String(count);
  return node;
}

function update_empty(next) {
  let title = "正在连接指挥大屏…";
  let sub = "";
  if (next.incidents.length > 0) {
    title = "没有符合条件的预警";
    sub = "切换上方筛选，看看其它状态的预警";
  } else if (next.mode === "live") {
    title = "暂无预警，指挥大屏正在巡检";
    sub = "有新的异常时，这里会第一时间跳出提醒";
  } else if (next.mode === "demo") {
    title = "演示数据准备中";
    sub = "模拟预警马上就来，稍等片刻";
  } else if (next.mode === "reconnecting") {
    title = "实时连接中断";
    sub = "正在尝试重新连接指挥大屏";
  }
  set_text(dom.empty_title, title);
  set_text(dom.empty_sub, sub);
}

/* ── 卡片：创建一次、之后只做增量更新 ────────────────────────────────── */

function card_node(inc) {
  let rec = cards.get(inc.id);
  if (!rec) {
    rec = create_card(inc);
    cards.set(inc.id, rec);
  }
  update_card(rec, inc);
  return rec.el;
}

function create_card(inc) {
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.dataset.id = inc.id;
  el.innerHTML = [
    '<span class="card-unread" hidden></span>',
    '<span class="card-icon"><svg class="ic" aria-hidden="true"><use href="#ic-fire"></use></svg></span>',
    '<span class="card-main">',
    '  <span class="card-top">',
    '    <h3 class="card-area"></h3>',
    '    <span class="pill tone-info"></span>',
    '  </span>',
    '  <span class="card-visitor" hidden><svg class="ic" aria-hidden="true"><use href="#ic-camera"></use></svg>观众上报</span>',
    '  <p class="card-model"><span class="card-model-name"></span><span class="card-model-conf"></span></p>',
    '  <p class="card-meta"></p>',
    '  <p class="card-statusline"></p>',
    '  <span class="steps" aria-hidden="true">',
    PHASES.map((phase) => `<span class="step is-future"><i></i><em>${phase.label}</em></span>`).join(""),
    "  </span>",
    "</span>",
  ].join("");

  const refs = {
    use: el.querySelector(".card-icon use"),
    area: el.querySelector(".card-area"),
    pill: el.querySelector(".pill"),
    model_name: el.querySelector(".card-model-name"),
    model_conf: el.querySelector(".card-model-conf"),
    meta: el.querySelector(".card-meta"),
    status: el.querySelector(".card-statusline"),
    steps_wrap: el.querySelector(".steps"),
    steps: Array.from(el.querySelectorAll(".step")),
    unread: el.querySelector(".card-unread"),
    visitor: el.querySelector(".card-visitor"),
  };

  /* 入场高亮只属于「新出现的 id」：动画结束后摘掉 class，
     否则切换筛选把节点重新挂回 DOM 时浏览器会再播一遍 */
  el.classList.add("is-new");
  const timer = setTimeout(() => el.classList.remove("is-new"), NEW_CARD_MS);
  return { el, refs, timer };
}

function update_card(rec, inc) {
  const { el, refs } = rec;
  const km = kind_meta(inc.kind);
  const sm = status_meta(inc.status);
  const active = is_active_incident(inc);
  const resolved = !active;
  /* 卡片上的模型署名按「这起异常自己的场景」取，场景切走后旧卡片不会串模型 */
  const model = model_for(inc.scene) || (state && state.scene ? model_for(state.scene.id) : null);
  const accent = model ? model.accent : FALLBACK_ACCENT;

  el.style.setProperty("--kind", km.color);
  el.style.setProperty("--kind-soft", km.soft);
  el.style.setProperty("--kind-glow", km.glow);
  el.style.setProperty("--model-accent", accent);
  el.classList.toggle("is-pending", inc.status === "pending");
  el.classList.toggle("is-resolved", resolved);
  /* 观众上报：金色-洋红徽标 + 左侧竖条，所有手机都靠总线数据识别，不依赖本机状态 */
  const is_visitor = inc.visitor === true;
  el.classList.toggle("is-visitor", is_visitor);
  refs.visitor.hidden = !is_visitor;
  el.dataset.status = inc.status;
  el.setAttribute(
    "aria-label",
    `${inc.area || "未知区域"}，${inc.name || km.name}，${sm.label}，${model ? model.name : "视觉识别模型"}`
  );

  refs.use.setAttribute("href", `#ic-${km.icon}`);
  set_text(refs.area, inc.area || "未知区域");
  set_text(refs.pill, sm.label);
  refs.pill.className = `pill tone-${sm.tone}`;
  set_text(refs.model_name, model ? model.name : "视觉识别模型");
  set_text(refs.model_conf, `置信度 ${confidence_pct(inc)}%`);
  set_text(refs.meta, meta_line(inc, km));
  set_text(refs.status, status_line(inc));

  /* 未读点只在「进行中且没看过」时出现，已处置卡片不再提醒 */
  refs.unread.hidden = !(active && !inc.read);

  /* 五段进度：已完成段亮、当前段闪、未来段暗；resolved 整条变绿 */
  const phase = sm.phase;
  for (let i = 0; i < refs.steps.length; i += 1) {
    const n = i + 1;
    const cls = resolved || n < phase ? "is-done" : n === phase ? "is-current" : "is-future";
    refs.steps[i].className = `step ${cls}`;
  }
  refs.steps_wrap.classList.toggle("is-resolved", resolved);
  refs.steps_wrap.style.setProperty("--step-current", TONE_COLOR[sm.tone] || TONE_COLOR.info);
}

/** 第二行：类型 + 等级 + 摄像头 + 时间（非今天加日期，避免隔夜后误读） */
function meta_line(inc, km) {
  /* 场景本地化名优先：森林的 fire 叫「火险烟雾」、地铁的 trash 叫「通道遗留物」。
     事件自带 name（大屏按场景写入了），缺省才回退到通用类型名。 */
  const bits = [`${inc.name || km.name} · ${km.level_label}`];
  if (inc.camera) bits.push(inc.camera);
  const day = format_day(inc.created_ts);
  const clock = format_hms(inc.created_ts);
  bits.push(day === "今天" ? clock : `${day} ${clock}`);
  return bits.join(" · ");
}

/** 第三行：不同状态下讲解员要说的一句话 */
function status_line(inc) {
  const agent = inc.agent && inc.agent.name ? inc.agent.name : "执行体";
  switch (inc.status) {
    case "pending":
      return status_meta("pending").hint;
    case "dispatched": {
      const bits = [`${agent} 前往中`];
      if (Number.isFinite(inc.distance_m)) bits.push(`约 ${format_distance(inc.distance_m)}`);
      if (Number.isFinite(inc.eta_s)) bits.push(`预计 ${format_seconds(inc.eta_s)}到位`);
      return bits.join(" · ");
    }
    case "on_site":
      return `${agent} 已到场，正在识别`;
    case "handling":
      return `${agent} 正在处置`;
    case "resolved": {
      const ts = inc.resolved_ts || inc.updated_ts;
      return `${agent} 处置完成${ts ? ` · ${format_hms(ts)}` : ""}`;
    }
    default:
      return status_meta(inc.status).hint;
  }
}

/* ── 详情抽屉 ────────────────────────────────────────────────────────── */

let sheet_id = null;
let sheet_hide_timer = 0;
let last_focus = null;
let drag = null;

function open_card(id) {
  const inc = state && state.incidents.find((item) => item.id === id);
  if (!inc) return;
  store.mark_read(id);   // 看过即已读，触发一次重画把红点收掉
  open_sheet(id);
}

function open_sheet(id) {
  clearTimeout(sheet_hide_timer);
  sheet_hide_timer = 0;

  const inc = state && state.incidents.find((item) => item.id === id);
  if (!inc) return;

  if (!dom.sheet.classList.contains("is-open")) {
    last_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  sheet_id = id;
  fill_sheet(inc);

  dom.sheet.hidden = false;
  document.body.classList.add("sheet-open");
  /* 先让它以上滑初始位置入队，下一帧再加 is-open 触发过渡 */
  requestAnimationFrame(() => {
    if (sheet_id !== id) return;
    dom.sheet.classList.add("is-open");
    dom.sheet_panel.style.transform = "";
  });
  dom.sheet_close.focus({ preventScroll: true });
}

function close_sheet() {
  if (dom.sheet.hidden && !dom.sheet.classList.contains("is-open")) return;
  stop_live_poll();
  sheet_id = null;
  dom.sheet.classList.remove("is-open");
  document.body.classList.remove("sheet-open");
  dom.sheet_panel.classList.remove("is-dragging");
  dom.sheet_panel.style.transform = "";

  if (last_focus && document.contains(last_focus)) last_focus.focus({ preventScroll: true });
  last_focus = null;

  clearTimeout(sheet_hide_timer);
  sheet_hide_timer = setTimeout(() => {
    sheet_hide_timer = 0;
    if (!sheet_id) dom.sheet.hidden = true;
  }, 300);
}

function fill_sheet(inc) {
  const km = kind_meta(inc.kind);
  const sm = status_meta(inc.status);
  const model = model_for(inc.scene) || (state && state.scene ? model_for(state.scene.id) : null);
  const accent = model ? model.accent : FALLBACK_ACCENT;
  const analysis = analysis_of(inc);
  const pct = confidence_pct(inc);

  dom.sheet_icon.style.setProperty("--kind", km.color);
  dom.sheet_icon.style.setProperty("--kind-soft", km.soft);
  dom.sheet_icon.style.setProperty("--kind-glow", km.glow);
  dom.sheet_icon_use.setAttribute("href", `#ic-${km.icon}`);

  set_text(dom.sheet_title, inc.area || "未知区域");
  const type_name = inc.name || km.name;
  const sub_bits = [type_name, km.level_label];
  if (inc.camera) sub_bits.push(inc.camera);
  set_text(dom.sheet_sub, sub_bits.join(" · "));
  set_text(dom.sheet_pill, sm.label);
  dom.sheet_pill.className = `pill tone-${sm.tone}`;
  dom.sheet_visitor.hidden = inc.visitor !== true;
  if (inc.visitor === true) start_live_poll(inc);
  else stop_live_poll();

  const cells = [
    ["异常类型", `${type_name} · ${km.level_label}`],
    ["所属场景", inc.scene_label || scene_label(inc.scene)],
    ["监控点位", inc.camera || "—"],
    ["发现时间", `${format_day(inc.created_ts)} ${format_hms(inc.created_ts)}`],
    ["处置设备", device_text(inc)],
    ["距离 / 到位", distance_text(inc)],
  ];
  dom.sheet_info.replaceChildren(...cells.map(([label, value]) => info_cell(label, value)));

  /* 模型展示三块：四模型接入、应用链路、模型研判 */
  fill_model_chips(inc);
  fill_chain(inc, accent);

  dom.sheet_analysis.style.setProperty("--model-accent", accent);
  set_text(dom.analysis_confidence, `${pct}%`);
  dom.analysis_fill.style.width = `${pct}%`;
  dom.analysis_rows.replaceChildren(
    analysis_row("识别来源", analysis.detect || "视觉检测"),
    analysis_row("研判理由", analysis.rationale || "—"),
    analysis_row("处置建议", analysis.suggestion || "—")
  );

  const timeline = Array.isArray(inc.timeline) ? inc.timeline : [];
  const nodes = timeline.map((entry, index) => timeline_item(entry, index === timeline.length - 1));
  if (!nodes.length) {
    const empty = document.createElement("li");
    empty.className = "tl-empty";
    empty.textContent = "暂无处置记录";
    nodes.push(empty);
  }
  dom.sheet_timeline.replaceChildren(...nodes);
}

/** 四个模型 chip：这起异常所属场景的模型标「主判」，其余是「已接入」 */
function fill_model_chips(inc) {
  const main_scene = inc.scene || (state && state.scene ? state.scene.id : null);
  const chips = MODEL_ORDER.map((key) => {
    const meta = SCENE_MODELS[key];
    const chip = document.createElement("div");
    chip.className = "model-chip";
    chip.dataset.model = key;
    chip.style.setProperty("--model-accent", meta.accent);
    if (key === main_scene) chip.classList.add("is-main");

    const dot = document.createElement("span");
    dot.className = "model-chip-dot";
    const name = document.createElement("span");
    name.className = "model-chip-name";
    name.textContent = meta.short;
    const tag = document.createElement("span");
    tag.className = "model-chip-tag";
    tag.textContent = key === main_scene ? "主判" : "已接入";
    chip.append(dot, name, tag);
    return chip;
  });
  dom.sheet_models.replaceChildren(...chips);
}

/** 应用链路四段：按 incident.status 标已完成 / 进行中 / 待执行 */
function fill_chain(inc, accent) {
  const { done, current } = chain_progress(inc.status);
  dom.sheet_chain.style.setProperty("--model-accent", accent);
  dom.sheet_chain.replaceChildren(
    ...MODEL_CHAIN.map((step, index) => {
      const item = document.createElement("li");
      item.className = "chain-step";
      const state_key = index < done ? "done" : index === current ? "current" : "todo";
      item.dataset.state = state_key;
      const bar = document.createElement("i");
      const label = document.createElement("b");
      label.textContent = step.label;
      const state_text = document.createElement("em");
      state_text.textContent =
        state_key === "done" ? "已完成" : state_key === "current" ? "进行中" : "待执行";
      item.append(bar, label, state_text);
      return item;
    })
  );
}

function analysis_row(label, value) {
  const row = document.createElement("div");
  row.className = "analysis-row";
  const key = document.createElement("span");
  key.className = "analysis-key";
  key.textContent = label;
  const text = document.createElement("p");
  text.className = "analysis-text";
  text.textContent = value || "—";
  row.append(key, text);
  return row;
}

function info_cell(label, value) {
  const cell = document.createElement("div");
  cell.className = "info-cell";
  const label_node = document.createElement("span");
  label_node.className = "info-label";
  label_node.textContent = label;
  const value_node = document.createElement("span");
  value_node.className = "info-value";
  value_node.textContent = value || "—";
  cell.append(label_node, value_node);
  return cell;
}

function timeline_item(entry, is_latest) {
  const item = document.createElement("li");
  item.className = `tl-item${is_latest ? " is-latest" : ""}`;
  item.dataset.type = entry.type || "update";

  const head = document.createElement("div");
  head.className = "tl-head";
  const label = document.createElement("span");
  label.className = "tl-label";
  label.textContent = entry.label || "状态更新";
  const time = document.createElement("time");
  time.className = "tl-time";
  time.textContent = format_hms(entry.ts);
  if (Number.isFinite(entry.ts)) {
    try {
      time.dateTime = new Date(entry.ts).toISOString();
    } catch {
      /* 时间戳异常就不带语义时间，展示不受影响 */
    }
  }
  head.append(label, time);

  const text = document.createElement("p");
  text.className = "tl-text";
  text.textContent = entry.text || "";

  item.append(head, text);
  return item;
}

function device_text(inc) {
  if (!inc.agent || !inc.agent.name) return "尚未派单";
  const type = inc.agent.type === "person" ? "人形机器人" : "机器狗";
  return `${inc.agent.name} · ${type}`;
}

function distance_text(inc) {
  const dist = Number.isFinite(inc.distance_m) ? inc.distance_m : null;
  if (inc.status === "pending") return "—";
  if (inc.status === "dispatched") {
    if (dist === null) return "前往中";
    const eta = Number.isFinite(inc.eta_s) ? ` · 预计 ${format_seconds(inc.eta_s)}到位` : "";
    return `${format_distance(dist)}${eta}`;
  }
  if (inc.status === "resolved") return "已到位";
  return dist !== null && dist > 0 ? `${format_distance(dist)} · 已到位` : "已到位";
}

/** 抽屉打开时状态继续推进，内容就地更新，不重开面板 */
function render_sheet(next) {
  if (!sheet_id) return;
  const inc = next.incidents.find((item) => item.id === sheet_id);
  if (!inc) {
    close_sheet();
    return;
  }
  fill_sheet(inc);
}

/* ── 四大模型应用总览浮层 ────────────────────────────────────────────── */

/** 四张模型卡只建一次：静态能力清单来自契约，动态的只有「今日预警数」与高亮 */
function build_model_cards() {
  if (model_cards.size) return;

  const fragment = document.createDocumentFragment();
  for (const key of MODEL_ORDER) {
    const meta = SCENE_MODELS[key];
    const el = document.createElement("article");
    el.className = "model-card";
    el.dataset.model = key;
    el.style.setProperty("--model-accent", meta.accent);
    el.innerHTML = [
      '<header class="model-card-head">',
      '  <span class="model-card-dot" aria-hidden="true"></span>',
      '  <h3 class="model-card-name"></h3>',
      '  <span class="model-card-current">当前场景</span>',
      "</header>",
      '<p class="model-card-tagline"></p>',
      '<p class="model-card-coverage"></p>',
      '<ul class="model-card-caps"></ul>',
      '<div class="model-card-demo">',
      '  <span class="model-demo-label">演示告警</span>',
      '  <span class="model-demo-list"></span>',
      "</div>",
      '<div class="model-card-foot">',
      '  <span class="model-today"><b class="model-today-num">0</b><span> 今日预警</span></span>',
      "</div>",
    ].join("");

    el.querySelector(".model-card-name").textContent = meta.name;
    el.querySelector(".model-card-tagline").textContent = meta.tagline;
    el.querySelector(".model-card-coverage").textContent = meta.coverage;
    const caps = el.querySelector(".model-card-caps");
    for (const capability of meta.capabilities) {
      const li = document.createElement("li");
      li.textContent = capability;
      caps.append(li);
    }
    el.querySelector(".model-demo-list").textContent = meta.demo_alerts.join(" · ");

    model_cards.set(key, { el, count: el.querySelector(".model-today-num") });
    fragment.append(el);
  }
  dom.models_grid.append(fragment);
  build_models_chain();
}

function build_models_chain() {
  if (dom.models_chain.childElementCount) return;
  dom.models_chain.replaceChildren(
    ...MODEL_CHAIN.map((step, index) => {
      const item = document.createElement("li");
      item.className = "chain-list-item";
      const idx = document.createElement("span");
      idx.className = "chain-list-idx";
      idx.textContent = String(index + 1).padStart(2, "0");
      const body = document.createElement("div");
      body.className = "chain-list-body";
      const label = document.createElement("strong");
      label.textContent = step.label;
      const note = document.createElement("p");
      note.textContent = step.note;
      body.append(label, note);
      item.append(idx, body);
      return item;
    })
  );
}

/** 只在浮层打开时更新：今日预警数按场景统计当天创建的异常 */
function render_models(next) {
  if (!models_open || !next) return;
  build_model_cards();

  const today0 = start_of_today();
  const current_scene = next.scene ? next.scene.id : null;
  for (const key of MODEL_ORDER) {
    const meta = SCENE_MODELS[key];
    const rec = model_cards.get(key);
    if (!rec) continue;
    const count = next.incidents.filter(
      (inc) => inc.scene === meta.scene && (inc.created_ts || 0) >= today0
    ).length;
    set_text(rec.count, count);
    rec.el.classList.toggle("is-current", key === current_scene);
  }
}

function open_models() {
  if (models_open) return;
  clearTimeout(models_hide_timer);
  models_hide_timer = 0;
  models_open = true;
  models_last_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  build_model_cards();
  if (state) render_models(state);

  dom.models.hidden = false;
  document.body.classList.add("models-open");
  requestAnimationFrame(() => {
    if (models_open) dom.models.classList.add("is-open");
  });
  dom.models_close.focus({ preventScroll: true });
}

function close_models() {
  if (!models_open) return;
  models_open = false;
  dom.models.classList.remove("is-open");
  document.body.classList.remove("models-open");

  if (models_last_focus && document.contains(models_last_focus)) {
    models_last_focus.focus({ preventScroll: true });
  }
  models_last_focus = null;

  clearTimeout(models_hide_timer);
  models_hide_timer = setTimeout(() => {
    models_hide_timer = 0;
    if (!models_open) dom.models.hidden = true;
  }, 320);
}

/* ── 观众参与闭环：拍照 → 四模型会诊 → 一键上报 ─────────────────────── */

let join_open = false;
let join_hide_timer = 0;
let join_last_focus = null;
let join_scene = "campus";
let join_photo = null;          // { src } 仅本机预览
let join_photo_url = null;      // file 生成的 objectURL，关闭/重选时释放
let join_analysis = null;       // 会诊结论
let join_analyzing = false;
let join_submitting = false;
let join_token = 0;             // 每次会诊/关闭自增，防止旧动画回调写进新流程
const join_timers = new Set();

let visitor_pending = false;
let visitor_pending_timers = [];
let visitor_baseline = new Set();

function join_later(fn, ms) {
  const timer = setTimeout(() => {
    join_timers.delete(timer);
    fn();
  }, ms);
  join_timers.add(timer);
  return timer;
}

function clear_join_timers() {
  for (const timer of join_timers) clearTimeout(timer);
  join_timers.clear();
}

/** 本机随机 id：只用来让上报可回溯，不存任何个人信息 */
function get_client_id() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = `phone-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return "phone-temp";
  }
}

function join_kind_of(scene) {
  return JOIN_KIND[scene] || "fire";
}

function default_join_scene() {
  const current = state && state.scene ? state.scene.id : null;
  return current && SCENE_MODELS[current] ? current : "campus";
}

/** 四个场景按钮只建一次，静态数据全部来自 SCENE_MODELS */
function build_join_scenes() {
  if (dom.join_scenes.childElementCount) return;
  for (const key of MODEL_ORDER) {
    const meta = SCENE_MODELS[key];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "join-scene";
    btn.dataset.joinScene = key;
    btn.style.setProperty("--model-accent", meta.accent);
    btn.innerHTML = [
      '<span class="join-scene-head">',
      '  <span class="join-scene-dot" aria-hidden="true"></span>',
      '  <span class="join-scene-name"></span>',
      "</span>",
      '<span class="join-scene-meta"></span>',
      '<span class="join-scene-tag"></span>',
    ].join("");
    btn.querySelector(".join-scene-name").textContent = meta.name;
    btn.querySelector(".join-scene-meta").textContent = `${meta.scene_label} · ${meta.alert_names[join_kind_of(key)]}`;
    dom.join_scenes.append(btn);
  }
}

function sync_join_scene() {
  for (const btn of dom.join_scenes.querySelectorAll("[data-join-scene]")) {
    const selected = btn.dataset.joinScene === join_scene;
    btn.classList.toggle("is-selected", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    btn.querySelector(".join-scene-tag").textContent = selected ? "本次上报" : "已接入";
  }
}

function set_join_status(text, tone = "") {
  dom.join_status.textContent = text || "";
  dom.join_status.classList.toggle("is-error", tone === "error");
  dom.join_status.classList.toggle("is-ok", tone === "ok");
}

function release_join_photo() {
  if (!join_photo_url) return;
  try {
    URL.revokeObjectURL(join_photo_url);
  } catch {
    /* 释放失败不影响流程 */
  }
  join_photo_url = null;
}

/** 照片只给 <img> 预览用，file 对象不进任何请求，也不写入存储 */
function set_join_photo(src) {
  join_photo = { src };
  dom.join_preview.src = src;
  dom.join_preview.hidden = false;
  dom.join_photo_empty.hidden = true;
  dom.join_analyze.disabled = false;
  dom.join_result.hidden = true;
  dom.join_submit.hidden = true;
  dom.join_model_rows.hidden = true;
  set_join_status("", "");
}

/** 用 canvas 本机画一张演示现场图：不引外链图片，也不上传 */
function build_sample_photo() {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, "#1b2534");
  sky.addColorStop(1, "#0b1119");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 800, 600);

  ctx.fillStyle = "#121a24";
  ctx.fillRect(0, 372, 800, 228);
  ctx.fillStyle = "#0e1620";
  ctx.fillRect(60, 190, 150, 300);
  ctx.fillRect(250, 138, 120, 352);
  ctx.fillRect(618, 172, 140, 318);

  ctx.fillStyle = "rgba(255, 209, 102, 0.5)";
  for (let y = 230; y < 430; y += 42) {
    for (let x = 82; x < 190; x += 34) ctx.fillRect(x, y, 16, 20);
  }
  for (let y = 180; y < 450; y += 42) {
    for (let x = 272; x < 348; x += 34) ctx.fillRect(x, y, 16, 20);
  }

  /* 火点光晕 + 烟雾团，让检测框有东西可框 */
  const glow = ctx.createRadialGradient(430, 424, 12, 430, 424, 160);
  glow.addColorStop(0, "rgba(255, 170, 70, 0.95)");
  glow.addColorStop(0.42, "rgba(255, 90, 40, 0.5)");
  glow.addColorStop(1, "rgba(255, 90, 40, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(430, 424, 160, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 9; i += 1) {
    const x = 430 + Math.sin(i * 1.7) * 58;
    const y = 340 - i * 24;
    const r = 42 + i * 7;
    const smoke = ctx.createRadialGradient(x, y, 0, x, y, r);
    smoke.addColorStop(0, "rgba(200, 202, 214, 0.28)");
    smoke.addColorStop(1, "rgba(200, 202, 214, 0)");
    ctx.fillStyle = smoke;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(10, 13, 18, 0.9)";
  ctx.beginPath();
  ctx.ellipse(622, 470, 62, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(30, 40, 52, 0.9)";
  ctx.fillRect(0, 540, 800, 60);

  ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
  ctx.font = "600 22px -apple-system, PingFang SC, sans-serif";
  ctx.fillText("演示现场照片 · 本机生成", 26, 566);
  ctx.fillStyle = "rgba(255, 209, 102, 0.85)";
  ctx.font = "500 18px -apple-system, PingFang SC, sans-serif";
  ctx.fillText(new Date().toLocaleTimeString("zh-CN", { hour12: false }), 640, 566);

  return canvas.toDataURL("image/jpeg", 0.86);
}

function reset_join_flow() {
  clear_join_timers();
  join_token += 1;
  join_analyzing = false;
  join_submitting = false;
  join_analysis = null;
  join_photo = null;
  release_join_photo();
  dom.join_photo_input.value = "";
  dom.join_preview.hidden = true;
  dom.join_preview.removeAttribute("src");
  dom.join_photo_empty.hidden = false;
  dom.join_scan.hidden = true;
  dom.join_boxes.hidden = true;
  dom.join_model_rows.hidden = true;
  dom.join_model_rows.replaceChildren();
  dom.join_result.hidden = true;
  dom.join_result_rows.replaceChildren();
  dom.join_submit.hidden = true;
  dom.join_submit.disabled = false;
  dom.join_submit_text.textContent = "一键上报指挥中心";
  dom.join_analyze.disabled = true;
  dom.join_analyze.classList.remove("is-loading");
  dom.join_analyze_text.textContent = "让四个模型看一看";
  set_join_status("", "");
  dom.join_body.scrollTop = 0;
  join_scene = default_join_scene();
  build_join_scenes();
  sync_join_scene();
}

function open_join() {
  if (join_open) return;
  clearTimeout(join_hide_timer);
  join_hide_timer = 0;
  if (models_open) close_models();
  if (sheet_id) close_sheet();

  join_open = true;
  join_last_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  reset_join_flow();

  dom.join.hidden = false;
  document.body.classList.add("join-open");
  requestAnimationFrame(() => {
    if (join_open) dom.join.classList.add("is-open");
  });
  dom.join_close.focus({ preventScroll: true });
}

function close_join() {
  if (!join_open) return;
  join_open = false;
  join_token += 1;
  clear_join_timers();
  join_analyzing = false;
  join_submitting = false;
  dom.join.classList.remove("is-open");
  document.body.classList.remove("join-open");

  if (join_last_focus && document.contains(join_last_focus)) {
    join_last_focus.focus({ preventScroll: true });
  }
  join_last_focus = null;
  release_join_photo();

  clearTimeout(join_hide_timer);
  join_hide_timer = setTimeout(() => {
    join_hide_timer = 0;
    if (!join_open) dom.join.hidden = true;
  }, 340);
}

/** 换场景 / 改照片后旧结论作废，必须重新会诊 */
function invalidate_join_result() {
  join_token += 1;
  clear_join_timers();
  join_analyzing = false;
  join_analysis = null;
  dom.join_scan.hidden = true;
  dom.join_boxes.hidden = true;
  dom.join_model_rows.hidden = true;
  dom.join_result.hidden = true;
  dom.join_submit.hidden = true;
  dom.join_analyze.classList.remove("is-loading");
  dom.join_analyze.disabled = !join_photo;
  dom.join_analyze_text.textContent = "让四个模型看一看";
  set_join_status("", "");
}

function build_join_analysis() {
  const meta = SCENE_MODELS[join_scene];
  const kind = join_kind_of(join_scene);
  const name = meta.alert_names[kind];
  const confidence = Math.round((0.9 + Math.random() * 0.07) * 100) / 100;   // 90%~97%
  const base = default_analysis(kind, {
    id: `join-${Date.now()}`,
    name,
    area: `${meta.scene_label} · 观众上报点`,
    camera: "手机拍摄",
  });
  join_analysis = {
    scene: join_scene,
    model: meta,
    kind,
    name,
    confidence,
    detect: "手机拍摄 · 四模型会诊",
    rationale: base.rationale,
    suggestion: base.suggestion,
  };
  const pct = Math.round(confidence * 100);
  dom.join_box_label_1.textContent = `疑似${name} ${pct}%`;
  dom.join_box_label_2.textContent = `${JOIN_SECOND_LABEL[kind] || "关联目标"} ${Math.max(50, pct - 7)}%`;
}

/** 主判模型排第一行；其余三行是复核，逐行点亮制造「四模型会诊」的观感 */
function build_join_model_rows() {
  const main_scene = join_scene;
  const ordered = [main_scene, ...MODEL_ORDER.filter((key) => key !== main_scene)];
  const pct = Math.round(join_analysis.confidence * 100);
  dom.join_model_rows.replaceChildren(
    ...ordered.map((key) => {
      const meta = SCENE_MODELS[key];
      const is_main = key === main_scene;
      const row = document.createElement("div");
      row.className = `join-model-row${is_main ? " is-main" : ""}`;
      row.dataset.model = key;
      row.style.setProperty("--model-accent", meta.accent);
      row.innerHTML = [
        '<span class="join-model-dot" aria-hidden="true"></span>',
        '<span class="join-model-name"></span>',
        '<span class="join-model-tag"></span>',
        '<span class="join-model-msg"></span>',
      ].join("");
      row.querySelector(".join-model-name").textContent = meta.name;
      row.querySelector(".join-model-tag").textContent = is_main ? "主判" : "复核";
      row.querySelector(".join-model-msg").textContent = is_main
        ? `识别结论：疑似${join_analysis.name} ${pct}%`
        : "复核通过 · 与主判一致";
      return row;
    })
  );
}

function start_join_analyze() {
  if (join_analyzing || !join_photo) return;
  const token = ++join_token;
  join_analyzing = true;
  join_analysis = null;
  build_join_analysis();
  build_join_model_rows();

  dom.join_model_rows.hidden = false;
  dom.join_result.hidden = true;
  dom.join_submit.hidden = true;
  dom.join_boxes.hidden = false;
  dom.join_box_1.hidden = true;
  dom.join_box_2.hidden = true;
  dom.join_scan.hidden = false;
  dom.join_analyze.disabled = true;
  dom.join_analyze.classList.add("is-loading");
  dom.join_analyze_text.textContent = "四个模型会诊中…";
  set_join_status("四个模型正在看这张照片…", "");

  const rows = [...dom.join_model_rows.querySelectorAll(".join-model-row")];
  const main_row = rows.find((row) => row.classList.contains("is-main")) || rows[0];
  const others = rows.filter((row) => row !== main_row);

  join_later(() => {
    if (token !== join_token) return;
    main_row.classList.add("is-on");
    dom.join_box_1.hidden = false;
    set_join_status("主判模型已锁定目标，其余模型复核中…", "");
  }, 280);

  others.forEach((row, index) => {
    join_later(() => {
      if (token !== join_token) return;
      row.classList.add("is-on");
      if (index === 0) dom.join_box_2.hidden = false;
    }, 760 + index * 420);
  });

  join_later(() => {
    if (token !== join_token) return;
    finish_join_analyze();
  }, 2500);
}

function finish_join_analyze() {
  join_analyzing = false;
  dom.join_scan.hidden = true;
  dom.join_analyze.classList.remove("is-loading");
  dom.join_analyze.disabled = false;
  dom.join_analyze_text.textContent = "重新会诊";
  render_join_result();
  dom.join_submit.hidden = false;
  dom.join_submit.disabled = false;
  dom.join_submit_text.textContent = "一键上报指挥中心";
  set_join_status("会诊完成，上报后指挥中心会切到该场景并派单。", "ok");
}

function result_row(label, value) {
  const row = document.createElement("div");
  row.className = "join-result-row";
  const key = document.createElement("span");
  key.className = "join-result-key";
  key.textContent = label;
  const text = document.createElement("p");
  text.className = "join-result-text";
  text.textContent = value || "—";
  row.append(key, text);
  return row;
}

function render_join_result() {
  if (!join_analysis) return;
  const a = join_analysis;
  dom.join_result_kind.textContent = a.name;
  dom.join_confidence.textContent = `${Math.round(a.confidence * 100)}%`;
  dom.join_result_rows.replaceChildren(
    result_row("主判模型", `${a.model.name} · ${a.model.scene_label}`),
    result_row("识别来源", a.detect),
    result_row("研判理由", a.rationale),
    result_row("处置建议", a.suggestion)
  );
  dom.join_result.hidden = false;
}

async function submit_join_report() {
  if (join_submitting || !join_analysis) return;
  const analysis = join_analysis;
  /* 上报前记下已有 visitor 预警：之后新出现的才是这次上报引起的 */
  visitor_baseline = new Set(
    (state ? state.incidents : []).filter((inc) => inc.visitor).map((inc) => inc.id)
  );

  join_submitting = true;
  dom.join_submit.disabled = true;
  dom.join_submit_text.textContent = "上报中…";
  set_join_status("正在把会诊结果发送给指挥中心…", "");

  try {
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visitor_report",
        scene: analysis.scene,
        kind: analysis.kind,
        confidence: analysis.confidence,
        name: analysis.name,
        client_id: get_client_id(),
        note: "观众手机上报",
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }

    join_submitting = false;
    close_join();
    after_visitor_report_success();
    switch_tab("alerts");
  } catch {
    join_submitting = false;
    dom.join_submit.disabled = false;
    dom.join_submit_text.textContent = "重新上报";
    set_join_status("上报通道未连接，先看演示处置；可点「重新上报」再试。", "error");
  }
}

function show_visitor_pending() {
  visitor_pending = true;
  dom.visitor_pending.hidden = false;
  dom.visitor_pending.classList.remove("is-slow");
  set_text(dom.visitor_pending_text, "你的上报已受理，指挥中心正在派单…");
  visitor_pending_timers.forEach((timer) => clearTimeout(timer));
  visitor_pending_timers = [
    setTimeout(() => {
      if (!visitor_pending) return;
      dom.visitor_pending.classList.add("is-slow");
      set_text(dom.visitor_pending_text, "指挥中心处理中，可继续浏览预警");
    }, 15000),
    setTimeout(() => hide_visitor_pending(), 28000),
  ];
}

function hide_visitor_pending() {
  visitor_pending = false;
  dom.visitor_pending.hidden = true;
  visitor_pending_timers.forEach((timer) => clearTimeout(timer));
  visitor_pending_timers = [];
}

/** 收到新的 visitor 预警 → 受理条消失（大屏模式可能晚于 POST 响应） */
function render_visitor_state(next) {
  if (!visitor_pending) return;
  const arrived = next.incidents.some((inc) => inc.visitor && !visitor_baseline.has(inc.id));
  if (arrived) hide_visitor_pending();
}

/* ── 主渲染入口 ──────────────────────────────────────────────────────── */

function render(next, meta) {
  render_topbar(next);
  render_scene(next);
  render_stats(next);
  render_filters(next);
  render_banner(next);
  render_list(next);
  render_sheet(next);
  render_models(next);
  render_visitor_state(next);
  if (active_tab === "models") render_models_tab();
  if (active_tab === "me") sync_conn_info();

  if (meta && meta.reason === "event" && meta.event) {
    if (meta.event.type === "alarm") notify_new_alarm(meta.event);
    else if (meta.event.incident && meta.event.incident.visitor) notify_visitor_receipt(meta.event);
  }
}

/* ── 事件绑定 ────────────────────────────────────────────────────────── */

function wire_events() {
  /* 首个手势解锁音频：iOS 不允许无手势的 WebAudio 出声 */
  document.addEventListener("pointerdown", unlock_audio, { passive: true });

  dom.sound.addEventListener("click", () => {
    sound_on = !sound_on;
    save_sound();
    apply_sound_ui();
    if (sound_on) unlock_audio();   // 打开声音这个动作本身就是手势
  });

  dom.models_btn.addEventListener("click", open_models);
  dom.models_close.addEventListener("click", close_models);
  dom.models.addEventListener("click", (event) => {
    if (event.target.closest("[data-models-close]")) close_models();
  });

  /* ── 观众参与闭环 ──────────────────────────────────────────────── */
  dom.join_btn.addEventListener("click", open_join);
  dom.empty_join.addEventListener("click", open_join);
  dom.join_close.addEventListener("click", close_join);
  dom.join.addEventListener("click", (event) => {
    if (event.target.closest("[data-join-close]")) close_join();
  });

  dom.join_scenes.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-join-scene]");
    if (!btn) return;
    if (btn.dataset.joinScene === join_scene) return;
    join_scene = btn.dataset.joinScene;
    sync_join_scene();
    invalidate_join_result();
    set_join_status(`已切换到${SCENE_MODELS[join_scene].scene_label}，会诊结论需重新生成。`, "");
  });

  dom.join_photo_input.addEventListener("change", () => {
    const file = dom.join_photo_input.files && dom.join_photo_input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type || "")) {
      set_join_status("请选择图片文件", "error");
      return;
    }
    release_join_photo();
    join_photo_url = URL.createObjectURL(file);
    set_join_photo(join_photo_url);
    invalidate_join_result();
    dom.join_analyze.disabled = false;
    set_join_status("照片已就绪，点第 3 步让四个模型会诊。", "ok");
  });

  dom.join_sample.addEventListener("click", () => {
    const src = build_sample_photo();
    if (!src) {
      set_join_status("当前浏览器生成不了演示照片，请用相机拍一张。", "error");
      return;
    }
    set_join_photo(src);
    invalidate_join_result();
    dom.join_analyze.disabled = false;
    set_join_status("已生成本机演示照片，点第 3 步让四个模型会诊。", "ok");
  });

  dom.join_analyze.addEventListener("click", () => {
    if (!join_photo) {
      set_join_status("先拍一张照片或使用演示照片。", "error");
      return;
    }
    start_join_analyze();
  });
  dom.join_submit.addEventListener("click", submit_join_report);

  dom.filters.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-filter]");
    if (!btn) return;
    const next_filter = btn.dataset.filter;
    if (!next_filter || next_filter === filter) return;
    filter = next_filter;
    if (state) {
      render_filters(state);
      render_list(state);
    }
  });

  dom.banner_slot.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "demo") store.use_demo();
    else if (btn.dataset.action === "retry") store.retry_live();
  });

  dom.list.addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (card) open_card(card.dataset.id);
  });

  /* article[role=button] 不会自己响应键盘，手动补齐 Enter / 空格 */
  dom.list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    open_card(card.dataset.id);
  });

  dom.sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-sheet-close]")) close_sheet();
  });
  dom.sheet_close.addEventListener("click", close_sheet);

  document.addEventListener("keydown", (event) => {
    /* 参与浮层在最上层：Esc / Tab 先交给它 */
    if (join_open) {
      if (event.key === "Escape") {
        event.preventDefault();
        close_join();
      }
      return;
    }
    /* 模型总览在参与浮层之下：Esc / Tab 再交给它 */
    if (models_open) {
      if (event.key === "Escape") {
        event.preventDefault();
        close_models();
      } else if (event.key === "Tab") {
        event.preventDefault();
        dom.models_close.focus({ preventScroll: true });
      }
      return;
    }
    if (!sheet_id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close_sheet();
    } else if (event.key === "Tab") {
      /* 抽屉里只有「关闭」一个可聚焦控件，Tab 就锁在它身上 */
      event.preventDefault();
      dom.sheet_close.focus({ preventScroll: true });
    }
  });

  /* 从把手上滑关闭：只监听把手，避免和抽屉内部滚动抢手势 */
  dom.sheet_grip.addEventListener("pointerdown", (event) => {
    if (!dom.sheet.classList.contains("is-open")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag = { id: event.pointerId, start_y: event.clientY, start_x: event.clientX, dy: 0 };
    dom.sheet_panel.classList.add("is-dragging");
    try {
      dom.sheet_grip.setPointerCapture(event.pointerId);
    } catch {
      /* 某些浏览器不支持捕获，后面靠 document 事件兜底 */
    }
  });

  dom.sheet_grip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = Math.max(0, event.clientY - drag.start_y);
    const dx = Math.abs(event.clientX - drag.start_x);
    if (dy <= dx) return;   // 横向移动不当事，防止误拖
    drag.dy = dy;
    dom.sheet_panel.style.transform = `translateY(${dy}px)`;
  });

  const end_drag = () => {
    if (!drag) return;
    const dy = drag.dy;
    drag = null;
    dom.sheet_panel.classList.remove("is-dragging");
    if (dy > 110) {
      dom.sheet_panel.style.transform = "";
      close_sheet();
    } else {
      dom.sheet_panel.style.transform = "";   // 回弹，CSS 过渡负责动画
    }
  };
  dom.sheet_grip.addEventListener("pointerup", end_drag);
  dom.sheet_grip.addEventListener("pointercancel", end_drag);

  /* 页面重新可见 / 网络恢复时，别让用户干等总线自己的退避节奏 */
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state && state.mode === "reconnecting") store.refresh();
  });
  window.addEventListener("online", () => {
    if (state && state.mode === "reconnecting") store.refresh();
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   AEGIS 移动指挥终端：Tab / 参与互动 / 本场战报 / 我的 / 现场回传

   这一层只做「壳 + 互动」，预警接收、四模型、拍照会诊这些稳定逻辑都复用
   上面的实现。为了不把原来的流程改坏：
   - Tab 切换只切 class，不重建列表、不重新连总线；
   - 上报统一走 send_visitor_report()，处置进度仍由原 SSE 流驱动；
   - 所有新接口失败都静默降级，展台断网也不影响预警接收。
   ══════════════════════════════════════════════════════════════════════════ */

const PROFILE_KEY = "aegis.profile.v1";
const LEVELS = [0, 40, 100, 180, 300];
const LEVEL_TITLES = ["Lv1 见习", "Lv2 值班", "Lv3 骨干", "Lv4 指挥官", "Lv5 总指挥"];
const ROLE_LABELS = { guard: "安保", fire: "消防", inspect: "巡检", visitor: "观众" };
const BATTLE_KINDS = [
  ["fire", "明火"],
  ["crowd", "人员聚集"],
  ["trash", "垃圾堆积"],
];
const SCENE_ORDER = ["campus", "community", "subway", "forest"];
const VOICE_ACTION_LABELS = {
  scene: "切换大屏场景",
  follow: "跟随机器狗",
  overview: "查看全景总览",
  report: "上报异常",
  battle: "查看本场战报",
};

let active_tab = "alerts";
let stats_cache = null;
let participants_cache = { count: 0, participants: [] };
let stats_timer = 0;

const profile = load_profile();

function load_profile() {
  const fallback = { role: "visitor", name: "", score: 0, reports: 0, joins: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (!raw || typeof raw !== "object") return fallback;
    const clamp = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : 0;
    };
    return {
      role: ROLE_LABELS[raw.role] ? raw.role : "visitor",
      name: typeof raw.name === "string" ? raw.name.slice(0, 16) : "",
      score: clamp(raw.score),
      reports: clamp(raw.reports),
      joins: clamp(raw.joins),
    };
  } catch {
    return fallback;
  }
}

function save_profile() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* 隐私模式存不下也无所谓，本场仍可用 */
  }
}

function default_name_for(role) {
  return `${ROLE_LABELS[role] || "观众"}-${Math.floor(Math.random() * 90 + 10)}`;
}

function ensure_profile() {
  if (!profile.name) {
    profile.name = default_name_for(profile.role);
    save_profile();
  }
}

/* ── 等级 / 积分 ─────────────────────────────────────────────────────── */

function level_info(score) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (score >= LEVELS[i]) idx = i;
  }
  const start = LEVELS[idx];
  const next = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  const pct = next === null ? 100 : Math.max(0, Math.min(100, Math.round(((score - start) / (next - start)) * 100)));
  return { idx, title: LEVEL_TITLES[idx], start, next, pct, to_next: next === null ? 0 : next - score };
}

function level_html(score) {
  const level = level_info(score);
  return [
    '<div class="level-head">',
    `<span class="level-badge">${level.title}</span>`,
    `<span class="level-score">积分<b>${score}</b></span>`,
    "</div>",
    `<div class="level-bar"><i style="width:${level.pct}%"></i></div>`,
    '<div class="level-next">',
    `<span>${level.next === null ? "已达最高等级" : `距离 ${LEVEL_TITLES[level.idx + 1].split(" ")[0]} 还差 ${level.to_next} 分`}</span>`,
    `<span>${level.next === null ? "TOP" : `${score} / ${level.next}`}</span>`,
    "</div>",
  ].join("");
}

function add_points(points, { report = false, join = false } = {}) {
  if (!Number.isFinite(points)) return;
  const gain = Math.max(0, Math.round(points));
  if (gain <= 0 && !report && !join) return;
  profile.score += gain;
  if (report) profile.reports += 1;
  if (join) profile.joins += 1;
  save_profile();
  sync_profile_ui();
  update_participant();
  render_battle();
  refresh_leaderboard();
}

/* ── 接口封装：全部吞异常，展台断网不冒泡 ───────────────────────────── */

async function get_json(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
  return data;
}

async function post_json(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok !== true) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data;
}

function send_visitor_report({ scene, kind, name, confidence, note }) {
  return post_json("/api/commands", {
    type: "visitor_report",
    scene,
    kind,
    confidence,
    name,
    client_id: get_client_id(),
    note: note || "观众手机上报",
  });
}

async function update_participant() {
  try {
    await post_json("/api/participants", {
      client_id: get_client_id(),
      role: profile.role,
      name: profile.name || default_name_for(profile.role),
      score: profile.score,
      reports: profile.reports,
    });
  } catch {
    /* 总线不可用时只影响排行榜，不影响本机积分显示 */
  }
}

async function refresh_stats() {
  try {
    stats_cache = await get_json("/api/stats");
  } catch {
    stats_cache = null;
  }
  render_battle();
}

async function refresh_leaderboard() {
  try {
    const data = await get_json("/api/participants");
    if (data && Array.isArray(data.participants)) {
      participants_cache = { count: data.count || data.participants.length, participants: data.participants };
    }
  } catch {
    /* 保留上一次的榜单 */
  }
  render_leaderboard();
}

/* 上报成功后的统一动作：积分 + 回执 + 受理条 + 战报刷新 */
function after_visitor_report_success() {
  add_points(20, { report: true, join: true });
  show_toast("已上报指挥中心，等待派单…", "visitor");
  show_visitor_pending();
  const arrived = state && state.incidents.some((inc) => inc.visitor && !visitor_baseline.has(inc.id));
  if (arrived) {
    setTimeout(() => {
      if (visitor_pending) hide_visitor_pending();
    }, 1400);
  }
  refresh_stats();
  refresh_leaderboard();
}

/* ── Tab 切换 ────────────────────────────────────────────────────────── */

function switch_tab(tab, { silent = false } = {}) {
  if (!["alerts", "models", "join", "me"].includes(tab)) return;
  active_tab = tab;
  dom.app.dataset.activeTab = tab;
  for (const btn of tab_btns) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of view_panels) {
    panel.classList.toggle("is-active", panel.dataset.panel === tab);
  }
  if (tab === "models") render_models_tab();
  if (tab === "join") {
    refresh_stats();
    render_battle();
  }
  if (tab === "me") {
    sync_profile_ui();
    sync_conn_info();
    refresh_leaderboard();
  }
  if (!silent) {
    const panel = view_panels.find((item) => item.dataset.panel === tab);
    if (panel) panel.scrollTop = 0;
  }
}

/* ── 模型 Tab：整页四模型 ────────────────────────────────────────────── */

const model_tab_cards = new Map();

function build_models_tab() {
  if (dom.models_tab_grid.childElementCount) return;
  const fragment = document.createDocumentFragment();
  for (const key of MODEL_ORDER) {
    const meta = SCENE_MODELS[key];
    const el = document.createElement("article");
    el.className = "mt-card";
    el.dataset.model = key;
    el.style.setProperty("--model-accent", meta.accent);
    el.innerHTML = [
      '<header class="mt-head">',
      '  <span class="mt-dot" aria-hidden="true"></span>',
      '  <h3 class="mt-name"></h3>',
      '  <span class="mt-badge">当前场景</span>',
      "</header>",
      '<p class="mt-tagline"></p>',
      '<div class="mt-metrics">',
      '  <span>今日预警<b class="mt-today">0</b></span>',
      '  <span>场景<b class="mt-scene"></b></span>',
      "</div>",
      '<div class="mt-caps"></div>',
    ].join("");
    el.querySelector(".mt-name").textContent = meta.name;
    el.querySelector(".mt-tagline").textContent = meta.tagline;
    el.querySelector(".mt-scene").textContent = meta.scene_label;
    const caps = el.querySelector(".mt-caps");
    for (const capability of meta.capabilities) {
      const span = document.createElement("span");
      span.textContent = capability;
      caps.append(span);
    }
    model_tab_cards.set(key, { el, today: el.querySelector(".mt-today") });
    fragment.append(el);
  }
  dom.models_tab_grid.append(fragment);

  dom.models_tab_chain.replaceChildren(
    ...MODEL_CHAIN.map((step, index) => {
      const item = document.createElement("li");
      item.className = "chain-list-item";
      const idx = document.createElement("span");
      idx.className = "chain-list-idx";
      idx.textContent = String(index + 1).padStart(2, "0");
      const body = document.createElement("div");
      body.className = "chain-list-body";
      const label = document.createElement("strong");
      label.textContent = step.label;
      const note = document.createElement("p");
      note.textContent = step.note;
      body.append(label, note);
      item.append(idx, body);
      return item;
    })
  );
}

function render_models_tab() {
  if (!dom.models_tab_grid.childElementCount) return;
  const today0 = start_of_today();
  const current = state && state.scene ? state.scene.id : null;
  for (const key of MODEL_ORDER) {
    const rec = model_tab_cards.get(key);
    if (!rec) continue;
    const meta = SCENE_MODELS[key];
    const count = state
      ? state.incidents.filter((inc) => inc.scene === meta.scene && (inc.created_ts || 0) >= today0).length
      : 0;
    set_text(rec.today, count);
    rec.el.classList.toggle("is-current", key === current);
  }
}

/* ── 战报 / 排行榜 / 我的 ────────────────────────────────────────────── */

function render_battle() {
  const stats = stats_cache;
  if (!stats) return;
  set_text(dom.battle_participants, stats.participants || 0);
  set_text(dom.battle_reports, stats.visitor_reports || 0);
  set_text(dom.battle_fastest, Number.isFinite(stats.fastest_resolve_s) ? `${stats.fastest_resolve_s} 秒` : "—");
  if (dom.hero_online && Number.isFinite(stats.participants)) set_text(dom.hero_online, `本场 ${stats.participants} 人`);

  const by_kind = stats.by_kind || {};
  const max = Math.max(1, ...BATTLE_KINDS.map(([key]) => by_kind[key] || 0));
  dom.battle_kinds.replaceChildren(
    ...BATTLE_KINDS.map(([key, label]) => {
      const row = document.createElement("div");
      row.className = "battle-bar-row";
      const name = document.createElement("span");
      name.textContent = label;
      const bar = document.createElement("span");
      bar.className = "battle-bar";
      const fill = document.createElement("i");
      fill.style.width = `${Math.round(((by_kind[key] || 0) / max) * 100)}%`;
      bar.append(fill);
      const count = document.createElement("b");
      count.textContent = by_kind[key] || 0;
      row.append(name, bar, count);
      return row;
    })
  );

  const by_scene = stats.by_scene || {};
  const chips = SCENE_ORDER.filter((id) => by_scene[id]).map((id) => {
    const span = document.createElement("span");
    span.className = "battle-scene-chip";
    span.textContent = `${SCENE_MODELS[id].scene_label} ${by_scene[id]}`;
    return span;
  });
  if (!chips.length) {
    const empty = document.createElement("span");
    empty.className = "battle-scene-chip";
    empty.textContent = "本场暂无观众上报";
    chips.push(empty);
  }
  dom.battle_scenes.replaceChildren(...chips);
}

function render_leaderboard() {
  const list = participants_cache.participants || [];
  const count = participants_cache.count || list.length;
  if (dom.hero_online) set_text(dom.hero_online, `本场 ${count} 人`);
  if (dom.me_online) set_text(dom.me_online, `在线 ${count} 人 · 每 30 秒同步一次`);

  const top = list.slice(0, 6);
  dom.me_board.replaceChildren(
    ...top.map((item, index) => {
      const row = document.createElement("li");
      row.className = "me-board-row";
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1);
      const who = document.createElement("span");
      who.className = "who";
      const name = document.createElement("b");
      name.textContent = item.name || "匿名值班员";
      const meta = document.createElement("small");
      meta.textContent = `${item.role_name || ROLE_LABELS[item.role] || "观众"} · 上报 ${item.reports || 0} 次`;
      who.append(name, meta);
      const pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = String(item.score || 0);
      row.append(rank, who, pts);
      return row;
    })
  );
  if (!top.length) {
    const empty = document.createElement("li");
    empty.className = "me-board-empty";
    empty.textContent = "还没有值班员上线，参与一次就能上榜。";
    dom.me_board.append(empty);
  }

  const mine = list.findIndex((item) => item.client_id === get_client_id());
  if (dom.me_rank) set_text(dom.me_rank, mine >= 0 ? `#${mine + 1}` : "—");
}

function sync_profile_ui() {
  if (!profile.name) profile.name = default_name_for(profile.role);
  if (dom.me_name && document.activeElement !== dom.me_name) dom.me_name.value = profile.name;
  if (dom.me_avatar) dom.me_avatar.textContent = (profile.name || "A").slice(0, 1).toUpperCase();
  if (dom.me_role_label) dom.me_role_label.textContent = ROLE_LABELS[profile.role];
  if (dom.me_score) set_text(dom.me_score, profile.score);
  if (dom.me_level) dom.me_level.innerHTML = level_html(profile.score);
  if (dom.level_mini) dom.level_mini.innerHTML = level_html(profile.score);
  if (dom.me_joins) set_text(dom.me_joins, profile.joins);
  if (dom.me_reports) set_text(dom.me_reports, profile.reports);
  if (dom.me_client) set_text(dom.me_client, get_client_id());
  for (const btn of dom.role_grid.querySelectorAll("[data-role]")) {
    btn.classList.toggle("is-active", btn.dataset.role === profile.role);
  }
  apply_sound_ui();
}

function sync_conn_info() {
  if (!state) return;
  const scene = state.scene && SCENE_MODELS[state.scene.id] ? SCENE_MODELS[state.scene.id] : null;
  set_text(dom.me_conn_info, `${mode_label(state.mode)}${scene ? " · " + scene.name : " · 等待场景"}`);
}

function reset_local_data() {
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(CLIENT_KEY);
  } catch {
    /* 存不了也不影响本次重置 */
  }
  profile.role = "visitor";
  profile.name = default_name_for("visitor");
  profile.score = 0;
  profile.reports = 0;
  profile.joins = 0;
  save_profile();
  sync_profile_ui();
  update_participant();
  refresh_leaderboard();
  show_toast("本机数据已重置，重新开始攒积分", "visitor");
}

/* ── 语音上报 / 语音指挥大屏 ─────────────────────────────────────────── */

let voice_open = false;
let voice_mode = "report";
let voice_recording = false;
let voice_heard = "";
let voice_parsed = null;
let voice_speech = null;
let voice_auto_stop = 0;
let voice_busy = false;

function online_count_text() {
  const count = stats_cache ? stats_cache.participants : participants_cache.count;
  return `本场 ${count || 0} 人`;
}

function set_voice_status(text, tone = "") {
  dom.voice_status.textContent = text || "";
  dom.voice_status.classList.toggle("is-ok", tone === "ok");
  dom.voice_status.classList.toggle("is-error", tone === "error");
}

function reset_voice_ui() {
  voice_heard = "";
  voice_parsed = null;
  voice_recording = false;
  voice_busy = false;
  dom.voice.classList.remove("is-recording");
  dom.voice_transcript.hidden = true;
  dom.voice_result.hidden = true;
  dom.voice_submit.hidden = true;
  dom.voice_submit.disabled = false;
  dom.voice_hint.textContent = "按住不放，松手识别；没有语音服务时自动使用模拟识别";
  const report = voice_mode === "report";
  dom.voice_kicker.textContent = report ? "语音上报" : "语音指挥";
  dom.voice_title.textContent = report ? "按住说话，AI 帮你上报" : "按住说话，指挥大屏";
  dom.voice_sub.textContent = report
    ? "说一句「校园发现明火」，自动识别场景与异常"
    : "说「切换到小区」「跟随机器狗」「查看战报」";
  dom.voice_hold.textContent = "按住说话";
  set_voice_status("", "");
}

function open_voice(mode) {
  if (voice_open) return;
  voice_mode = mode === "command" ? "command" : "report";
  voice_open = true;
  reset_voice_ui();
  dom.voice.hidden = false;
  document.body.classList.add("voice-open");
  requestAnimationFrame(() => {
    if (voice_open) dom.voice.classList.add("is-open");
  });
  dom.voice_close.focus({ preventScroll: true });
}

function close_voice() {
  if (!voice_open) return;
  voice_open = false;
  voice_recording = false;
  clearTimeout(voice_auto_stop);
  try {
    if (voice_speech) voice_speech.stop();
  } catch {
    /* 忽略 */
  }
  voice_speech = null;
  dom.voice.classList.remove("is-open", "is-recording");
  document.body.classList.remove("voice-open");
  setTimeout(() => {
    if (!voice_open) dom.voice.hidden = true;
  }, 320);
}

function simulated_voice_text() {
  if (voice_mode === "command") {
    const pool = [
      "切换到小区场景",
      "跟随机器狗",
      "查看本场战报",
      "打开全景总览",
      "切换到森林场景",
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const current = state && state.scene && SCENE_MODELS[state.scene.id] ? state.scene.id : null;
  const scene = current || SCENE_ORDER[Math.floor(Math.random() * SCENE_ORDER.length)];
  const kind = JOIN_KIND[scene];
  return `${SCENE_MODELS[scene].scene_label}发现${SCENE_MODELS[scene].alert_names[kind]}，请尽快处理`;
}

function start_voice() {
  if (!voice_open || voice_recording || voice_busy) return;
  voice_recording = true;
  voice_heard = "";
  dom.voice.classList.add("is-recording");
  dom.voice_hold.textContent = "松手识别";
  dom.voice_hint.textContent = "正在听…松手结束";
  dom.voice_transcript.hidden = false;
  dom.voice_text.textContent = "正在聆听…";
  dom.voice_result.hidden = true;
  dom.voice_submit.hidden = true;
  set_voice_status("", "");
  clearTimeout(voice_auto_stop);
  voice_auto_stop = setTimeout(() => {
    if (voice_recording) stop_voice();
  }, 6000);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try {
    voice_speech = new SR();
    voice_speech.lang = "zh-CN";
    voice_speech.interimResults = true;
    voice_speech.maxAlternatives = 1;
    voice_speech.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
      voice_heard = text.trim().slice(0, 80);
      if (voice_heard) dom.voice_text.textContent = voice_heard;
    };
    voice_speech.onerror = () => {
      voice_speech = null;
    };
    voice_speech.onend = () => {
      voice_speech = null;
    };
    voice_speech.start();
  } catch {
    voice_speech = null;
  }
}

function stop_voice() {
  if (!voice_recording) return;
  voice_recording = false;
  clearTimeout(voice_auto_stop);
  dom.voice.classList.remove("is-recording");
  dom.voice_hold.textContent = "按住说话";
  try {
    if (voice_speech) voice_speech.stop();
  } catch {
    /* 浏览器没有真的在听就算了 */
  }
  voice_speech = null;

  const text = voice_heard || simulated_voice_text();
  voice_heard = text;
  dom.voice_transcript.hidden = false;
  dom.voice_text.textContent = text;
  voice_parsed = parse_voice_text(text);
  render_voice_result();
  dom.voice_result.hidden = false;
  dom.voice_submit.hidden = false;
  dom.voice_submit.disabled = false;
  dom.voice_submit_text.textContent = voice_mode === "report" ? "一键上报" : "发送语音指令";
  dom.voice_hint.textContent =
    voice_mode === "report" ? "可再按住重新说一句" : "可再按住说一条新指令";
  set_voice_status(
    voice_mode === "report" ? "识别完成，确认后上报指挥中心" : "识别完成，确认后发送给大屏",
    "ok"
  );
}

const VOICE_SCENE_WORDS = [
  ["campus", ["校园", "学校", "教学楼", "宿舍"]],
  ["community", ["小区", "社区", "住宅", "车库"]],
  ["subway", ["地铁", "站厅", "车站", "闸机"]],
  ["forest", ["森林", "林区", "山林", "山上", "防火道"]],
];
const VOICE_KIND_WORDS = [
  ["fire", ["明火", "着火", "火情", "起火", "烟火", "烟雾"]],
  ["crowd", ["聚集", "拥挤", "人群", "人员", "密度"]],
  ["trash", ["垃圾", "堆积", "乱堆", "杂物"]],
];

function parse_voice_text(text) {
  const raw = String(text || "");
  let scene = null;
  for (const [id, words] of VOICE_SCENE_WORDS) {
    if (words.some((word) => raw.includes(word))) {
      scene = id;
      break;
    }
  }
  let kind = null;
  for (const [id, words] of VOICE_KIND_WORDS) {
    if (words.some((word) => raw.includes(word))) {
      kind = id;
      break;
    }
  }

  if (voice_mode === "command") {
    let action = "overview";
    if (/切换|场景|大屏/.test(raw) && scene) action = "scene";
    else if (/跟随|跟拍|跟着|机器狗/.test(raw)) action = "follow";
    else if (/战报|统计|数据|成绩/.test(raw)) action = "battle";
    else if (/上报|报警|异常/.test(raw)) action = "report";
    return { mode: "command", action, scene, kind, confidence: 0.9, text: raw };
  }

  if (!scene) {
    scene = state && state.scene && SCENE_MODELS[state.scene.id] ? state.scene.id : "campus";
  }
  if (!kind) kind = JOIN_KIND[scene];
  const meta = SCENE_MODELS[scene];
  return {
    mode: "report",
    scene,
    kind,
    name: meta.alert_names[kind],
    confidence: 0.92,
    model: meta,
    text: raw,
  };
}

function voice_result_rows_html(rows) {
  return rows.map(([key, value]) => `<div><b>${key}</b><span>${value}</span></div>`).join("");
}

function render_voice_result() {
  const parsed = voice_parsed;
  if (!parsed) return;
  if (parsed.mode === "command") {
    dom.voice_result_kind.textContent = VOICE_ACTION_LABELS[parsed.action] || "语音指令";
    dom.voice_result_conf.textContent = "指挥指令";
    dom.voice_result_rows.innerHTML = voice_result_rows_html([
      ["动作", VOICE_ACTION_LABELS[parsed.action] || parsed.action],
      ["目标场景", parsed.scene ? SCENE_MODELS[parsed.scene].scene_label : "当前场景"],
      ["异常类型", parsed.kind ? SCENE_MODELS[parsed.scene || "campus"].alert_names[parsed.kind] : "不指定"],
      ["发送对象", "指挥大屏"],
    ]);
    return;
  }
  dom.voice_result_kind.textContent = parsed.name;
  dom.voice_result_conf.textContent = `置信度 ${Math.round(parsed.confidence * 100)}%`;
  dom.voice_result_rows.innerHTML = voice_result_rows_html([
    ["场景", parsed.model.scene_label],
    ["异常类型", parsed.name],
    ["主判模型", parsed.model.name],
    ["识别来源", "手机语音 · 意图识别"],
  ]);
}

async function submit_voice() {
  if (voice_busy || !voice_parsed) return;
  const parsed = voice_parsed;
  voice_busy = true;
  dom.voice_submit.disabled = true;
  set_voice_status("正在发送…", "");
  try {
    if (parsed.mode === "command") {
      const data = await post_json("/api/commands", {
        type: "voice_command",
        action: parsed.action,
        scene: parsed.scene || null,
        kind: parsed.kind || null,
        text: parsed.text,
        client_id: get_client_id(),
      });
      set_voice_status(
        data.mode === "big-screen" ? "指令已发送大屏，正在执行" : "指令已记录，大屏在线后执行",
        "ok"
      );
      dom.voice_submit.hidden = true;
      refresh_stats();
      setTimeout(() => {
        if (voice_open) close_voice();
      }, 900);
    } else {
      visitor_baseline = new Set(
        (state ? state.incidents : []).filter((inc) => inc.visitor).map((inc) => inc.id)
      );
      await send_visitor_report({
        scene: parsed.scene,
        kind: parsed.kind,
        name: parsed.name,
        confidence: parsed.confidence,
        note: "语音上报 · 观众",
      });
      set_voice_status("已上报指挥中心，正在返回列表…", "ok");
      dom.voice_submit.hidden = true;
      setTimeout(() => {
        if (voice_open) close_voice();
        after_visitor_report_success();
        switch_tab("alerts");
      }, 700);
    }
  } catch {
    voice_busy = false;
    dom.voice_submit.disabled = false;
    set_voice_status("上报通道未连接，稍后再试；可先浏览预警。", "error");
    return;
  }
  voice_busy = false;
}

/* ── AR 巡检点打卡 ───────────────────────────────────────────────────── */

let ar_open = false;
let ar_busy = false;
let ar_scene = "campus";
let ar_scan_count = 0;
let ar_result_data = null;
let ar_scan_raf = 0;

function open_ar() {
  if (ar_open) return;
  ar_open = true;
  reset_ar_result();
  dom.ar.hidden = false;
  document.body.classList.add("ar-open");
  requestAnimationFrame(() => {
    if (ar_open) dom.ar.classList.add("is-open");
  });
  dom.ar_close.focus({ preventScroll: true });
}

function close_ar() {
  if (!ar_open) return;
  ar_open = false;
  cancelAnimationFrame(ar_scan_raf);
  ar_busy = false;
  dom.ar.classList.remove("is-open");
  document.body.classList.remove("ar-open");
  setTimeout(() => {
    if (!ar_open) dom.ar.hidden = true;
  }, 320);
}

function reset_ar_result() {
  ar_result_data = null;
  ar_busy = false;
  dom.ar_scan.hidden = true;
  dom.ar_result.hidden = true;
  dom.ar_submit.hidden = true;
  dom.ar_hint.textContent = "选择一个巡检点开始扫描";
  dom.ar_status.textContent = "";
  for (const marker of dom.ar_markers.querySelectorAll("[data-ar-checkpoint]")) {
    marker.classList.remove("is-scanning");
  }
  dom.ar_scan_fill.style.width = "0%";
}

function start_ar_scan(scene) {
  if (ar_busy) return;
  if (!SCENE_MODELS[scene]) return;
  ar_scene = scene;
  ar_busy = true;
  ar_result_data = null;
  dom.ar_result.hidden = true;
  dom.ar_submit.hidden = true;
  dom.ar_scan.hidden = false;
  dom.ar_scan_text.textContent = `正在扫描 ${SCENE_MODELS[scene].scene_label} 巡检点…`;
  dom.ar_status.textContent = "保持镜头稳定，模型正在识别现场…";
  dom.ar_hint.textContent = "扫描中，请稍候…";
  for (const marker of dom.ar_markers.querySelectorAll("[data-ar-checkpoint]")) {
    marker.classList.toggle("is-scanning", marker.dataset.arCheckpoint === scene);
  }
  const started = performance.now();
  const duration = 1700;
  const tick = (now) => {
    if (!ar_open || !ar_busy) return;
    const pct = Math.min(100, Math.round(((now - started) / duration) * 100));
    dom.ar_scan_fill.style.width = `${pct}%`;
    if (pct < 100) {
      ar_scan_raf = requestAnimationFrame(tick);
    } else {
      finish_ar_scan();
    }
  };
  ar_scan_raf = requestAnimationFrame(tick);
}

function finish_ar_scan() {
  ar_busy = false;
  dom.ar_scan.hidden = true;
  dom.ar_scan_fill.style.width = "0%";
  for (const marker of dom.ar_markers.querySelectorAll("[data-ar-checkpoint]")) {
    marker.classList.remove("is-scanning");
  }
  /* 第一次扫描必出异常，保证展台第一次就有闭环可讲；之后约一半正常 */
  const anomaly = ar_scan_count === 0 || Math.random() < 0.5;
  ar_scan_count += 1;
  const meta = SCENE_MODELS[ar_scene];
  const kind = JOIN_KIND[ar_scene];
  const name = meta.alert_names[kind];
  dom.ar_result.hidden = false;
  dom.ar_hint.textContent = "可点其它巡检点继续扫描";

  if (!anomaly) {
    ar_result_data = null;
    dom.ar_result_title.textContent = "巡检正常";
    dom.ar_result_conf.textContent = "100%";
    dom.ar_result_text.textContent = `${meta.scene_label}巡检点未发现异常，已记录本次打卡。`;
    dom.ar_submit.hidden = true;
    dom.ar_status.textContent = "巡检正常，本点位打卡完成。";
    return;
  }

  const confidence = Math.round((0.88 + Math.random() * 0.08) * 100) / 100;
  const base = default_analysis(kind, {
    id: `ar-${Date.now()}`,
    name,
    area: `${meta.scene_label}巡检点`,
    camera: "AR 巡检",
  });
  ar_result_data = { scene: ar_scene, kind, name, confidence, rationale: base.rationale };
  dom.ar_result_title.textContent = `${name} · 疑似异常`;
  dom.ar_result_conf.textContent = `置信度 ${Math.round(confidence * 100)}%`;
  dom.ar_result_text.textContent = base.rationale;
  dom.ar_submit.hidden = false;
  dom.ar_status.textContent = "发现异常，可一键上报指挥中心。";
}

async function submit_ar_report() {
  if (!ar_result_data || ar_busy) return;
  const data = ar_result_data;
  ar_busy = true;
  dom.ar_submit.disabled = true;
  dom.ar_status.textContent = "正在上报指挥中心…";
  visitor_baseline = new Set((state ? state.incidents : []).filter((inc) => inc.visitor).map((inc) => inc.id));
  try {
    await send_visitor_report({
      scene: data.scene,
      kind: data.kind,
      name: data.name,
      confidence: data.confidence,
      note: "AR 巡检点上报",
    });
    dom.ar_status.textContent = "已上报指挥中心，正在返回列表…";
    setTimeout(() => {
      if (ar_open) close_ar();
      after_visitor_report_success();
      switch_tab("alerts");
    }, 700);
  } catch {
    ar_busy = false;
    dom.ar_submit.disabled = false;
    dom.ar_status.textContent = "上报通道未连接，稍后再试。";
  }
}

/* ── 模型盲盒 ────────────────────────────────────────────────────────── */

const QUIZ_TOTAL = 5;
const QUIZ_PALETTES = {
  campus: ["#08131f", "#0e2b3f", "#5ee7ff"],
  community: ["#1a120c", "#33210f", "#ffb454"],
  subway: ["#130f22", "#241a44", "#a78bfa"],
  forest: ["#07150f", "#0f2a1d", "#43e0a0"],
};

let quiz_open = false;
let quiz_round = 0;
let quiz_score = 0;
let quiz_streak = 0;
let quiz_best = 0;
let quiz_busy = false;
let quiz_current = null;
let quiz_advance_timer = 0;

function open_quiz() {
  if (quiz_open) return;
  quiz_open = true;
  dom.quiz.hidden = false;
  document.body.classList.add("quiz-open");
  requestAnimationFrame(() => {
    if (quiz_open) dom.quiz.classList.add("is-open");
  });
  dom.quiz_close.focus({ preventScroll: true });
  reset_quiz();
  next_quiz_round();
}

function close_quiz() {
  if (!quiz_open) return;
  quiz_open = false;
  clearTimeout(quiz_advance_timer);
  dom.quiz.classList.remove("is-open");
  document.body.classList.remove("quiz-open");
  setTimeout(() => {
    if (!quiz_open) dom.quiz.hidden = true;
  }, 320);
}

function reset_quiz() {
  quiz_round = 0;
  quiz_score = 0;
  quiz_streak = 0;
  quiz_best = 0;
  quiz_busy = false;
  quiz_current = null;
  clearTimeout(quiz_advance_timer);
  dom.quiz_result.hidden = true;
  dom.quiz_reveal.hidden = true;
  dom.quiz_options.replaceChildren();
  dom.quiz_rank.disabled = false;
  dom.quiz_rank.textContent = "登记上榜";
  update_quiz_scorebar();
  set_quiz_status("", "");
}

function update_quiz_scorebar() {
  set_text(dom.quiz_score, quiz_score);
  set_text(dom.quiz_streak, quiz_streak);
}

function set_quiz_status(text, tone = "") {
  dom.quiz_status.textContent = text || "";
  dom.quiz_status.classList.toggle("is-ok", tone === "ok");
  dom.quiz_status.classList.toggle("is-error", tone === "error");
}

function draw_quiz_scene(scene, kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const palette = QUIZ_PALETTES[scene] || QUIZ_PALETTES.campus;
  const bg = ctx.createLinearGradient(0, 0, 0, 400);
  bg.addColorStop(0, palette[0]);
  bg.addColorStop(1, "#04070c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 400);

  const accent = palette[2];
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 9; i += 1) {
    const w = 40 + Math.random() * 70;
    const h = 70 + Math.random() * 190;
    const x = Math.random() * 560;
    const y = 400 - h - Math.random() * 40;
    ctx.fillStyle = i % 3 === 0 ? palette[1] : "rgba(14, 22, 34, 0.9)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `rgba(255, 255, 255, 0.1)`;
    for (let wy = y + 12; wy < y + h - 10; wy += 22) {
      for (let wx = x + 8; wx < x + w - 10; wx += 18) {
        if (Math.random() > 0.55) ctx.fillRect(wx, wy, 7, 9);
      }
    }
  }
  ctx.globalAlpha = 1;

  const kindColor = kind === "fire" ? "255, 120, 60" : kind === "crowd" ? "120, 160, 255" : "255, 210, 100";
  const cx = 210 + Math.random() * 220;
  const cy = 230 + Math.random() * 80;
  const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 120);
  glow.addColorStop(0, `rgba(${kindColor}, 0.9)`);
  glow.addColorStop(1, `rgba(${kindColor}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, 120, 0, Math.PI * 2);
  ctx.fill();
  if (kind === "crowd") {
    ctx.fillStyle = `rgba(${kindColor}, 0.55)`;
    for (let i = 0; i < 12; i += 1) {
      ctx.beginPath();
      ctx.arc(cx - 60 + Math.random() * 120, cy - 40 + Math.random() * 70, 5 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "trash") {
    ctx.fillStyle = `rgba(${kindColor}, 0.45)`;
    for (let i = 0; i < 8; i += 1) {
      ctx.fillRect(cx - 60 + Math.random() * 110, cy - 30 + Math.random() * 60, 10 + Math.random() * 22, 8 + Math.random() * 12);
    }
  }

  ctx.strokeStyle = "rgba(160, 200, 230, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 640; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 400);
    ctx.stroke();
  }
  for (let y = 0; y <= 400; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(640, y);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(${kindColor}, 0.65)`;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 52, cy - 44, 104, 88);

  return canvas.toDataURL("image/jpeg", 0.82);
}

function next_quiz_round() {
  if (!quiz_open) return;
  if (quiz_round >= QUIZ_TOTAL) {
    finish_quiz();
    return;
  }
  quiz_round += 1;
  quiz_busy = false;
  const scene = SCENE_ORDER[Math.floor(Math.random() * SCENE_ORDER.length)];
  const kind = JOIN_KIND[scene];
  const confidence = Math.round((0.86 + Math.random() * 0.1) * 100) / 100;
  quiz_current = {
    scene,
    kind,
    name: SCENE_MODELS[scene].alert_names[kind],
    confidence,
  };
  dom.quiz_step.textContent = `第 ${quiz_round} / ${QUIZ_TOTAL} 轮`;
  dom.quiz_image.src = draw_quiz_scene(scene, kind);
  dom.quiz_question.textContent = "这张现场图最可能由哪个场景模型识别？";
  dom.quiz_reveal.hidden = true;
  dom.quiz_result.hidden = true;
  set_quiz_status("", "");

  const distractors = SCENE_ORDER.filter((id) => id !== scene).sort(() => Math.random() - 0.5).slice(0, 2);
  const options = [scene, ...distractors].sort(() => Math.random() - 0.5);
  dom.quiz_options.replaceChildren(
    ...options.map((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.dataset.scene = id;
      btn.textContent = `${SCENE_MODELS[id].scene_label} · ${SCENE_MODELS[id].name}`;
      if (id === scene) btn.dataset.correct = "true";
      btn.addEventListener("click", () => answer_quiz(id));
      return btn;
    })
  );
  update_quiz_scorebar();
}

function answer_quiz(chosen) {
  if (quiz_busy || !quiz_current) return;
  quiz_busy = true;
  const correct = chosen === quiz_current.scene;
  let gain = 0;
  for (const btn of dom.quiz_options.querySelectorAll(".quiz-option")) {
    btn.disabled = true;
    if (btn.dataset.correct === "true") btn.classList.add("is-correct");
    else if (btn.dataset.scene === chosen) btn.classList.add("is-wrong");
  }
  if (correct) {
    gain = quiz_streak > 0 ? 15 : 10;
    quiz_score += gain;
    quiz_streak += 1;
    quiz_best = Math.max(quiz_best, quiz_streak);
  } else {
    quiz_streak = 0;
  }
  update_quiz_scorebar();
  dom.quiz_reveal.hidden = false;
  dom.quiz_reveal.innerHTML = correct
    ? `<b>答对了 +${gain} 分</b> · 这张图来自${SCENE_MODELS[quiz_current.scene].scene_label}，${SCENE_MODELS[quiz_current.scene].name} 识别到${quiz_current.name}，模型置信度 ${Math.round(quiz_current.confidence * 100)}%。`
    : `<b>差一点</b> · 正确答案是${SCENE_MODELS[quiz_current.scene].scene_label}（${SCENE_MODELS[quiz_current.scene].name}），模型置信度 ${Math.round(quiz_current.confidence * 100)}%。`;
  set_quiz_status(correct ? `连对 ${quiz_streak} 次，继续下一轮` : "连对中断，下一轮再来", correct ? "ok" : "error");
  clearTimeout(quiz_advance_timer);
  quiz_advance_timer = setTimeout(() => {
    if (quiz_open) next_quiz_round();
  }, 1400);
}

function finish_quiz() {
  dom.quiz_options.replaceChildren();
  dom.quiz_reveal.hidden = true;
  dom.quiz_result.hidden = false;
  dom.quiz_step.textContent = `完成 ${QUIZ_TOTAL} / ${QUIZ_TOTAL} 轮`;
  set_text(dom.quiz_final_score, quiz_score);
  set_text(dom.quiz_best_streak, quiz_best);
  set_quiz_status("把本局得分登记到本场排行榜吧", "");
}

async function rank_quiz() {
  if (dom.quiz_rank.disabled) return;
  dom.quiz_rank.disabled = true;
  dom.quiz_rank.textContent = "登记中…";
  add_points(quiz_score, { join: true });
  try {
    await update_participant();
    dom.quiz_rank.textContent = "已上榜";
    set_quiz_status(`已登记上榜：+${quiz_score} 积分`, "ok");
    refresh_leaderboard();
    refresh_stats();
  } catch {
    dom.quiz_rank.disabled = false;
    dom.quiz_rank.textContent = "重新登记";
    set_quiz_status("排行榜暂不可用，稍后再试", "error");
  }
}

/* ── 现场回传：机器狗第一视角 ────────────────────────────────────────── */

let live_timer = 0;
let live_active_id = null;

async function poll_live_frame() {
  if (!live_active_id) return;
  try {
    const data = await get_json("/api/frames/latest");
    const frame = data && data.frame;
    if (!frame) {
      if (!dom.live_frame.getAttribute("src")) {
        dom.live_frame.hidden = true;
        dom.live_empty.hidden = false;
        set_text(dom.live_meta, "等待机器狗到场回传…");
      }
      return;
    }
    if (dom.live_frame.dataset.ts === String(frame.ts)) return;
    dom.live_frame.src = frame.dataUrl;
    dom.live_frame.dataset.ts = String(frame.ts);
    dom.live_frame.hidden = false;
    dom.live_empty.hidden = true;
    if (dom.live_time) dom.live_time.textContent = format_hms(frame.ts);
    const scene = frame.scene && SCENE_MODELS[frame.scene] ? SCENE_MODELS[frame.scene].scene_label : frame.scene || "现场";
    set_text(
      dom.live_meta,
      `机器狗第一视角 · ${scene}${frame.device ? " · " + frame.device : ""} · ${format_hms(frame.ts)}`
    );
  } catch {
    /* 总线断开时保持「等待回传」文案 */
  }
}

function start_live_poll(inc) {
  if (!inc || inc.visitor !== true) {
    stop_live_poll();
    return;
  }
  dom.sheet_live.hidden = false;
  if (live_active_id !== inc.id) {
    live_active_id = inc.id;
    dom.live_frame.hidden = true;
    dom.live_frame.removeAttribute("src");
    dom.live_frame.removeAttribute("data-ts");
    dom.live_empty.hidden = false;
    set_text(dom.live_meta, "等待机器狗到场回传…");
    if (dom.live_time) dom.live_time.textContent = "";
  }
  if (!live_timer) {
    poll_live_frame();
    live_timer = setInterval(poll_live_frame, 700);
  }
}

function stop_live_poll() {
  if (live_timer) {
    clearInterval(live_timer);
    live_timer = 0;
  }
  live_active_id = null;
  dom.sheet_live.hidden = true;
  dom.live_frame.hidden = true;
  dom.live_frame.removeAttribute("src");
  dom.live_frame.removeAttribute("data-ts");
  dom.live_empty.hidden = false;
  if (dom.live_time) dom.live_time.textContent = "";
}

/* ── 初始化与事件绑定 ────────────────────────────────────────────────── */

function on_aegis_keydown(event) {
  if (event.key !== "Escape") return;
  if (voice_open) {
    event.preventDefault();
    close_voice();
    return;
  }
  if (ar_open) {
    event.preventDefault();
    close_ar();
    return;
  }
  if (quiz_open) {
    event.preventDefault();
    close_quiz();
  }
}

function init_aegis() {
  ensure_profile();
  build_models_tab();
  sync_profile_ui();
  render_battle();
  render_leaderboard();
  switch_tab("alerts", { silent: true });

  for (const btn of tab_btns) {
    btn.addEventListener("click", () => switch_tab(btn.dataset.tab));
  }

  dom.entry_photo.addEventListener("click", open_join);
  dom.entry_voice.addEventListener("click", () => open_voice("report"));
  dom.entry_ar.addEventListener("click", open_ar);
  dom.entry_quiz.addEventListener("click", open_quiz);
  dom.entry_voice_cmd.addEventListener("click", () => open_voice("command"));
  dom.models_full_btn.addEventListener("click", open_models);

  dom.role_grid.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-role]");
    if (!btn) return;
    const role = btn.dataset.role;
    if (!ROLE_LABELS[role] || role === profile.role) return;
    profile.role = role;
    save_profile();
    sync_profile_ui();
    update_participant();
    refresh_leaderboard();
    show_toast(`值班员身份已切换为${ROLE_LABELS[role]}`, "visitor");
  });

  dom.me_name.addEventListener("change", () => {
    profile.name = dom.me_name.value.trim().slice(0, 16) || default_name_for(profile.role);
    save_profile();
    sync_profile_ui();
    update_participant();
    refresh_leaderboard();
  });

  dom.me_sound.addEventListener("click", () => {
    sound_on = !sound_on;
    save_sound();
    apply_sound_ui();
  });

  dom.me_reset.addEventListener("click", reset_local_data);

  dom.voice_close.addEventListener("click", close_voice);
  dom.voice.addEventListener("click", (event) => {
    if (event.target.closest("[data-voice-close]")) close_voice();
  });
  dom.voice_hold.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    start_voice();
  });
  dom.voice_hold.addEventListener("pointerup", stop_voice);
  dom.voice_hold.addEventListener("pointercancel", stop_voice);
  dom.voice_hold.addEventListener("pointerleave", () => {
    if (voice_recording) stop_voice();
  });
  dom.voice_hold.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) start_voice();
    }
  });
  dom.voice_hold.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stop_voice();
    }
  });
  dom.voice_submit.addEventListener("click", submit_voice);

  dom.ar_close.addEventListener("click", close_ar);
  dom.ar.addEventListener("click", (event) => {
    if (event.target.closest("[data-ar-close]")) close_ar();
  });
  dom.ar_markers.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-ar-checkpoint]");
    if (btn) start_ar_scan(btn.dataset.arCheckpoint);
  });
  dom.ar_rescan.addEventListener("click", () => {
    reset_ar_result();
    dom.ar_hint.textContent = "选择一个巡检点开始扫描";
  });
  dom.ar_submit.addEventListener("click", submit_ar_report);

  dom.quiz_close.addEventListener("click", close_quiz);
  dom.quiz.addEventListener("click", (event) => {
    if (event.target.closest("[data-quiz-close]")) close_quiz();
  });
  dom.quiz_rank.addEventListener("click", rank_quiz);
  dom.quiz_replay.addEventListener("click", () => {
    reset_quiz();
    next_quiz_round();
  });

  document.addEventListener("keydown", on_aegis_keydown);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refresh_stats();
    refresh_leaderboard();
  });

  update_participant();
  refresh_stats();
  refresh_leaderboard();
  if (stats_timer) clearInterval(stats_timer);
  stats_timer = setInterval(() => {
    update_participant();
    refresh_stats();
    refresh_leaderboard();
  }, 30000);
}


/* ── 启动 ────────────────────────────────────────────────────────────── */

function boot() {
  apply_sound_ui();
  wire_events();
  store.subscribe((next, meta) => {
    state = next;
    render(next, meta);
  });
  init_aegis();
  store.start();
}

boot();
