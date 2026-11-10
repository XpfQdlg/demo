/* ══════════════════════════════════════════════════════════════════════════
   stage — 大屏的四模型值守栏 + 底部链路条 + 会诊面板排版

   这一层只做「讲清楚」：
   · 左侧四张卡回答「我们有哪四个模型、各自管什么、今天出了多少预警」；
   · 底部四段链路回答「一条预警是怎么从识别走到手机的」；
   · 观众上报时把 #visitorToast 铺满整屏，四个模型依次亮起。
   3D 只负责把当前场景演出来，模型口径统一从 mobile/contract.js 取。
   ══════════════════════════════════════════════════════════════════════════ */

import { MODEL_CHAIN, MODEL_ORDER, SCENE_MODELS } from "../mobile/contract.js";

const TASKS = { campus: 30, community: 21, subway: 32, forest: 7 };

const counts = Object.fromEntries(MODEL_ORDER.map((k) => [k, 0]));
const cards = new Map();
let active = "campus";
let visitors = 0;
let agents_n = 5;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ── 左栏 ─────────────────────────────────────────────────────────────── */

export function mount_deck({ on_scene } = {}) {
  if (document.getElementById("deck")) return;

  const deck = el("aside");
  deck.id = "deck";
  deck.setAttribute("aria-label", "四模型值守");

  const brand = el("div", "dk-brand");
  brand.append(el("b", null, "AEGIS"), el("span", null, "城市风险中枢"));
  const sub = el("div", "dk-sub", "四模型 · 一中枢 · 统一调度");
  const list = el("ul", "dk-list");

  MODEL_ORDER.forEach((key, i) => {
    const m = SCENE_MODELS[key];
    const li = el("li", "dk-card");
    li.dataset.scene = key;
    li.style.setProperty("--accent", m.accent);
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `切换到${m.name}：${m.tagline}`);

    const r1 = el("div", "dk-r1");
    const idx = el("span", "dk-idx", String(i + 1).padStart(2, "0"));
    const name = el("span", "dk-name", m.name);
    const live = el("span", "dk-live");
    live.append(el("i"), document.createTextNode("值守中"));
    r1.append(idx, name, live);

    const tag = el("div", "dk-tag", m.tagline);

    const r2 = el("div", "dk-r2");
    const mk = (n, label, hot) => {
      const s = el("span", "dk-metric" + (hot ? " hot" : ""));
      const b = el("b", null, String(n));
      s.append(b, document.createTextNode(label));
      return s;
    };
    const task_metric = mk(TASKS[key] ?? "—", "项识别");
    const alert_metric = mk(0, "今日预警", true);
    r2.append(task_metric, alert_metric);

    const scan = el("div", "dk-scan");
    scan.append(el("i"));

    li.append(r1, tag, r2, scan);
    list.append(li);

    const card = { li, alert_b: alert_metric.querySelector("b") };
    cards.set(key, card);

    const go = () => {
      on_scene?.(key);
    };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
    /* 指针悬停时把 3D 也切过去太跳，只在点击时切；悬停只做高亮 */
    li.addEventListener("pointerenter", () => li.classList.add("hover"));
    li.addEventListener("pointerleave", () => li.classList.remove("hover"));
  });

  const foot = el("div", "dk-foot");
  const foot_agents = el("span");
  foot_agents.innerHTML = `执行体 <b data-k="agents">5</b> 台`;
  const sep1 = el("i", "sep");
  const foot_visitors = el("span");
  foot_visitors.innerHTML = `观众参与 <b data-k="visitors">0</b>`;
  const sep2 = el("i", "sep");
  const foot_models = el("span");
  foot_models.innerHTML = `四模型 <b>在线</b>`;
  foot.append(foot_agents, sep1, foot_visitors, sep2, foot_models);

  deck.append(brand, sub, list, foot);
  document.body.append(deck);
  deck_footer();
}

export function deck_set_active(scene) {
  active = scene;
  for (const [key, c] of cards) c.li.classList.toggle("on", key === scene);
}

export function deck_alert(scene, label) {
  const c = cards.get(scene);
  if (!c) return;
  counts[scene] += 1;
  c.alert_b.textContent = String(counts[scene]);
  c.li.classList.remove("flash");
  void c.li.offsetWidth;
  c.li.classList.add("flash");
  if (label) {
    const live = c.li.querySelector(".dk-live");
    if (live) live.lastChild.textContent = "识别中";
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      if (live) live.lastChild.textContent = "值守中";
    }, 5200);
  }
}

/** 刷新页面后按总线里的历史事件把「今日预警」补回去：只改数字，不放闪烁动画 */
export function deck_restore(map) {
  for (const [scene, n] of Object.entries(map || {})) {
    const c = cards.get(scene);
    const v = Number(n) || 0;
    if (!c || v <= 0) continue;
    counts[scene] = Math.max(counts[scene], v);
    c.alert_b.textContent = String(counts[scene]);
  }
}

export function deck_model(scene) {
  return SCENE_MODELS[scene] || SCENE_MODELS.campus;
}

export function deck_visitors(n) {
  visitors = Number(n) || 0;
  deck_footer();
}

export function deck_agents(n) {
  agents_n = Number(n) || agents_n;
  deck_footer();
}

function deck_footer() {
  const a = document.querySelector('#deck [data-k="agents"]');
  const v = document.querySelector('#deck [data-k="visitors"]');
  if (a) a.textContent = String(agents_n);
  if (v) v.textContent = String(visitors);
}

/* ── 底部链路 ─────────────────────────────────────────────────────────── */

let chain_steps = [];
let chain_timer = 0;
let chain_head = null;

export function mount_chain() {
  if (document.getElementById("chain")) return;
  const box = el("section");
  box.id = "chain";
  box.setAttribute("aria-label", "应用链路");

  const head = el("div", "ch-head");
  const t = el("b", null, "应用链路");
  const note = el("span", null, "/ ONE ALERT, FOUR STEPS");
  const now = el("span", "ch-now", "等待下一条预警");
  head.append(t, note, now);
  chain_head = now;

  const steps = el("div", "ch-steps");
  MODEL_CHAIN.forEach((s, i) => {
    const row = el("div", "ch-step");
    row.dataset.i = String(i);
    const bar = el("i");
    const n = el("b", null, String(i + 1).padStart(2, "0"));
    const label = el("span", null, s.label);
    row.append(bar, n, label);
    row.title = s.note;
    steps.append(row);
  });

  box.append(head, steps);
  document.body.append(box);
  chain_steps = [...steps.children];
}

/** 点亮到第 step 步（0..3）；传 -1 复位 */
export function chain_stage(step, note) {
  chain_steps.forEach((row, i) => {
    row.classList.toggle("on", i <= step);
    row.classList.toggle("now", i === step);
  });
  if (chain_head) chain_head.textContent = note || chain_head.textContent;
  clearTimeout(chain_timer);
  if (step < 0) return;
  if (step >= MODEL_CHAIN.length - 1) {
    chain_timer = setTimeout(() => {
      if (chain_head) chain_head.textContent = "已闭环 · 等待下一条预警";
    }, 6000);
  }
}

/** 从识别开始自动走一遍，用于鼠标点击派单这类没有完整事件链的场景 */
export function chain_play(note) {
  chain_stage(0, note || "识别 → 研判");
  let i = 0;
  const tick = () => {
    i += 1;
    if (i > 2) return;
    chain_stage(i, ["识别 → 研判", "研判 → 调度", "调度 → 触达"][i] || note);
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1300);
}

/* ── 会诊面板：把平铺的 v-row 换成「模型名 + 读数 + 结论」 ───────────── */

export function paint_consult(rows, { verdict }) {
  const ol = document.getElementById("visitorRows");
  if (!ol) return;
  ol.replaceChildren(
    ...rows.map((row, i) => {
      const li = el("li", "v-row" + (row.main ? " is-main" : ""));
      li.style.setProperty("--row-accent", row.accent);

      const top = el("div", "v-top");
      top.append(el("span", "v-dot"), el("span", "v-model", row.model), el("span", "v-tag", row.tag));

      const read = el("div", "v-read");
      if (row.pct) {
        const pct = el("div", "v-pct", String(row.pct));
        pct.append(el("small", null, "%"));
        read.append(pct);
        read.append(el("div", "v-read-k", "置信度 · 主判"));
      } else {
        read.append(el("div", "v-state", row.state || "复核通过"));
        read.append(el("div", "v-read-k", "独立复核 · 无同类风险"));
      }

      const text = el("p", "v-text", row.text);
      li.append(top, read, text);
      setTimeout(() => li.classList.add("on"), 160 + i * 240);
      return li;
    })
  );
  const v = document.getElementById("visitorVerdict");
  if (v) v.textContent = verdict || "四模型会诊中…";
}

/* ── 时钟 ─────────────────────────────────────────────────────────────── */

export function mount_clock() {
  const box = document.querySelector("#deck .dk-sub");
  if (!box || box.dataset.clock) return;
  box.dataset.clock = "1";
  const t = el("span", "dk-clock");
  t.style.cssText = "float:right;font-family:var(--num);letter-spacing:.06em;color:var(--ink-2)";
  box.append(t);
  const tick = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    t.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}
