import { SEV_META } from "../data/events.js";

/* ══════════════════════════════════════════════════════════════════════════
   HUD — 顶栏、执行体面板、识别卡片、事件流、状态栏、剧本按钮
   ══════════════════════════════════════════════════════════════════════════ */

const $ = (s) => document.querySelector(s);

let on_select_cb = null;
let rows = new Map();

/* ── 场景标签 ─────────────────────────────────────────────────────── */

export function bind_scene_tabs(on_scene) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => on_scene(b.dataset.scene));
  });
}

export function set_scene_tab(scene_id) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.scene === scene_id);
  });
}

/* ── 执行体列表 ───────────────────────────────────────────────────── */

export function render_agents(agents, on_select) {
  on_select_cb = on_select;
  const list = $("#agentList");
  list.innerHTML = "";
  rows = new Map();

  agents.forEach((a, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "agent-row";
    row.dataset.id = a.agent_id;
    row.innerHTML = `
      <span class="agent-key">${i + 1}</span>
      <span class="agent-main">
        <b>${a.name}</b>
        <small>${a.agent_id}</small>
      </span>
      <span class="agent-type ${a.type}">${a.type === "dog" ? "四足" : "人形"}</span>
    `;
    row.addEventListener("click", () => on_select_cb?.(a));
    list.appendChild(row);
    rows.set(a.agent_id, row);
  });

  $("#agentCount").textContent = `${agents.length} 台`;
}

export function set_active_agent(agent_id) {
  for (const [id, el] of rows) el.classList.toggle("active", id === agent_id);
}

/** 每帧刷新执行体状态灯，只在变化时改 DOM */
export function sync_agent_status(agents) {
  for (const a of agents) {
    const el = rows.get(a.agent_id);
    if (!el) continue;
    if (el.dataset.status === a.status) continue;
    el.dataset.status = a.status;
    el.classList.toggle("st-moving", a.status === "moving");
    el.classList.toggle("st-scan", a.status === "scanning");
    el.classList.toggle("st-alert", a.status === "alert");
  }
}

/* ── 识别卡片 ─────────────────────────────────────────────────────── */

export function show_detection(evt) {
  const el = $("#detCard");
  const meta = SEV_META[evt.severity.key] || SEV_META.info;
  el.innerHTML = `
    <div class="det-head" style="--c:${meta.color}">
      <span class="det-badge">${meta.label}</span>
      <span class="det-conf">${(evt.confidence * 100).toFixed(1)}%</span>
    </div>
    <div class="det-title">${evt.title}</div>
    <div class="det-detail">${evt.detail || ""}</div>
    <dl class="det-grid">
      <div><dt>场景</dt><dd>${evt.scene_name}</dd></div>
      <div><dt>位置</dt><dd>${evt.location}</dd></div>
      <div><dt>处置设备</dt><dd>${evt.dispatch?.device_name || "待调度"}</dd></div>
      <div><dt>到达用时</dt><dd>约 ${evt.dispatch?.eta_s ?? "—"} 秒</dd></div>
    </dl>
    <div class="det-action"><span>处置动作</span>${evt.action || "—"}</div>
    <button class="btn ghost det-video" type="button" data-video="1">查看现场画面</button>
  `;
  el.classList.add("has");
}

export function clear_detection() {
  const el = $("#detCard");
  el.innerHTML = `<div class="det-empty">选择设备或触发告警后显示识别结果</div>`;
  el.classList.remove("has");
}

/* ── 事件流 ───────────────────────────────────────────────────────── */

export function add_feed(evt, note) {
  const body = $("#efBody");
  const meta = SEV_META[evt?.severity?.key] || SEV_META.info;
  const time = evt?.timeline?.at(-1)?.t || "--:--:--";

  const row = document.createElement("div");
  row.className = "ef-row";
  row.innerHTML = `
    <span class="ef-time">${time}</span>
    <span class="ef-sev" style="--c:${meta.color}">${meta.label}</span>
    <span class="ef-text"><b>${evt.title}</b><small>${evt.scene_name} · ${note}</small></span>
  `;
  body.prepend(row);
  while (body.children.length > 40) body.lastChild.remove();
}

export function clear_feed() {
  $("#efBody").innerHTML = "";
}

export function bind_feed_clear(fn) {
  $("#efClear").addEventListener("click", fn);
}

/* ── 剧本按钮 ─────────────────────────────────────────────────────── */

export function render_scenarios(list, on_run) {
  const bar = $("#scenarioBar");
  bar.innerHTML = "";
  list.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn tiny scenario";
    b.textContent = `剧本 ${i + 1}`;
    b.title = s.name;
    b.addEventListener("click", () => on_run(s));
    bar.appendChild(b);
  });
}

/* ── 状态栏 ───────────────────────────────────────────────────────── */

export function set_status({ agent, mode, fps }) {
  if (mode === "overview") {
    $("#statusAgent").textContent = "全景俯瞰";
    $("#statusMode").textContent = "俯瞰";
  } else if (agent) {
    $("#statusAgent").textContent = `${agent.name} · ${agent.agent_id}`;
    if (mode) $("#statusMode").textContent = "第三人称";
  }
  if (fps != null) $("#statusFps").textContent = `${fps} fps`;
}

export function set_reticle(on) {
  $("#reticle").classList.toggle("on", on);
}

export function hide_boot() {
  const b = $("#boot");
  if (!b) return;
  b.classList.add("hide");
  setTimeout(() => b.remove(), 400);
}

export function set_boot_text(text) {
  const el = document.querySelector("#boot .boot-inner span:last-child");
  if (el) el.textContent = text;
}

/* ── 顶栏告警横幅 ─────────────────────────────────────────────────── */

let banner_evt = null;

export function render_banner(evt) {
  const bar = document.getElementById("alertBanner");
  if (!bar) return;

  if (!evt) {
    bar.classList.remove("on");
    banner_evt = null;
    return;
  }

  banner_evt = evt;
  const meta = SEV_META[evt.severity.key] || SEV_META.info;
  const stage = {
    dispatched: "前往中",
    arrived: "已到场",
    resolving: "处置中",
    pending: "待调度",
  }[evt.status] || "";

  bar.style.setProperty("--c", meta.color);
  bar.innerHTML = `
    <span class="ab-dot"></span>
    <b>${evt.scene_name}</b>
    <span class="ab-title">${evt.title}</span>
    <span class="ab-stage">${stage}</span>
  `;
  bar.classList.add("on");
}

export function bind_banner(fn) {
  const bar = document.getElementById("alertBanner");
  if (bar) bar.addEventListener("click", () => fn(banner_evt));
}
