/* ══════════════════════════════════════════════════════════════════════════
   tablet — 台上演示控制台

   讲解员手里的平板：四个模型各三个情景，点一下就把一条 visitor_report
   发到总线，大屏收到后走同一套「四模型会诊 → 切场景 → 就近调度」。
   和手机上报共用协议，不另开一条链路。
   ══════════════════════════════════════════════════════════════════════════ */

import { KIND_META, MODEL_ORDER, SCENE_MODELS } from "../mobile/contract.js";

const KINDS = ["fire", "crowd", "trash"];
const $ = (s) => document.querySelector(s);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const main = $("#models");
const status = $("#status");
const live = $("#live");

let busy = false;

function set_status(html, bad = false) {
  status.innerHTML = html;
  status.classList.toggle("bad", bad);
}

async function poll_health() {
  try {
    const r = await fetch("/api/commands/health", { cache: "no-store" });
    const j = await r.json();
    const n = Number(j.clients) || 0;
    live.classList.toggle("off", n === 0);
    live.querySelector("span").textContent = n > 0 ? `大屏已连接 · ${n} 个订阅` : "大屏未连接";
  } catch {
    live.classList.add("off");
    live.querySelector("span").textContent = "总线不可用";
  }
}

async function report(scene, kind, btn) {
  if (busy) return;
  busy = true;
  const meta = SCENE_MODELS[scene];
  const name = meta.alert_names[kind] || KIND_META[kind].name;
  btn.disabled = true;
  btn.querySelector(".go").textContent = "上报中…";
  set_status(`正在上报 <b>${meta.name} · ${name}</b>`);

  try {
    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visitor_report",
        scene,
        kind,
        confidence: 0.9 + Math.random() * 0.08,
        name,
        client_id: "tablet",
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) throw new Error(j.error || res.status);
    btn.classList.add("done");
    btn.querySelector(".go").textContent = "已上报";
    set_status(`已上报 <b>${meta.name} · ${name}</b> · 大屏会诊中`);
    setTimeout(() => {
      btn.classList.remove("done");
      btn.disabled = false;
      btn.querySelector(".go").textContent = "触发";
    }, 4000);
  } catch (e) {
    set_status(`上报失败：<b>${String(e.message || e)}</b>，检查 dev server`, true);
    btn.disabled = false;
    btn.querySelector(".go").textContent = "重试";
  } finally {
    busy = false;
  }
}

for (const key of MODEL_ORDER) {
  const m = SCENE_MODELS[key];
  const card = el("section", "model");
  card.style.setProperty("--accent", m.accent);

  const top = el("div", "m-top");
  top.append(el("span", "m-dot"), el("span", "m-name", m.name), el("span", "m-scene", m.scene_label));
  card.append(top, el("div", "m-tag", m.tagline), el("div", "m-line", m.coverage));

  const list = el("div", "m-btns");
  for (const kind of KINDS) {
    const meta = KIND_META[kind];
    const name = m.alert_names[kind] || meta.name;
    const btn = el("button", "fire-btn");
    btn.type = "button";
    btn.style.setProperty("--k", meta.color);
    btn.append(el("span", "lv", meta.level_label), el("span", "nm", name), el("span", "go", "触发"));
    btn.addEventListener("click", () => report(key, kind, btn));
    list.append(btn);
  }
  card.append(list);
  main.append(card);
}

poll_health();
setInterval(poll_health, 5000);
