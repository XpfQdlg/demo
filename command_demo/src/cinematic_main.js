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
import { alert_stats, publish_incident, publish_scene } from "./core/alert_publish.js";
import { install_phone_link } from "./views/phone_link.js";
import { KIND_META, MODEL_ORDER, SCENE_MODELS } from "./mobile/contract.js";
import PACKAGE from "./map/data/map_package.json";

/* 观感版预览页：两个场景可切换，无 UI 遮挡，只用来验证画质。
   素材：AmbientCG 材质 + Poly Haven 天空，均 CC0。 */

const stage = document.getElementById("stage");
const cine = new Cinematic(stage);
window.__cine = cine;            // 调试用：验收脚本要读渲染状态
window.__cine_three = THREE;
window.__pbr = PBR;
window.__alert_pub = alert_stats;   // 调试用：验收脚本核对发了几条、总线地址对不对

/* 右上角「手机」：二维码 + 局域网地址，扫码打开预警接收页 */
install_phone_link();

const hud = document.getElementById("hud");
const tip = document.getElementById("tip");
const tabs = document.querySelectorAll("[data-scene]");

/* ── 四模型场景条 ────────────────────────────────────────────────────
   四个场景各配一个专属模型（定义在 src/mobile/contract.js，与手机端共用）。
   切页签时更新顶部模型条与事件流提示，讲解时不需要另记一套说辞。 */
const modelBarEl = document.getElementById("modelBar");
const modelNameEl = document.getElementById("modelName");
const modelMetaEl = document.getElementById("modelMeta");
const feedHintEl = document.getElementById("feedHint");

/* ── 观众参与：手机上报后大屏先演「四模型会诊」，再切场景真出警 ──────
   interaction.follow_until：观众上报出警时自动跟随执行体一段时间，
   让围观的人看到「大屏真的动了」，之后自动回到全局视角。 */
const interaction = { reports: 0, follow_until: 0, overlay_timer: 0, queue: Promise.resolve() };
const visitorToastEl = document.getElementById("visitorToast");
const visitorTitleEl = document.getElementById("visitorTitle");
const visitorSceneEl = document.getElementById("visitorScene");
const visitorRowsEl = document.getElementById("visitorRows");
const visitorVerdictEl = document.getElementById("visitorVerdict");
const visitorCountEl = document.getElementById("visitorCount");

/* ── 大屏新版：在线值班员 / 本场战报 / 语音指挥 / 第一视角回传 ──────── */
const crowdCountEl = document.getElementById("crowdCount");
const crowdAvatarsEl = document.getElementById("crowdAvatars");
const battleBtn = document.getElementById("battleBtn");
const battlePanelEl = document.getElementById("battlePanel");
const battleCloseEl = document.getElementById("battleClose");
const battleStatsEl = document.getElementById("battleStats");
const battleModelsEl = document.getElementById("battleModels");
const battleTopEl = document.getElementById("battleTop");
const battleSubEl = document.getElementById("battleSub");
const voiceCmdToastEl = document.getElementById("voiceCmdToast");
const ROLE_COLORS = { guard: "#4ef0ff", fire: "#ff7a5c", inspect: "#43e0a0", visitor: "#ffb347" };
const battleState = { open: false, stats: null, participants: [] };
let voiceToastTimer = 0;
let frame_busy = false;

/* 非主判模型在会诊里的复核台词：展台演示口径，配合「统一接入、交叉复核」讲解 */
const VISITOR_REVIEW = {
  campus: "复核：周边人员密度正常，无疏散需求",
  community: "复核：楼栋通道无占用，通行正常",
  subway: "复核：客流影响低，无需限流",
  forest: "复核：烟雾扩散风险可控",
};

function scene_model_of(tab) {
  return SCENE_MODELS[tab] || SCENE_MODELS.campus;
}

function update_model_bar(tab) {
  const model = scene_model_of(tab);
  modelBarEl?.style.setProperty("--model-accent", model.accent);
  if (modelNameEl) modelNameEl.textContent = model.name;
  if (modelMetaEl) modelMetaEl.textContent = `四模型接入 · ${model.scene_label}场景 · ${model.coverage}`;
  if (feedHintEl) feedHintEl.textContent = `${model.short} · 点击地面派单`;
}

tabs.forEach((t) => {
  const model = scene_model_of(t.dataset.scene);
  t.title = `${model.name}｜${model.tagline}`;
});
update_model_bar("campus");

/* ── 观众上报：指挥流（手机 → 大屏） ───────────────────────────────── */

/** 指挥流/告警快照共用的本机总线地址；file:// 下退回 127.0.0.1:5179 */
function interaction_bus_base() {
  const params = new URLSearchParams(location.search);
  const bus_base = (params.get("bus") || "").trim().replace(/\/+$/, "");
  return bus_base || (location.protocol === "file:" ? "http://127.0.0.1:5179" : "");
}

/** 这条上报是否已经被总线兜底流程处置过（大屏响应超时的情况） */
async function visitor_already_handled(command_id) {
  if (!command_id) return false;
  try {
    const res = await fetch(`${interaction_bus_base()}/api/alerts/snapshot`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.events || []).some(
      (ev) => ev.incident?.visitor === true && ev.incident?.command_id === command_id
    );
  } catch {
    return false;
  }
}

/** 等某个场景建好。切场景要重建森林/地铁，期间页签已高亮但 monitor 还没换 */
async function ensure_scene(name) {
  if (!SCENE_MODELS[name]) return false;
  if (current === name && !busy && monitor) return true;
  if (!busy) {
    try {
      await show(name);
    } catch (err) {
      console.warn("[visitor] scene switch failed", err);
    }
  }
  const started = performance.now();
  while (performance.now() - started < 45000) {
    if (!busy && current === name && monitor) return true;
    /* 上一次切场景可能把我们想切的场景又顶掉了：空闲时重新发起 show */
    if (!busy && current !== name) {
      try {
        await show(name);
      } catch (err) {
        console.warn("[visitor] scene switch retry failed", err);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** 大屏会诊面板：四个模型逐行点亮，最后给结论 */
function show_visitor_overlay(cmd) {
  const main = SCENE_MODELS[cmd.scene] || SCENE_MODELS.campus;
  const pct = Math.round((Number(cmd.confidence) || 0.9) * 100);
  const rows = [
    {
      accent: main.accent,
      main: true,
      tag: "主判",
      text: `${main.name} · 识别到「${cmd.name}」· 置信度 ${pct}%`,
    },
  ];
  for (const key of MODEL_ORDER) {
    if (key === main.scene) continue;
    const meta = SCENE_MODELS[key];
    rows.push({
      accent: meta.accent,
      main: false,
      tag: "复核",
      text: `${meta.short} · ${VISITOR_REVIEW[key]}`,
    });
  }

  visitorTitleEl.textContent = `收到观众上报 · ${cmd.name}`;
  visitorSceneEl.textContent = `${cmd.scene_label} · ${main.name}`;
  visitorRowsEl.replaceChildren(
    ...rows.map((row) => {
      const li = document.createElement("li");
      li.className = `v-row${row.main ? " is-main" : ""}`;
      li.style.setProperty("--row-accent", row.accent);
      const dot = document.createElement("span");
      dot.className = "v-dot";
      const text = document.createElement("span");
      text.textContent = row.text;
      const tag = document.createElement("span");
      tag.className = "v-tag";
      tag.textContent = row.tag;
      li.append(dot, text, tag);
      return li;
    })
  );
  visitorVerdictEl.textContent = "四模型会诊中…";
  visitorVerdictEl.classList.add("pulse");
  visitorToastEl.classList.add("on");

  /* 逐行点亮：主判先出，三个复核模型依次跟上 */
  const nodes = [...visitorRowsEl.children];
  nodes.forEach((node, index) => {
    setTimeout(() => node.classList.add("on"), 120 + index * 260);
  });

  clearTimeout(interaction.overlay_timer);
  interaction.overlay_timer = setTimeout(() => visitorToastEl.classList.remove("on"), 12000);
}

function bump_visitor_count() {
  interaction.reports += 1;
  if (visitorCountEl) visitorCountEl.textContent = `观众参与 ${interaction.reports}`;
}

/** 处理一条观众上报：会诊动效 → 切到上报场景 → 监控层真实报警派单 */
async function handle_visitor_command(cmd) {
  const started = performance.now();
  /* 已由兜底流程处置过的的不重复出警（大屏可能卡在切场景 >15 秒） */
  if (await visitor_already_handled(cmd.id)) {
    visitorVerdictEl.textContent = "该上报已由兜底流程处置，未重复出警";
    visitorVerdictEl.classList.remove("pulse");
    return;
  }

  show_visitor_overlay(cmd);
  let ready = await ensure_scene(cmd.scene);
  if (!ready) {
    visitorVerdictEl.textContent = "场景加载超时，上报已记录";
    visitorVerdictEl.classList.remove("pulse");
    show_toast("观众上报已记录，场景加载超时");
    return;
  }

  /* 让会诊动效先走一段，再让 3D 场景真的冒烟/出警，节奏更像「分析完了」 */
  /* 单条上报留 900ms 让会诊动效走完；连续快速上报直接出警，不排队拖节奏 */
  if (!cmd._rapid) await new Promise((r) => setTimeout(r, 900));

  /* 等待期间讲解员可能手动切了场景：把上报点钉回目标场景再出警 */
  if (current !== cmd.scene || busy || !monitor) {
    ready = await ensure_scene(cmd.scene);
    if (!ready) return;
  }
  /* 兜底可能刚好在这段时间里补发，再确认一次，避免两张卡（处理很快时省略这次请求） */
  if (performance.now() - started > 8000 && (await visitor_already_handled(cmd.id))) {
    visitorVerdictEl.textContent = "该上报已由兜底流程处置，未重复出警";
    visitorVerdictEl.classList.remove("pulse");
    return;
  }

  const inc = monitor?.trigger_visitor_report({ kind: cmd.kind, command_id: cmd.id });
  if (!inc) {
    visitorVerdictEl.textContent = "执行体全部在忙，上报已排队";
    visitorVerdictEl.classList.remove("pulse");
    show_toast("执行体全部在忙，观众上报已排队");
    return;
  }

  const model = scene_model_of(monitor_tab());
  log_event(`【观众上报】${cmd.scene_label}${inc.name}`, "warn");
  /* trigger 里已经同步完成派单，这里把设备与距离一并写进会诊结论 */
  const dev = inc.by ? label_of(inc.by, agents.indexOf(inc.by)) : "就近执行体";
  const dispatch_text = inc.by
    ? `已派 ${dev} 前往（约 ${Math.round(inc.distance_m)} 米，预计 ${Math.round(inc.eta_s)} 秒到位）`
    : "已下发就近处置指令";
  visitorVerdictEl.textContent = `研判结论：${KIND_META[inc.kind]?.level_label || "高危"} · ${dispatch_text}`;
  visitorVerdictEl.classList.remove("pulse");
  show_toast(`收到观众上报：${cmd.scene_label}发现${inc.name} · ${dev} 前往处置`);
}

/** 串行处理观众上报：两条命令同时要求切场景时，不能各建各的场景，
    否则后建好的场景会把前一条上报点带偏。计数与提示在入队时就给。 */
function enqueue_visitor_command(cmd) {
  if (!cmd || cmd.type !== "visitor_report") return;
  const now = Date.now();
  cmd._rapid = now - interaction.last_enqueue < 1800;
  interaction.last_enqueue = now;
  bump_visitor_count();
  interaction.queue = interaction.queue
    .catch(() => {})
    .then(() => handle_visitor_command(cmd))
    .catch((err) => console.warn("[visitor]", err));
}

/* ── 本场战报 / 在线值班员 / 语音指挥 / 第一视角回传 ───────────────── */

function show_voice_toast(text) {
  if (!voiceCmdToastEl) return;
  voiceCmdToastEl.textContent = text;
  voiceCmdToastEl.classList.add("on");
  clearTimeout(voiceToastTimer);
  voiceToastTimer = setTimeout(() => voiceCmdToastEl.classList.remove("on"), 4000);
}

function render_crowd() {
  if (!crowdCountEl) return;
  const people = battleState.participants || [];
  const count = people.length || battleState.stats?.participants || 0;
  crowdCountEl.textContent = String(count);
  if (crowdAvatarsEl) {
    crowdAvatarsEl.replaceChildren(
      ...people.slice(0, 10).map((p) => {
        const dot = document.createElement("i");
        dot.style.setProperty("--role-color", ROLE_COLORS[p.role] || ROLE_COLORS.visitor);
        dot.title = `${p.role_name || "观众"} · ${p.name || ""}`;
        return dot;
      })
    );
  }
}

function render_battle() {
  if (!battleStatsEl) return;
  const stats = battleState.stats || {};
  const people = battleState.participants || [];
  const model_scene_counts = stats.by_scene || {};
  const total_models = Object.values(model_scene_counts).reduce((a, b) => a + b, 0);

  const stats_data = [
    { k: "在线值班员", v: people.length || stats.participants || 0, unit: "人" },
    { k: "观众上报", v: stats.visitor_reports || 0, unit: "次" },
    { k: "语音指令", v: stats.voice_commands || 0, unit: "条" },
    { k: "最快处置", v: stats.fastest_resolve_s == null ? "—" : stats.fastest_resolve_s, unit: stats.fastest_resolve_s == null ? "" : "秒" },
  ];
  battleStatsEl.replaceChildren(
    ...stats_data.map((item) => {
      const card = document.createElement("div");
      card.className = "battle-stat";
      const k = document.createElement("div");
      k.className = "k";
      k.textContent = item.k;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = String(item.v);
      if (item.unit) {
        const u = document.createElement("small");
        u.textContent = item.unit;
        v.append(u);
      }
      card.append(k, v);
      return card;
    })
  );

  const max_count = Math.max(1, ...MODEL_ORDER.map((key) => model_scene_counts[key] || 0));
  battleModelsEl.replaceChildren(
    ...MODEL_ORDER.map((key) => {
      const model = SCENE_MODELS[key];
      const count = model_scene_counts[key] || 0;
      const row = document.createElement("div");
      row.className = "battle-model";
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = model.name;
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = `${Math.round((count / max_count) * 100)}%`;
      fill.style.background = `linear-gradient(90deg, ${model.accent}, #8b7bff)`;
      bar.append(fill);
      const c = document.createElement("span");
      c.className = "c";
      c.textContent = String(count);
      row.append(n, bar, c);
      return row;
    })
  );

  const top = [...people].sort((a, b) => b.score - a.score || b.reports - a.reports).slice(0, 5);
  battleTopEl.replaceChildren(
    ...top.map((p, index) => {
      const row = document.createElement("div");
      row.className = "battle-top-row";
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = String(index + 1);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = `${p.name || "值班员"} · ${p.role_name || "观众"}`;
      const sc = document.createElement("span");
      sc.className = "sc";
      sc.textContent = `${p.score || 0} 分 · 上报 ${p.reports || 0}`;
      row.append(idx, nm, sc);
      return row;
    })
  );
  if (!top.length) {
    const empty = document.createElement("div");
    empty.className = "battle-top-row";
    empty.textContent = "还没有值班员上榜，扫码参与即可上榜";
    battleTopEl.append(empty);
  }

  if (battleSubEl) {
    battleSubEl.textContent = total_models
      ? `四模型协同 · 观众参与闭环 · 本场共 ${total_models} 次观众上报`
      : "四模型协同 · 观众参与闭环 · 等待第一位观众上报";
  }
}

async function refresh_session() {
  try {
    const base = interaction_bus_base();
    const [stats, people] = await Promise.all([
      fetch(`${base}/api/stats`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`${base}/api/participants`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (stats?.ok) battleState.stats = stats;
    if (people?.ok) battleState.participants = people.participants || [];
    render_crowd();
    if (battleState.open) render_battle();
  } catch {
    /* 大屏没连服务时静默，不影响 3D 演示 */
  }
}

function open_battle() {
  if (!battlePanelEl || battleState.open) return;
  battleState.open = true;
  battlePanelEl.classList.add("on");
  document.body.classList.add("battle-open");
  refresh_session();
  render_battle();
  battleCloseEl?.focus({ preventScroll: true });
}

function close_battle() {
  if (!battleState.open) return;
  battleState.open = false;
  battlePanelEl?.classList.remove("on");
  document.body.classList.remove("battle-open");
}

/** 语音指挥：手机端把识别出的意图发过来，大屏只执行白名单动作 */
async function handle_voice_command(cmd) {
  if (!cmd || cmd.type !== "voice_command") return;
  const command_text = cmd.text || "";
  switch (cmd.action) {
    case "scene": {
      const label = cmd.scene_label || SCENE_MODELS[cmd.scene]?.scene_label || "目标";
      const ready = await ensure_scene(cmd.scene || "campus");
      show_voice_toast(ready ? `语音指挥 · 已切到${label}场景` : `语音指挥 · ${label}场景加载超时`);
      break;
    }
    case "overview":
      back_to_overview();
      show_voice_toast("语音指挥 · 回到全局视角");
      break;
    case "follow": {
      const n = Number(cmd.device) || 1;
      const index = Math.max(0, Math.min(agents.length - 1, n - 1));
      follow_agent(index);
      const actual = agents[index];
      const name = actual ? label_of(actual, index) : `${index + 1} 号设备`;
      show_voice_toast(`语音指挥 · 跟随 ${name}`);
      break;
    }
    case "report": {
      const target_scene = cmd.scene || current || "campus";
      const ready = await ensure_scene(target_scene);
      if (ready) {
        const inc = monitor?.trigger_visitor_report({ kind: cmd.kind || "fire" });
        show_voice_toast(inc ? `语音指挥 · 已派单处置${inc.name}` : "语音指挥 · 执行体全忙");
      } else {
        show_voice_toast("语音指挥 · 场景加载超时");
      }
      break;
    }
    case "battle":
      open_battle();
      show_voice_toast(`语音指挥 · 打开本场战报${command_text ? `「${command_text}」` : ""}`);
      break;
    default:
      break;
  }
}

/** 跟随出警时把第一视角小窗的帧推给手机（手机详情里的「现场回传」） */
async function relay_live_frame() {
  if (frame_busy) return;
  if (!(interaction.follow_until > 0) || follow_idx < 0 || !pip_on) return;
  const canvas = document.getElementById("pip");
  if (!canvas || !canvas.toDataURL) return;
  let dataUrl = "";
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  } catch {
    return;
  }
  if (!dataUrl || dataUrl.length > 380000) return;
  frame_busy = true;
  try {
    const agent = agents[follow_idx];
    const device = agent ? label_of(agent, follow_idx) : "";
    await fetch(`${interaction_bus_base()}/api/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, scene: current || "", device }),
    });
  } catch {
    /* 回传失败不影响 3D */
  } finally {
    frame_busy = false;
  }
}

/** 启动大屏会话轮询：在线值班员、战报、回传帧 */
function start_live_session() {
  refresh_session();
  setInterval(refresh_session, 3000);
  setInterval(relay_live_frame, 800);
}

/** 语音指令也串行执行：连续两条「切到 X 场景」不能互相顶掉 */
function enqueue_voice_command(cmd) {
  if (!cmd || cmd.type !== "voice_command") return;
  interaction.queue = interaction.queue
    .catch(() => {})
    .then(() => handle_voice_command(cmd))
    .catch((err) => console.warn("[voice]", err));
}

/** 订阅指挥流；单文件 file:// 下退回本机 5179，与服务端发布器同一口径 */
function start_interaction_channel() {
  if (typeof EventSource !== "function") return;
  let es = null;
  try {
    es = new EventSource(`${interaction_bus_base()}/api/commands/stream`);
  } catch {
    return;
  }
  es.addEventListener("command", (e) => {
    let cmd = null;
    try {
      cmd = JSON.parse(e.data);
    } catch {
      return;
    }
    if (cmd?.type === "voice_command") {
      enqueue_voice_command(cmd);
      return;
    }
    enqueue_visitor_command(cmd);
  });
  window.__visitor_es = es;
}

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
    /* 异常名按场景本地化，与手机端模型口径共用 SCENE_MODELS */
    kind_names: scene_model_of(tab).alert_names,
    hooks: {
      on_alarm: on_camera_alarm,
      on_dispatched,
      on_arrive,
      on_handling,
      on_resolve: on_resolved,
      on_manual_arrive,
    },
  });
  m.build({ count: 3, ...(MONITOR_AREA[tab] || {}) });
  window.__monitor = m;   // 调试用：验收脚本要读摄像头点位与报警状态
  /* 通知手机页换场景：旧场景里没闭环的预警，手机端会收尾掉 */
  publish_scene(tab);
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
  /* 模型名与场景重建无关，先切：森林/地铁重建要两三秒，
     等建完再更新会让模型条明显慢于页签高亮 */
  update_model_bar(name);

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
    update_model_bar(name);
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

  update_model_bar(name);
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
battleBtn?.addEventListener("click", open_battle);
battleCloseEl?.addEventListener("click", close_battle);
battlePanelEl?.addEventListener("click", (e) => {
  if (e.target === battlePanelEl) close_battle();
});
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
  /* 观众上报出警时，大屏要在 setInterval 里把这个画布抓成 JPEG 推给手机。
     不开 preserveDrawingBuffer 的话，合成完缓冲就被清空，抓到的是纯黑帧。 */
  preserveDrawingBuffer: true,
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
   想细看自己按数字键跟上去，符合 docs/03 定的「不抢占视角」。
   每条回调同时推一份到本机总线，手机预警页按事件顺序回放。 */

/** 当前页签 id：小区与校园共用场景，但手机端要看到「小区」 */
function monitor_tab() {
  return current || monitor?.scene || "campus";
}

function on_camera_alarm({ inc }) {
  const fy = monitor?.floor_y ?? 0;
  const model = scene_model_of(monitor_tab());
  /* 抬到 5.5 米：气泡画在事发点正上方，放得太低会把地面的光圈整个盖住 */
  pop_bubble_at({ px: inc.px }, fy + 5.5, `${inc.area}发现${inc.name}`);
  log_event(`【${model.short}】${inc.area}发现${inc.name}`, "warn");
  publish_incident("alarm", {
    inc,
    tab: monitor_tab(),
    note: `${model.name} · ${inc.camera?.id || "监控摄像头"} 自动识别，已进入就近调度`,
  });
}

function on_dispatched({ inc, agent, distance_m, eta_s }) {
  const n = agents.indexOf(agent) + 1;
  const dev = label_of(agent, n - 1);
  const model = scene_model_of(monitor_tab());
  show_toast(
    `${model.short}发现${inc.area}${inc.name}，已呼叫最近的 ${dev} 前往` +
      `（约 ${Math.round(distance_m)} 米，预计 ${Math.round(eta_s)} 秒到位）· 按 ${n} 跟随`
  );
  pop_bubble(agent, `${dev} · 前往处置`);
  log_event(`派 ${dev} 前往${inc.area}（约 ${Math.round(distance_m)} 米）`);

  /* 观众上报：大屏自动跟上去，让围观的人看到「他的一键上报真的把机器狗派出去了」 */
  if (inc.visitor) {
    const idx = agents.indexOf(agent);
    if (idx >= 0) follow_agent(idx);
    interaction.follow_until = performance.now() + 12000;
    if (visitorToastEl.classList.contains("on")) {
      visitorVerdictEl.classList.remove("pulse");
      visitorVerdictEl.textContent =
        `研判结论：${KIND_META[inc.kind]?.level_label || "高危"} · 已派 ${dev} 前往` +
        `（约 ${Math.round(distance_m)} 米，预计 ${Math.round(eta_s)} 秒到位）`;
    }
  }

  publish_incident("dispatched", {
    inc,
    tab: monitor_tab(),
    agent: { name: dev, type: agent.type },
    distance_m,
    eta_s,
  });
}

function on_arrive({ inc, agent }) {
  const dev = label_of(agent, agents.indexOf(agent));
  show_toast(`${dev} 已到${inc.area}，开始识别`);
  log_event(`${dev} 到达${inc.area}`);
  publish_incident("arrive", {
    inc,
    tab: monitor_tab(),
    agent: { name: dev, type: agent.type },
  });
}

/** 到场扫描结束、开始处置。大屏不额外播报，只给手机页一个状态 */
function on_handling({ inc, agent }) {
  publish_incident("handling", {
    inc,
    tab: monitor_tab(),
    agent: { name: label_of(agent, agents.indexOf(agent)), type: agent.type },
  });
}

function on_resolved({ inc, agent }) {
  const dev = label_of(agent, agents.indexOf(agent));
  const model = scene_model_of(monitor_tab());
  show_toast(`${inc.area}${inc.name}已处置，${dev} 恢复巡检 · ${model.short}`);
  pop_bubble_at({ px: inc.px }, (monitor?.floor_y ?? 0) + 3.4, `已处置 · ${inc.name}`, BUBBLE_GREEN);
  log_event(`${inc.area}${inc.name}已处置`, "ok");
  if (inc.visitor) {
    show_toast(`观众上报闭环：${inc.area}${inc.name}已处置，${dev} 恢复巡检`);
    if (visitorToastEl.classList.contains("on")) {
      visitorVerdictEl.textContent = "处置完成 · 观众上报闭环";
      visitorVerdictEl.classList.remove("pulse");
    }
  }
  publish_incident("resolved", {
    inc,
    tab: monitor_tab(),
    agent: { name: dev, type: agent.type },
  });
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

  /* 观众上报的自动跟随：12 秒后回全局，避免讲解员被锁在某个设备视角 */
  if (interaction.follow_until && performance.now() > interaction.follow_until) {
    interaction.follow_until = 0;
    if (follow_idx >= 0) back_to_overview();
  }

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
  if (e.code === "KeyB") {
    if (battleState.open) close_battle();
    else open_battle();
    return;
  }
  if (battleState.open && e.code === "Escape") {
    close_battle();
    return;
  }
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
  await cine.load_sky(PBR.asset_url("cinematic/sky.jpg"), {
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

  /* 场景建好后再订阅指挥流：手机上报可能要求切场景，避免和首次加载抢 */
  start_interaction_channel();
  start_live_session();
}

boot().catch((e) => {
  console.error(e);
  if (hud) hud.textContent = "加载失败：" + e.message;
});
