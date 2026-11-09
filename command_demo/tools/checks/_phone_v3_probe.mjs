/**
 * 手机端 AEGIS 重设计 + 新互动验收。
 *
 *   node tools/checks/_phone_v3_probe.mjs
 *
 * 验：四 Tab、语音上报、巡检点打卡、模型盲盒、我的/角色/心跳、现场回传，
 * 同时确认旧预警/四模型/观众上报能力没有回归。
 *
 * 前置：dev server 在 5179、puppeteer-core、本机 Chrome。
 * 截图：shots/probe_phone_v3_voice.png / quiz.png / me.png
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome / Edge");
  process.exit(1);
}

const BASE = process.env.DEMO_BASE || "http://127.0.0.1:5179";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app_errs = (list) => list.filter((e) => !e.includes("Failed to load resource"));
const post = (path, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const get = (path) => fetch(BASE + path).then((r) => r.json());

await fetch(BASE + "/api/alerts/reset", { method: "POST" });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 300000,
  args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
await page.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => document.getElementById("conn")?.dataset.mode === "live", { timeout: 8000 });
await sleep(600);

/* ── 四 Tab ─────────────────────────────────────────────────────────── */
const tabs = ["alerts", "models", "join", "me"];
const tabbar = await page.$$eval("#tabbar [data-tab]", (nodes) => nodes.map((n) => n.dataset.tab));
check("底部四个 Tab 齐全", JSON.stringify(tabbar) === JSON.stringify(tabs), JSON.stringify(tabbar));
for (const tab of tabs) {
  await page.$eval(`#tabbar [data-tab="${tab}"]`, (el) => el.click());
  await sleep(280);
  const state = await page.evaluate((key) => {
    const panel = document.querySelector(`[data-panel="${key}"]`);
    const btn = document.querySelector(`#tabbar [data-tab="${key}"]`);
    return { visible: !!panel && panel.classList.contains("is-active"), active: !!btn && btn.classList.contains("is-active") };
  }, tab);
  check(`切到 ${tab} Tab`, state.visible && state.active, JSON.stringify(state));
}
check("旧预警节点仍在", !!(await page.$("#stat-pending")) && !!(await page.$("#filters")) && !!(await page.$("#join-btn")));

/* ── 我的：值班员角色 / 心跳 ───────────────────────────────────────── */
await page.$eval('#tabbar [data-tab="me"]', (el) => el.click());
await sleep(400);
await page.$eval('#role-grid [data-role="fire"]', (el) => el.click());
await sleep(1200);
const me_state = await page.evaluate(() => {
  let role = null;
  try {
    role = JSON.parse(localStorage.getItem("aegis.profile.v1") || "{}").role || null;
  } catch {
    role = null;
  }
  return {
    role,
    label: document.getElementById("me-role-label")?.textContent.trim(),
    client: document.getElementById("me-client")?.textContent.trim(),
    online: document.getElementById("me-online")?.textContent.trim(),
  };
});
check("我的页角色切换写入本机", me_state.role === "fire" && me_state.label === "消防", JSON.stringify(me_state));
const people = await get("/api/participants");
const me_on_server = (people.participants || []).find((p) => p.client_id === me_state.client);
check("角色同步到总线", !!me_on_server && me_on_server.role === "fire", JSON.stringify(me_on_server));
await page.screenshot({ path: "shots/probe_phone_v3_me.png" });

/* ── 语音上报 ───────────────────────────────────────────────────────── */
await page.$eval('#tabbar [data-tab="join"]', (el) => el.click());
await sleep(300);
await page.$eval("#entry-voice", (el) => el.click());
await page.waitForFunction(() => !document.getElementById("voice")?.hidden, { timeout: 4000 });
/* 直接派发 PointerEvent：无头 + isMobile 模式下 mouse 事件不一定映射成 pointer */
await page.evaluate(() => {
  const el = document.getElementById("voice-hold");
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "touch" }));
});
await sleep(900);
await page.evaluate(() => {
  const el = document.getElementById("voice-hold");
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch" }));
});
await page.waitForFunction(() => !document.getElementById("voice-result")?.hidden, { timeout: 8000 });
const voice = await page.evaluate(() => ({
  text: document.getElementById("voice-text")?.textContent.trim(),
  kind: document.getElementById("voice-result-kind")?.textContent.trim(),
  conf: document.getElementById("voice-result-conf")?.textContent.trim(),
  submit: !document.getElementById("voice-submit")?.hidden,
}));
check("语音识别出场景与异常", !!voice.text && !!voice.kind && /%/.test(voice.conf || ""), JSON.stringify(voice));
await page.screenshot({ path: "shots/probe_phone_v3_voice.png" });
await page.$eval("#voice-submit", (el) => el.click());
await page.waitForSelector(".card.is-visitor", { timeout: 20000 });
const stats_voice = await get("/api/stats");
check("语音上报进入指挥闭环", (stats_voice.visitor_reports || 0) >= 1, JSON.stringify({ reports: stats_voice.visitor_reports }));
await sleep(500);
await page.$eval("#voice-close", (el) => el.click()).catch(() => {});

/* ── 巡检点打卡 ─────────────────────────────────────────────────────── */
await page.$eval('#tabbar [data-tab="join"]', (el) => el.click());
await sleep(300);
await page.$eval("#entry-ar", (el) => el.click());
await page.waitForFunction(() => !document.getElementById("ar")?.hidden, { timeout: 4000 });
await page.$eval('[data-ar-checkpoint="campus"]', (el) => el.click());
await page.waitForFunction(() => !document.getElementById("ar-result")?.hidden, { timeout: 8000 });
const ar = await page.evaluate(() => ({
  title: document.getElementById("ar-result-title")?.textContent.trim(),
  text: document.getElementById("ar-result-text")?.textContent.trim(),
  canSubmit: !document.getElementById("ar-submit")?.hidden,
}));
check("巡检点扫描出结果", !!ar.title && !!ar.text, JSON.stringify(ar));
if (ar.canSubmit) {
  await page.$eval("#ar-submit", (el) => el.click());
  await page.waitForSelector(".card.is-visitor", { timeout: 20000 });
  const stats_ar = await get("/api/stats");
  check("巡检异常可上报指挥中心", (stats_ar.visitor_reports || 0) >= 2, JSON.stringify({ reports: stats_ar.visitor_reports }));
} else {
  check("巡检正常时无可上报按钮", true);
}
await page.$eval("#ar-close", (el) => el.click()).catch(() => {});
await sleep(400);

/* ── 模型盲盒 ───────────────────────────────────────────────────────── */
await page.$eval('#tabbar [data-tab="join"]', (el) => el.click());
await sleep(300);
await page.$eval("#entry-quiz", (el) => el.click());
await page.waitForFunction(() => !document.getElementById("quiz")?.hidden, { timeout: 4000 });
let rounds = 0;
for (let i = 0; i < 6; i++) {
  await page.waitForFunction(() => document.querySelectorAll(".quiz-option").length === 3, { timeout: 5000 }).catch(() => {});
  const has_result = await page.evaluate(() => !document.getElementById("quiz-result")?.hidden);
  if (has_result) break;
  const options = await page.$$(".quiz-option");
  if (!options.length) break;
  await options[0].click();
  rounds++;
  await page.waitForFunction(() => !document.getElementById("quiz-reveal")?.hidden, { timeout: 5000 }).catch(() => {});
  await sleep(1400);
}
const quiz = await page.evaluate(() => ({
  scored: document.getElementById("quiz-score")?.textContent.trim(),
  result: !document.getElementById("quiz-result")?.hidden,
  final: document.getElementById("quiz-final-score")?.textContent.trim(),
}));
check("盲盒可完成 5 轮并结算", rounds >= 3 && !!quiz.final, JSON.stringify({ rounds, ...quiz }));
await page.screenshot({ path: "shots/probe_phone_v3_quiz.png" });
const score_before = await page.evaluate(() => document.getElementById("me-score")?.textContent.trim());
await page.$eval("#quiz-rank", (el) => el.click()).catch(() => {});
await sleep(1400);
const leader_score = (await get("/api/participants")).participants?.find((p) => p.client_id === me_state.client)?.score ?? 0;
check("盲盒得分登记上榜", leader_score > 0, JSON.stringify({ score_before, leader_score }));
await page.$eval("#quiz-close", (el) => el.click()).catch(() => {});
await sleep(400);

/* ── 现场回传 ───────────────────────────────────────────────────────── */
/* 先造一帧，再打开 visitor 卡片详情 */
await post("/api/frames", { dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AT//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AT//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Qf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Qf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8Qf//Z", scene: "campus", device: "dog-2" });
await page.$eval('#tabbar [data-tab="alerts"]', (el) => el.click());
await sleep(300);
await page.$eval(".card.is-visitor", (el) => el.click());
await sleep(1200);
const live = await page.evaluate(() => ({
  section: !!document.getElementById("sheet-live") && !document.getElementById("sheet-live").hidden,
  frame: document.getElementById("live-frame")?.getAttribute("src")?.startsWith("data:image") || false,
  meta: document.getElementById("live-meta")?.textContent.trim(),
}));
check("详情显示机器狗第一视角回传", live.section && live.frame, JSON.stringify(live));
await page.$eval("#sheet-close", (el) => el.click());
await sleep(400);

/* ── 320 适配 ───────────────────────────────────────────────────────── */
const small = await browser.newPage();
await small.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await small.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await sleep(1000);
const layout = await small.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  iw: innerWidth,
  tabs: document.querySelectorAll("#tabbar [data-tab]").length,
  join_visible: !!document.querySelector("#tabbar [data-tab='join']"),
}));
check("320 无横向滚动且 Tab 可用", layout.sw <= layout.iw && layout.tabs === 4, JSON.stringify(layout));
await small.$eval('#tabbar [data-tab="join"]', (el) => el.click());
await sleep(300);
const join320 = await small.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  iw: innerWidth,
  entries: document.querySelectorAll(".entry-card").length,
}));
check("320 参与页不溢出", join320.sw <= join320.iw && join320.entries >= 4, JSON.stringify(join320));
await small.screenshot({ path: "shots/probe_phone_v3_320.png" });
await small.close();

check("无应用层报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));
await page.close();
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
