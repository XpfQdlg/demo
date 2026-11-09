/* ══════════════════════════════════════════════════════════════════════════
   store — 预警接收页的状态与数据源

   对 UI 只暴露一件事：订阅一个 state，变了就重画。
   UI 不需要知道现在连的是指挥大屏、还是离线演示。

   数据源优先级：
     1. 本机总线（开发服里的 /api/alerts/stream，SSE）。连上就进入 live。
     2. 离线演示（demo_feed.js）。首次连不上、或实时断掉后用户手动切过去。
   状态机：
     connecting → live        收到总线快照
     connecting → demo        连不上，演示数据兜底
     live       → reconnecting 实时断线，自动重连，数据保留
     reconnecting → live / demo（用户点「使用演示数据」）

   不把 BroadcastChannel 当方案：手机与电脑是两个设备，它出不了本机。
   ══════════════════════════════════════════════════════════════════════════ */

import {
  EVENT_LABELS,
  format_distance,
  format_seconds,
  is_active_incident,
  normalize_event,
  normalize_snapshot,
  status_meta,
} from "./contract.js";
import { create_demo_feed } from "./demo_feed.js";

const STORAGE_KEY = "warning_receiver.v1";
const LIVE_FALLBACK_MS = 2600;      // 首次连接多久连不上就进演示模式
const RECONNECT_STEPS = [2000, 4000, 8000, 15000];
const MAX_INCIDENTS = 40;           // 列表最多保留多少起（正在处置的一定保留）
const MAX_EVENTS = 80;              // 内存里保留的最近事件
const STALE_ACTIVE_MS = 15 * 60 * 1000;   // 刷新页面后，超过这个时长的「进行中」不再算进行中

/* ── 小工具 ──────────────────────────────────────────────────────────── */

function start_of_today(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function safe_parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function bus_url(path) {
  /* 允许 ?bus=http://192.168.x.x:5179 指定总线地址：
     以后用单文件离线包 + 一台本机小服务时，桌面端与手机端可以指向同一个地址 */
  const base = new URLSearchParams(location.search).get("bus");
  if (base) return new URL(path, base.endsWith("/") ? base : base + "/").toString();
  return path;
}

/* ── 持久化：手机锁屏、切后台、刷新后回到列表时还能看到刚才的预警 ───── */

function load_saved() {
  try {
    const raw = safe_parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.incidents)) return null;
    return raw;
  } catch {
    return null;   // 隐私模式 / 存储被禁用：安静降级，不阻塞页面
  }
}

function save_now(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        saved_ts: Date.now(),
        scene: state.scene,
        source: state.source,
        incidents: state.incidents.slice(0, MAX_INCIDENTS),
      })
    );
  } catch {
    /* 存不下就算了，页面照常用 */
  }
}

/* ── 事件 → 卡片 ────────────────────────────────────────────────────── */

/** 时间线上的一条记录，文案是给现场讲解员看的「人话」 */
function timeline_text(event, incident, agent_name) {
  switch (event.type) {
    case "alarm":
      return event.note || `${incident.area}发现${incident.name}`;
    case "dispatched": {
      const dev = agent_name || "执行体";
      const bits = [`已派 ${dev} 前往`];
      if (Number.isFinite(event.distance_m)) bits.push(`约 ${format_distance(event.distance_m)}`);
      if (Number.isFinite(event.eta_s)) bits.push(`预计 ${format_seconds(event.eta_s)} 到位`);
      return bits.join("，");
    }
    case "arrive":
      return `${agent_name || "执行体"} 已到场，开始扫描确认`;
    case "handling":
      return `${agent_name || "执行体"} 开始处置现场`;
    case "resolved":
      return `${agent_name || "执行体"} 处置完成，现场恢复`;
    default:
      return EVENT_LABELS[event.type] || "状态更新";
  }
}

function new_incident_from_event(event) {
  const raw = event.incident;
  const status = event.status || "pending";
  return {
    id: raw.id,
    kind: raw.kind,
    name: raw.name,
    scene: raw.scene,
    scene_label: raw.scene_label,
    area: raw.area,
    camera: raw.camera,
    round: raw.round,
    px: raw.px,
    level: raw.level,
    status,
    agent: event.agent || null,
    distance_m: Number.isFinite(event.distance_m) ? event.distance_m : null,
    eta_s: Number.isFinite(event.eta_s) ? event.eta_s : null,
    created_ts: event.ts,
    updated_ts: event.ts,
    resolved_ts: status === "resolved" ? event.ts : null,
    read: false,
    source: event.source,
    analysis: raw.analysis || null,   // 模型输出：置信度、研判理由、处置建议
    visitor: raw.visitor === true,     // 观众上报：手机参与闭环产生的异常
    timeline: [],
  };
}

/* ── 主体 ────────────────────────────────────────────────────────────── */

export function create_alert_store({ allow_demo = true, demo_speed = 1 } = {}) {
  const saved = load_saved();
  const state = {
    mode: "connecting",           // connecting / live / reconnecting / demo
    mode_note: "",                // 页面上那句「为什么在演示模式」
    source: saved?.source || "none",   // live / demo / none：列表里的数据来自哪
    scene: saved?.scene || null,       // { id, label }
    incidents: [],
    events: [],
    counts: { active: 0, pending: 0, handling: 0, resolved_today: 0, total_today: 0, unread: 0 },
    last_event_ts: 0,
    started: false,
  };

  const listeners = new Set();
  let es = null;
  let demo = null;
  let fallback_timer = 0;
  let reconnect_timer = 0;
  let reconnect_idx = 0;
  let save_timer = 0;

  /* ── 加载上次的列表（先过滤掉过期与损坏的数据） ─────────────────── */
  if (saved) {
    const now = Date.now();
    for (const inc of saved.incidents) {
      if (!inc || typeof inc.id !== "string" || !Array.isArray(inc.timeline)) continue;
      if (!is_active_incident(inc) && now - (inc.updated_ts || 0) > 24 * 3600 * 1000) continue;
      /* 上次关页面时还挂在「进行中」的，超过一刻钟就别再占着待处置位了 */
      if (is_active_incident(inc) && now - (inc.updated_ts || 0) > STALE_ACTIVE_MS) {
        inc.status = "resolved";
        inc.resolved_ts = inc.updated_ts || now;
        inc.timeline.push({
          type: "resolved",
          label: "处置完成",
          ts: inc.resolved_ts,
          text: "上次会话已结束，状态按已处置收起",
        });
      }
      state.incidents.push(inc);
    }
    /* 上次是演示模式：那些「进行中」的卡片没有真实定时器在推进了，
       刷新后如果不收尾会永远挂着。真实模式则留给总线快照接管。 */
    if (saved.source === "demo") {
      for (const inc of state.incidents) {
        if (!is_active_incident(inc)) continue;
        inc.status = "resolved";
        inc.resolved_ts = inc.updated_ts || now;
        inc.timeline.push({
          type: "resolved",
          label: "处置完成",
          ts: inc.resolved_ts,
          text: "上一次演示会话已结束，状态按已处置收起",
        });
      }
    }
    trim_incidents();
  }

  /* ── 派生状态 ────────────────────────────────────────────────────── */

  function trim_incidents() {
    const active = state.incidents.filter(is_active_incident);
    const resolved = state.incidents
      .filter((i) => !is_active_incident(i))
      .sort((a, b) => b.updated_ts - a.updated_ts);
    state.incidents = [...active, ...resolved.slice(0, MAX_INCIDENTS - active.length)];
  }

  function refresh_counts() {
    const today0 = start_of_today();
    const active = state.incidents.filter(is_active_incident);
    state.counts = {
      active: active.length,
      pending: active.filter((i) => i.status === "pending").length,
      handling: active.filter((i) => i.status !== "pending").length,
      resolved_today: state.incidents.filter(
        (i) => !is_active_incident(i) && (i.resolved_ts || i.updated_ts) >= today0
      ).length,
      total_today: state.incidents.filter((i) => i.created_ts >= today0).length,
      unread: active.filter((i) => !i.read).length,
    };
  }

  /** 列表顺序：进行中的按最新发现在前，已处置的按最新完成在前 */
  function sorted_incidents() {
    const active = state.incidents
      .filter(is_active_incident)
      .sort((a, b) => b.created_ts - a.created_ts);
    const resolved = state.incidents
      .filter((i) => !is_active_incident(i))
      .sort((a, b) => b.updated_ts - a.updated_ts);
    return [...active, ...resolved];
  }

  function get_state() {
    refresh_counts();
    return {
      ...state,
      incidents: sorted_incidents(),
      counts: { ...state.counts },
    };
  }

  function emit(reason = "tick", event = null) {
    refresh_counts();
    const snapshot = get_state();
    for (const fn of listeners) {
      try {
        fn(snapshot, { reason, event });
      } catch (err) {
        console.error("[alert-store] listener failed", err);
      }
    }
  }

  function schedule_save() {
    if (save_timer) return;
    save_timer = setTimeout(() => {
      save_timer = 0;
      save_now(state);
    }, 250);
  }

  /* ── 应用一条事件 ──────────────────────────────────────────────────
     quiet=true 用于回放快照：只更新数据，不触发订阅，避免手机一连上就
     把历史报警全当新消息弹一遍。 */

  function apply_event(event, { quiet = false } = {}) {
    if (!event) return;
    state.last_event_ts = Math.max(state.last_event_ts, event.ts);

    if (event.type === "scene") {
      if (event.scene) state.scene = { id: event.scene, label: event.scene_label };
      close_other_scenes(event);
      state.events.push(event);
      if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
      schedule_save();
      if (!quiet) emit("event", event);
      return;
    }

    const raw = event.incident;
    let inc = state.incidents.find((i) => i.id === raw.id);
    if (!inc) {
      inc = new_incident_from_event(event);
      state.incidents.unshift(inc);
    }

    /* 判断这是不是「迟到的旧事件」：已处置是终态，phase 比当前小的也不能回退。
       网络抖动时「前往中」可能先于「待派单」到达；总线上的重连回放也可能
       把旧事件塞到新事件后面。这类事件只进事件日志，卡片字段与时间线保持
       最新状态，否则详情里会出现「发现 → 处置完成 → 派出执行体」的乱序。 */
    const next = event.status ? status_meta(event.status) : null;
    const cur = status_meta(inc.status);
    const stale = !is_active_incident(inc) || (!!next && next.phase < cur.phase);

    if (!stale) {
      /* 事件里的描述以最新一条为准，区域名、设备名可能被接入方修正 */
      inc.kind = raw.kind;
      inc.name = raw.name;
      inc.scene = raw.scene;
      inc.scene_label = raw.scene_label;
      inc.area = raw.area;
      inc.camera = raw.camera;
      inc.round = raw.round;
      inc.px = raw.px;
      inc.level = raw.level;
      if (raw.analysis) inc.analysis = raw.analysis;
      if (raw.visitor === true) inc.visitor = true;
      if (event.agent) inc.agent = event.agent;
      if (Number.isFinite(event.distance_m)) inc.distance_m = event.distance_m;
      if (Number.isFinite(event.eta_s)) inc.eta_s = event.eta_s;

      if (event.status) inc.status = event.status;
      inc.updated_ts = Math.max(inc.updated_ts, event.ts);
      if (event.status === "resolved") inc.resolved_ts = event.ts;

      const agent_name = event.agent?.name || inc.agent?.name;
      inc.timeline.push({
        type: event.type,
        label: EVENT_LABELS[event.type] || "状态更新",
        ts: event.ts,
        text: timeline_text(event, inc, agent_name),
      });
      if (inc.timeline.length > 16) inc.timeline.splice(0, inc.timeline.length - 16);

      trim_incidents();
    }

    state.events.push(event);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    schedule_save();
    if (!quiet) emit("event", event);
  }

  /** 切场景时，旧场景里没闭环的预警不会再有人处置，收尾掉，避免一直挂着 */
  function close_other_scenes(event) {
    const scene = event.scene;
    if (!scene) return;
    let touched = false;
    for (const inc of state.incidents) {
      if (!is_active_incident(inc) || inc.scene === scene) continue;
      inc.status = "resolved";
      inc.resolved_ts = event.ts;
      inc.updated_ts = event.ts;
      inc.timeline.push({
        type: "resolved",
        label: "切换场景",
        ts: event.ts,
        text: `指挥大屏已切换到${event.scene_label || "其它场景"}，此预警收尾`,
      });
      touched = true;
    }
    if (touched) trim_incidents();
  }

  /* ── 快照回放 ──────────────────────────────────────────────────────
     总线的快照就是「最近一段事件日志」。手机后打开也没关系，
     按顺序重放就能得到当前完整状态，不需要服务端另存一份。 */

  function apply_snapshot(raw) {
    const snap = normalize_snapshot(raw);
    /* 重连后快照会重放整段事件日志。已经看过的预警在重连后不该又变回未读，
       记下同一批 id 的已读状态，回放完再补回去 */
    const was_read = new Set(state.incidents.filter((i) => i.read).map((i) => i.id));
    state.incidents = [];
    state.events = [];
    state.scene = null;
    state.source = "live";
    for (const event of snap.events) apply_event(event, { quiet: true });
    for (const inc of state.incidents) if (was_read.has(inc.id)) inc.read = true;
    reconnect_idx = 0;
    schedule_save();
    emit("snapshot");
  }

  /* ── 实时连接 ────────────────────────────────────────────────────── */

  function close_es() {
    if (es) {
      try {
        es.close();
      } catch {
        /* 已经关了 */
      }
      es = null;
    }
  }

  function clear_timers() {
    clearTimeout(fallback_timer);
    clearTimeout(reconnect_timer);
    fallback_timer = 0;
    reconnect_timer = 0;
  }

  function set_mode(mode, note = "") {
    state.mode = mode;
    state.mode_note = note;
    emit("mode");
  }

  function start_demo(note) {
    close_es();
    clear_timers();
    if (!allow_demo) {
      set_mode("reconnecting", note || "实时连接不可用");
      return;
    }
    /* 从实时切到演示：别把上一场真实数据混进模拟数据里 */
    if (state.source === "live") {
      state.incidents = [];
      state.events = [];
      state.scene = null;
    }
    state.source = "demo";
    if (!demo) demo = create_demo_feed({ on_event: (event) => apply_event(normalize_event(event), {}), speed: demo_speed });
    demo.start();
    set_mode("demo", note || "未连接指挥大屏，当前为模拟预警数据");
    schedule_save();
  }

  function stop_demo() {
    demo?.stop();
    demo = null;
    /* 演示数据靠定时器闭环。停掉数据源后，没走完的卡片不会再动，
       不收起的话用户重连失败回来会看到永远停在「前往中」的假预警 */
    let touched = false;
    const now = Date.now();
    for (const inc of state.incidents) {
      if (!is_active_incident(inc) || inc.source !== "demo") continue;
      inc.status = "resolved";
      inc.resolved_ts = now;
      inc.updated_ts = now;
      inc.timeline.push({
        type: "resolved",
        label: "处置完成",
        ts: now,
        text: "演示数据源已停止，未闭环的预警按已处置收起",
      });
      touched = true;
    }
    if (touched) {
      trim_incidents();
      schedule_save();
    }
  }

  function schedule_reconnect() {
    const delay = RECONNECT_STEPS[Math.min(reconnect_idx, RECONNECT_STEPS.length - 1)];
    reconnect_idx++;
    clearTimeout(reconnect_timer);
    reconnect_timer = setTimeout(() => {
      if (!state.started || state.mode !== "reconnecting") return;
      try_connect();
    }, delay);
  }

  function try_connect({ manual = false } = {}) {
    if (!state.started) return;
    close_es();
    clear_timers();
    if (manual) stop_demo();
    set_mode(manual ? "connecting" : state.mode === "reconnecting" ? "reconnecting" : "connecting");

    if (typeof EventSource !== "function") {
      start_demo("当前浏览器不支持实时推送");
      return;
    }

    let opened = false;
    try {
      es = new EventSource(bus_url("/api/alerts/stream"));
    } catch {
      start_demo("实时通道不可用");
      return;
    }

    es.addEventListener("snapshot", (e) => {
      const data = safe_parse(e.data);
      if (!data) return;
      opened = true;
      apply_snapshot(data);
      set_mode("live", "");
    });

    es.addEventListener("update", (e) => {
      const event = normalize_event(safe_parse(e.data));
      if (event) apply_event(event);
    });

    es.onerror = () => {
      close_es();
      clearTimeout(fallback_timer);
      if (opened || state.mode === "live") {
        /* 之前连上过：保留现有列表，进入自动重连 */
        set_mode("reconnecting", "实时连接中断，正在重连…");
        schedule_reconnect();
      } else {
        start_demo(manual ? "仍无法连接指挥大屏，继续演示模式" : "未连接指挥大屏");
      }
    };

    /* 首次连接的超时兜底：网络挂起时 onerror 可能迟迟不来 */
    fallback_timer = setTimeout(() => {
      if (state.mode === "live" || opened) return;
      close_es();
      start_demo(manual ? "仍无法连接指挥大屏，继续演示模式" : "未连接指挥大屏");
    }, LIVE_FALLBACK_MS);
  }

  /* ── 对外 API ────────────────────────────────────────────────────── */

  const store = {
    /** 开始接收：先连总线，连不上自动落演示模式 */
    start() {
      if (state.started) return;
      state.started = true;
      emit("init");
      try_connect();
    },

    stop() {
      state.started = false;
      close_es();
      stop_demo();
      clear_timers();
    },

    /** 用户点「重新连接」：断开演示数据，重试总线 */
    retry_live() {
      reconnect_idx = 0;
      try_connect({ manual: true });
    },

    /** 用户点「使用演示数据」：不再等总线，立即起模拟数据 */
    use_demo() {
      if (!state.started) this.start();
      start_demo("手动切换到演示模式");
    },

    /** 页面重新可见 / 网络恢复时可以手动触发一次 */
    refresh() {
      if (state.mode === "reconnecting") {
        reconnect_idx = 0;
        try_connect();
      }
    },

    get_state,

    /** 订阅状态；会立即用当前状态回调一次。返回退订函数 */
    subscribe(fn) {
      listeners.add(fn);
      try {
        fn(get_state(), { reason: "init", event: null });
      } catch (err) {
        console.error("[alert-store] listener failed", err);
      }
      return () => listeners.delete(fn);
    },

    /** 看过详情/点开卡片：清掉未读角标 */
    mark_read(id) {
      const inc = state.incidents.find((i) => i.id === id);
      if (!inc || inc.read) return;
      inc.read = true;
      schedule_save();
      emit("read");
    },

    mark_all_read() {
      let touched = false;
      for (const inc of state.incidents) {
        if (!inc.read && is_active_incident(inc)) {
          inc.read = true;
          touched = true;
        }
      }
      if (touched) {
        schedule_save();
        emit("read");
      }
    },

    /** 当前列表里是否还有进行中的预警（UI 用来决定要不要常亮角标） */
    has_active() {
      return state.incidents.some(is_active_incident);
    },

    /** 暴露给验收脚本：不启动 UI 也能核对状态 */
    _state: state,
  };

  refresh_counts();
  return store;
}

/** 状态的中文短标签，UI 顶部的连接灯直接读 */
export function mode_label(mode) {
  return (
    {
      connecting: "连接中",
      live: "实时接收",
      reconnecting: "重连中",
      demo: "演示模式",
    }[mode] || "未知"
  );
}

/** 状态对应的色调，与 STATUS_META 的 tone 对齐，UI 用来选颜色 */
export function tone_of(status) {
  return status_meta(status).tone;
}
