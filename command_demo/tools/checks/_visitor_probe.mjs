/**
 * 观众参与闭环的端到端验收。
 *
 *   node tools/checks/_visitor_probe.mjs
 *
 * 一个浏览器开两个页面：
 *   大屏  cinematic.html（订阅指挥流）
 *   手机  mobile.html（打开参与浮层，用演示照片走一遍会诊 → 上报）
 *
 * 验：
 *   1. 手机能完成「选场景 → 演示照片 → 四模型会诊 → 一键上报」；
 *   2. 大屏收到指令后弹金色会诊面板、切场景、在 3D 里生成观众上报异常；
 *   3. 大屏事件带 visitor 标记推到手机，手机出现「观众上报」卡片；
 *   4. 派单后手机收到回执，处置完成后卡片闭环。
 *
 * 前置：dev server 在 5179、puppeteer-core、本机 Chrome/Edge。
 * 截图：shots/visitor_probe_bigscreen.png、visitor_probe_phone.png
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

await fetch(`${BASE}/api/alerts/reset`, { method: "POST" });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});

/* ── 大屏 ────────────────────────────────────────────────────────────── */
const desk = await browser.newPage();
await desk.setViewport({ width: 1600, height: 900 });
const desk_errs = [];
desk.on("pageerror", (e) => desk_errs.push("pageerror: " + e.message));
desk.on("console", (m) => m.type() === "error" && desk_errs.push("console: " + m.text().slice(0, 200)));
await desk.goto(`${BASE}/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await desk.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await desk.waitForFunction(() => window.__visitor_es && window.__visitor_es.readyState === 1, { timeout: 20000 });
await sleep(1200);

/* ── 手机 ────────────────────────────────────────────────────────────── */
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone_errs = [];
phone.on("pageerror", (e) => phone_errs.push("pageerror: " + e.message));
phone.on("console", (m) => m.type() === "error" && phone_errs.push("console: " + m.text().slice(0, 200)));
await phone.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await phone.waitForSelector('#conn[data-mode="live"]', { timeout: 8000 });
await phone.waitForSelector("#join-btn", { timeout: 8000 });
check("手机页有参与入口", true);

await phone.$eval("#join-btn", (el) => el.click());
await phone.waitForSelector("#join", { timeout: 5000 });
await phone.waitForFunction(() => !document.getElementById("join").hidden, { timeout: 5000 });
check("参与浮层打开", true);

/* 选校园场景（默认就是当前场景，点一下保证状态明确） */
await phone.$eval('[data-join-scene="campus"]', (el) => el.click()).catch(() => {});
await sleep(300);

/* 用演示照片，不依赖摄像头权限 */
await phone.$eval("#join-sample", (el) => el.click());
await sleep(700);
const photo_state = await phone.evaluate(() => {
  const preview = document.getElementById("join-preview");
  return {
    has_preview: !!preview && !preview.hidden && (preview.tagName === "IMG" || preview.tagName === "CANVAS"),
    src_kind: preview?.tagName,
  };
});
check("演示照片能进预览", photo_state.has_preview || !!photo_state.preview_text, JSON.stringify(photo_state));

/* 四模型会诊 */
await phone.$eval("#join-analyze", (el) => el.click());
await phone.waitForFunction(() => {
  const conf = document.getElementById("join-confidence");
  return conf && /\d+%/.test(conf.textContent || "");
}, { timeout: 12000 });
const analysis = await phone.evaluate(() => ({
  confidence: document.getElementById("join-confidence")?.textContent?.trim(),
  rows: [...document.querySelectorAll("#join-model-rows .join-model-row")].map((row) =>
    row.textContent.replace(/\s+/g, " ").trim()
  ),
  status: document.getElementById("join-status")?.textContent?.trim(),
}));
check("四模型会诊出结论", analysis.rows.length === 4 && /\d+%/.test(analysis.confidence || ""), JSON.stringify(analysis));
check(
  "会诊行里有主判与复核",
  analysis.rows.some((t) => /主判/.test(t)) && analysis.rows.filter((t) => /复核/.test(t)).length >= 2,
  JSON.stringify(analysis.rows)
);
await phone.screenshot({ path: "shots/visitor_probe_join.png" });

/* 一键上报 */
const submit = await phone.$("#join-submit");
check("上报按钮可用", !!submit);
await phone.$eval("#join-submit", (el) => el.click());

/* 大屏会诊面板应弹出；场景切换要等 3D 建完 */
await desk.waitForSelector("#visitorToast.on", { timeout: 90000 });
const desk_overlay = await desk.evaluate(() => ({
  title: document.getElementById("visitorTitle")?.textContent?.trim(),
  scene: document.getElementById("visitorScene")?.textContent?.trim(),
  rows: document.querySelectorAll("#visitorRows .v-row").length,
  main: document.querySelectorAll("#visitorRows .v-row.is-main").length,
  verdict: document.getElementById("visitorVerdict")?.textContent?.trim(),
  counter: document.getElementById("visitorCount")?.textContent?.trim(),
}));
check("大屏弹出四模型会诊", desk_overlay.rows === 4 && desk_overlay.main === 1, JSON.stringify(desk_overlay));
check("大屏计数增加", desk_overlay.counter === "观众参与 1", desk_overlay.counter);

/* 大屏 3D 里应生成观众上报异常，并真的派单 */
await desk.waitForFunction(
  () => window.__monitor?.incidents?.some((inc) => inc.visitor),
  { timeout: 30000 }
).catch(() => {});
const desk_state = await desk.evaluate(() => ({
  scene: window.__monitor?.scene,
  visitor: window.__monitor?.incidents?.filter((inc) => inc.visitor).length || 0,
  follow: !!window.__cine?.follow,
  verdict: document.getElementById("visitorVerdict")?.textContent?.trim(),
}));
check("大屏切场景并生成观众上报异常", desk_state.scene === "campus" && desk_state.visitor === 1, JSON.stringify(desk_state));
await desk.screenshot({ path: "shots/visitor_probe_bigscreen.png" });

/* 总线里应有 visitor 生命周期；手机应出现「观众上报」卡片 */
const snap = await fetch(`${BASE}/api/alerts/snapshot`).then((r) => r.json());
const visitor_events = snap.events.filter((e) => e.incident?.visitor);
check("总线收到观众上报生命周期", visitor_events.length >= 2, JSON.stringify(visitor_events.map((e) => e.type)));
check(
  "事件带 visitor 与场景",
  visitor_events[0]?.incident?.visitor === true && visitor_events[0]?.scene === "campus",
  JSON.stringify(visitor_events[0]?.incident)
);

/* .card-visitor 是卡片里的徽标，带 visitor 标记的卡片本身是 .card.is-visitor */
await phone.waitForSelector(".card.is-visitor", { timeout: 30000 });
const phone_card = await phone.$eval(".card.is-visitor", (card) => ({
  id: card.dataset.id,
  status: card.dataset.status,
  badge: card.querySelector(".card-visitor")?.textContent.replace(/\s+/g, " ").trim(),
  text: card.textContent.replace(/\s+/g, " ").trim().slice(0, 120),
}));
check(
  "手机出现观众上报卡片",
  !!phone_card.id && /观众上报/.test(phone_card.badge || "") && /观众上报/.test(phone_card.text),
  JSON.stringify(phone_card)
);
check("上报受理状态条消失", await phone.evaluate(() => document.getElementById("visitor-pending")?.hidden !== false));
await phone.screenshot({ path: "shots/visitor_probe_phone.png" });

/* 让执行体到场并等处置完成，手机卡片应闭环 */
await desk.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents.find((i) => i.visitor);
  if (inc?.by) m._arrive(inc, inc.by);
});
await sleep(9000);
await phone.waitForFunction(
  (id) => document.querySelector(`.card[data-id="${id}"]`)?.dataset.status === "resolved",
  { timeout: 20000 },
  phone_card.id
).catch(() => {});
const closed = await phone.$eval(`.card[data-id="${phone_card.id}"]`, (card) => card.dataset.status).catch(() => "gone");
check("观众上报卡片闭环到已处置", closed === "resolved", closed);

check("大屏无应用层报错", app_errs(desk_errs).length === 0, JSON.stringify(app_errs(desk_errs)));
check("手机无应用层报错", app_errs(phone_errs).length === 0, JSON.stringify(app_errs(phone_errs)));

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
