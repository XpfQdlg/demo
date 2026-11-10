/* ══════════════════════════════════════════════════════════════════════════
   mobile/min — 精简版手机页

   只有两件事：看现场预警、拍一张照片上报。没有模型总览、没有积分排行、
   没有小游戏，也就没有对应的状态机。

   1. 数据仍然来自 store.js（本机总线 / 演示数据自动兜底），这里只负责画。
   2. 列表按 incident.id 复用 DOM：轮询与重连都会重复推同一批 id，
      整表重建会让卡片闪、滚动位置丢，展台上很难看。
   3. 照片有两处：预警详情里的「现场照片」，以及上报时的演示图库。
      两者都读 public/photos/photos.json —— 后面把学校的真实照片丢进
      那个目录、改一下 json 即可，代码不用动。
   ══════════════════════════════════════════════════════════════════════════ */

import {
  PHASES,
  SCENE_MODELS,
  default_analysis,
  format_hms,
  is_active_incident,
  kind_meta,
  scene_label,
  status_meta,
} from "./contract.js";
import { create_alert_store } from "./store.js";

/* ── DOM ─────────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

const dom = {
  conn: $("conn"),
  conn_text: $("conn-text"),
  n_active: $("n-active"),
  n_handling: $("n-handling"),
  n_resolved: $("n-resolved"),
  scene_name: $("scene-name"),
  scene_time: $("scene-time"),
  list_hint: $("list-hint"),
  list: $("list"),
  unread: $("unread"),
  tabbar: $("tabbar"),
  sheet: $("sheet"),
  sheet_title: $("sheet-title"),
  sheet_img: $("sheet-img"),
  sheet_photo_empty: $("sheet-photo-empty"),
  sheet_cap: $("sheet-cap"),
  sheet_rows: $("sheet-rows"),
  sheet_phases: $("sheet-phases"),
  seg: $("seg-scene"),
  shot: $("shot"),
  shot_img: $("shot-img"),
  shot_empty: $("shot-empty"),
  shot_cap: $("shot-cap"),
  photo_hint: $("photo-hint"),
  btn_camera: $("btn-camera"),
  btn_demo: $("btn-demo"),
  btn_send: $("btn-send"),
  verdict: $("verdict"),
  verdict_title: $("verdict-title"),
  verdict_model: $("verdict-model"),
  verdict_rows: $("verdict-rows"),
  file: $("file"),
  toast: $("toast"),
};

/* ── 小工具 ──────────────────────────────────────────────────────────── */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let toast_timer = 0;
function toast(text, ms = 2200) {
  dom.toast.textContent = text;
  dom.toast.classList.add("is-on");
  clearTimeout(toast_timer);
  toast_timer = setTimeout(() => dom.toast.classList.remove("is-on"), ms);
}

/* 稳定散列：同一起异常每次都取到同一张照片，不会每次刷新都换图 */
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function client_id() {
  try {
    let id = localStorage.getItem("aegis.client");
    if (!id) {
      id = "c-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("aegis.client", id);
    }
    return id;
  } catch {
    return "c-anon";
  }
}

/* ── 照片库：public/photos/photos.json ───────────────────────────────────
   形如 { "campus": [ { "file": "campus-1.jpg",
                        "caption": "一号教学楼东侧",
                        "kind": "fire" } ] }
   文件放在 public/photos/ 下。没配也能跑，只是不显示照片。 */

const PHOTOS = { list: {} };

async function load_photos() {
  try {
    const res = await fetch("./photos/photos.json", { cache: "no-store" });
    if (!res.ok) return;
    const raw = await res.json();
    for (const [scene, items] of Object.entries(raw || {})) {
      if (!Array.isArray(items)) continue;
      PHOTOS.list[scene] = items
        .filter((it) => it && it.file)
        .map((it) => ({
          src: `./photos/${it.file}`,
          caption: String(it.caption || "").slice(0, 40),
          kind: ["fire", "crowd", "trash"].includes(it.kind) ? it.kind : null,
        }));
    }
  } catch {
    /* 没有照片库也能用 */
  }
}

function photos_of(scene) {
  return PHOTOS.list[scene] || [];
}

/** 给一条预警挑一张现场照片：同 id 稳定命中同一张 */
function photo_for_incident(inc) {
  const pool = photos_of(inc.scene);
  if (!pool.length) return null;
  return pool[Math.floor(hash01(inc.id) * pool.length) % pool.length];
}

/* ── 屏幕切换 ─────────────────────────────────────────────────────────── */

function show_screen(name) {
  for (const sec of document.querySelectorAll(".screen")) {
    sec.classList.toggle("is-on", sec.id === `screen-${name}`);
  }
  for (const b of dom.tabbar.querySelectorAll("button")) {
    b.classList.toggle("is-on", b.dataset.screen === name);
  }
  window.scrollTo({ top: 0 });
}

document.getElementById("join-cta")?.addEventListener("click", () => show_screen("report"));

dom.tabbar.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-screen]");
  if (!b) return;
  show_screen(b.dataset.screen);
});

/* ── 预警列表 ─────────────────────────────────────────────────────────── */

let state = null;
const nodes = new Map();   // id -> { root, tag, meta, foot }
let last_scene = null;

function set_photo(img, empty, photo) {
  if (photo) {
    img.hidden = false;
    empty.hidden = true;
    img.onerror = () => {
      img.hidden = true;
      empty.hidden = false;
    };
    img.src = photo.src;
    img.alt = photo.caption || "现场照片";
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    empty.hidden = false;
  }
}

function card_for(inc) {
  const root = el("button", "card");
  root.type = "button";
  root.dataset.id = inc.id;

  /* 左边一帧现场照片（没有就画一个相框图标） */
  const thumb = el("div", "thumb");
  const thumb_img = el("img");
  thumb_img.alt = "";
  thumb_img.hidden = true;
  thumb.append(thumb_img);

  const body = el("div", "card-body");

  const head = el("div", "card-h");
  const title = el("b", null, "");
  const tag = el("span", "tag", "");
  head.append(title, tag);

  const meta = el("div", "card-meta");
  const meta_text = el("span", null, "");
  meta.append(meta_text);

  const foot = el("div", "card-foot");
  const dot = el("i", "dot");
  const foot_text = el("span", null, "");
  foot.append(dot, foot_text);

  body.append(head, meta, foot);
  root.append(thumb, body);
  root.addEventListener("click", () => open_sheet(inc.id));

  const node = { root, thumb_img, title, tag, meta_text, foot_text };
  fill_card(node, inc);
  return node;
}

function fill_card(node, inc) {
  const km = kind_meta(inc.kind);
  const sm = status_meta(inc.status);
  const active = is_active_incident(inc);

  node.title.textContent = inc.area || scene_label(inc.scene);
  node.tag.textContent = active ? sm.label : "已处置";
  node.tag.dataset.tone = active ? "active" : "";

  const bits = [inc.name || km.name];
  if (inc.camera) bits.push(inc.camera);
  node.meta_text.textContent = `${bits.join(" · ")} · ${km.level_label}`;

  node.foot_text.textContent = active
    ? `${inc.agent ? inc.agent.name + " 前往中" : "等待派单"} · ${format_hms(inc.updated_ts)}`
    : `处置完成 · ${format_hms(inc.resolved_ts || inc.updated_ts)}`;

  const photo = photo_for_incident(inc);
  if (photo) {
    node.thumb_img.hidden = false;
    node.thumb_img.onerror = () => {
      node.thumb_img.hidden = true;
    };
    node.thumb_img.src = photo.src;
  } else {
    node.thumb_img.hidden = true;
    node.thumb_img.removeAttribute("src");
  }
}

function render_list(all) {
  /* 进行中的永远排在最上面；已处置只留最近 6 条。
     演示模式会不停地推新预警，全量铺开以后列表会拖得很长，反而看不清重点。 */
  const active = all.filter(is_active_incident);
  const done = all.filter((i) => !is_active_incident(i)).slice(0, 6);
  const incidents = [...active, ...done];

  /* 按 id 复用；顺序变了就按新顺序挪位置 */
  const keep = new Set(incidents.map((i) => i.id));
  for (const [id, node] of nodes) {
    if (!keep.has(id)) {
      node.root.remove();
      nodes.delete(id);
    }
  }

  if (!incidents.length) {
    dom.list.replaceChildren(
      Object.assign(el("div", "empty"), {
        textContent: state?.mode === "demo" ? "演示数据准备中…" : "目前没有预警，指挥大屏正在巡检",
      })
    );
    dom.list_hint.textContent = "等待第一条预警";
    return;
  }

  const frag = document.createDocumentFragment();
  for (const inc of incidents) {
    let node = nodes.get(inc.id);
    if (!node) {
      node = card_for(inc);
      nodes.set(inc.id, node);
    } else {
      fill_card(node, inc);
    }
    /* 全部按顺序塞进 fragment 再整体贴回去：顺序变了也只是挪节点，
       不会重建，滚动位置和动画都不受影响 */
    frag.append(node.root);
  }
  dom.list.replaceChildren(frag);

  const active_count = incidents.filter(is_active_incident).length;
  dom.list_hint.textContent = active_count
    ? `${active_count} 条进行中`
    : `最近 ${incidents.length} 条已处置`;
}

function render(snapshot) {
  state = snapshot;

  /* 连接状态 */
  const mode = snapshot.mode;
  const map = {
    live: "实时接收",
    demo: "演示数据",
    connecting: "连接中",
    reconnecting: "重连中",
  };
  dom.conn.dataset.mode = mode;
  dom.conn_text.textContent = map[mode] || "连接中";

  /* 计数：进行中 = 待派单 + 前往中 + 到场 + 处置中 */
  const c = snapshot.counts || {};
  const incidents = snapshot.incidents || [];
  const checking = incidents.filter((i) => i.status === "pending").length;
  const handling = incidents.filter((i) => i.status === "dispatched" || i.status === "on_site" || i.status === "handling").length;
  dom.n_active.textContent = String(checking);
  dom.n_handling.textContent = String(handling);
  dom.n_resolved.textContent = String(c.resolved_today || 0);

  /* 场景行 */
  const scene = snapshot.scene?.id || incidents[0]?.scene || "campus";
  const model = SCENE_MODELS[scene];
  dom.scene_name.textContent = `${scene_label(scene)} · ${model ? model.name : "等待场景"}`;
  dom.scene_time.textContent = snapshot.last_event_ts ? format_hms(snapshot.last_event_ts) : "—";

  /* 换场景时旧卡片作废，避免「小区」的卡片留在「校园」列表里 */
  if (last_scene && scene !== last_scene) {
    for (const node of nodes.values()) node.root.remove();
    nodes.clear();
  }
  last_scene = scene;

  render_list(incidents);

  const unread = c.unread || 0;
  dom.unread.hidden = unread <= 0;
  dom.unread.textContent = String(unread);
}

/* ── 详情抽屉 ─────────────────────────────────────────────────────────── */

function open_sheet(id) {
  const inc = (state?.incidents || []).find((i) => i.id === id);
  if (!inc) return;

  dom.sheet_title.textContent = inc.area || scene_label(inc.scene);

  const photo = photo_for_incident(inc);
  set_photo(dom.sheet_img, dom.sheet_photo_empty, photo);
  dom.sheet_cap.hidden = !photo?.caption;
  dom.sheet_cap.textContent = photo?.caption || "";

  const sm = status_meta(inc.status);
  const km = kind_meta(inc.kind);
  const model = SCENE_MODELS[inc.scene];

  const rows = [
    ["异常", `${inc.name || km.name} · ${km.level_label}`],
    ["状态", sm.label],
    ["时间", format_hms(inc.created_ts || inc.updated_ts)],
    ["场景", scene_label(inc.scene)],
  ];
  if (inc.camera) rows.push(["监控点", inc.camera]);
  if (model) rows.push(["主判模型", model.name]);
  if (inc.analysis) rows.push(["置信度", `${Math.round(inc.analysis.confidence * 100)}%`]);
  if (inc.agent) rows.push(["执行体", `${inc.agent.name} · ${inc.agent.type === "person" ? "人" : "机器人"}`]);
  if (Number.isFinite(inc.distance_m)) {
    rows.push(["距离", `${Math.round(inc.distance_m)} 米${Number.isFinite(inc.eta_s) ? ` · 约 ${Math.max(1, Math.round(inc.eta_s))} 秒` : ""}`]);
  }

  const frag = document.createDocumentFragment();
  for (const [k, v] of rows) {
    frag.append(el("dt", null, k), el("dd", null, v));
  }
  dom.sheet_rows.replaceChildren(frag);

  const phase = sm.phase || 1;
  const pfrag = document.createDocumentFragment();
  for (const p of PHASES) {
    const box = el("div", p.phase <= phase ? "done" : "");
    box.append(el("i"), el("span", null, p.label));
    pfrag.append(box);
  }
  dom.sheet_phases.replaceChildren(pfrag);

  dom.sheet.classList.add("is-on");
  document.body.style.overflow = "hidden";
}

function close_sheet() {
  dom.sheet.classList.remove("is-on");
  document.body.style.overflow = "";
}

dom.sheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) close_sheet();
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") close_sheet();
});

/* ── 上报流程 ─────────────────────────────────────────────────────────── */

let scene_pick = "campus";
let shot = null;           // { src, caption, kind, demo }
let demo_idx = 0;
let sending = false;

function set_shot(next) {
  shot = next;
  if (!next) {
    dom.shot_img.hidden = true;
    dom.shot_empty.hidden = false;
    dom.shot_cap.hidden = true;
    dom.btn_send.disabled = true;
    dom.btn_send.textContent = "先拍一张照片";
    dom.verdict.hidden = true;
    return;
  }
  dom.shot_empty.hidden = true;
  dom.shot_img.hidden = false;
  dom.shot_img.src = next.src;
  dom.shot_img.alt = next.caption || "现场照片";
  dom.shot_cap.hidden = !next.caption;
  dom.shot_cap.textContent = next.caption || "";
  dom.btn_send.disabled = false;
  dom.btn_send.textContent = "上报给指挥中心";
  analyse();
}

function analyse() {
  const kind = shot?.kind || ["fire", "crowd", "trash"][Math.floor(hash01(scene_pick + (shot?.src || "")) * 3)];
  const model = SCENE_MODELS[scene_pick];
  const a = default_analysis(kind, {
    id: `${scene_pick}|${shot?.src || ""}`,
    area: shot?.caption || model?.name || "现场",
    camera: "手机上报",
  });
  const km = kind_meta(kind);

  dom.verdict_title.textContent = km.name;
  dom.verdict_model.textContent = model ? model.name : "";
  const rows = [
    ["置信度", `${Math.round(a.confidence * 100)}%`],
    ["识别来源", a.detect],
    ["研判理由", a.rationale],
    ["处置建议", a.suggestion],
  ];
  const frag = document.createDocumentFragment();
  for (const [k, v] of rows) frag.append(el("dt", null, k), el("dd", null, v));
  dom.verdict_rows.replaceChildren(frag);
  dom.verdict.hidden = false;

  shot.kind = kind;
  shot.confidence = a.confidence;

  /* 手机上选完照片，结论和上报按钮通常在屏幕外，滚过去免得用户以为没反应 */
  requestAnimationFrame(() => {
    dom.btn_send.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

dom.seg.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-scene]");
  if (!b) return;
  scene_pick = b.dataset.scene;
  for (const x of dom.seg.querySelectorAll("button")) x.classList.toggle("is-on", x === b);
  demo_idx = 0;
  /* 换了场景，原来那张演示照片就不对味了，清掉重来 */
  if (shot?.demo) set_shot(null);
  update_demo_btn();
});

function update_demo_btn() {
  const pool = photos_of(scene_pick);
  dom.btn_demo.disabled = !pool.length;
  dom.photo_hint.textContent = pool.length
    ? "演示照片来自 public/photos/，可以换成真实拍摄的现场图。"
    : "还没有照片库：把图片放进 public/photos/ 并配置 photos.json，这里就会多出「用演示照片」。";
}

dom.btn_camera.addEventListener("click", () => dom.file.click());

dom.file.addEventListener("change", () => {
  const f = dom.file.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  set_shot({ src: url, caption: "本机拍摄 · 未上传", kind: null, demo: false });
  dom.file.value = "";
});

dom.btn_demo.addEventListener("click", () => {
  const pool = photos_of(scene_pick);
  if (!pool.length) return;
  const p = pool[demo_idx % pool.length];
  demo_idx++;
  set_shot({ ...p, demo: true });
});

async function send_report() {
  if (sending || !shot) return;
  sending = true;
  dom.btn_send.disabled = true;
  dom.btn_send.textContent = "上报中…";
  try {
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visitor_report",
        scene: scene_pick,
        kind: shot.kind || "crowd",
        confidence: shot.confidence || 0.9,
        name: kind_meta(shot.kind || "crowd").name,
        client_id: client_id(),
        note: "观众手机上报",
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`);
    toast("已上报，指挥中心已收到");
    set_shot(null);
    show_screen("alerts");
  } catch (err) {
    toast(`上报失败：${err.message}`, 3000);
  } finally {
    sending = false;
    dom.btn_send.disabled = !shot;
    if (shot) dom.btn_send.textContent = "上报给指挥中心";
  }
}

dom.btn_send.addEventListener("click", send_report);

/* ── 启动 ─────────────────────────────────────────────────────────────── */

async function boot() {
  await load_photos();
  update_demo_btn();

  const store = create_alert_store({ allow_demo: true, demo_speed: 1 });
  store.subscribe(render);
  store.start();

  /* 回到前台时补一次状态，避免息屏回来还是旧列表 */
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") store.refresh();
  });
}

boot();
