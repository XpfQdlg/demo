/**
 * 端到端验收：大屏真的报警 → 手机页真的收到并走完整条生命周期。
 *
 *   node tools/checks/_e2e_phone_probe.mjs
 *
 * 同一个无头浏览器开两个页面：
 *   1. 手机视口打开 mobile.html，等它连上 5179 的总线；
 *   2. 桌面视口打开 cinematic.html，直接推 monitor.tick 触发首起报警；
 *   3. 检查手机卡片出现、区域/设备与桌面事件一致；
 *   4. 让执行体到场，等扫描 1.8s + 处置 3.2s，手机卡片应变成「已处置」。
 *
 * 前置：dev server（npm run dev）与 puppeteer-core、本机 Chrome/Edge。
 * 截图：shots/e2e_phone_alarm.png / shots/e2e_phone_resolved.png
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

/* ── 手机页 ──────────────────────────────────────────────────────────── */
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const phone_errs = [];
phone.on("pageerror", (e) => phone_errs.push("pageerror: " + e.message));
phone.on("console", (m) => m.type() === "error" && phone_errs.push("console: " + m.text().slice(0, 200)));
await phone.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await phone.waitForSelector('#conn[data-mode="live"]', { timeout: 8000 }).catch(() => {});
check("手机页连上实时总线", await phone.$eval("#conn", (el) => el.dataset.mode === "live"));

/* ── 大屏页 ──────────────────────────────────────────────────────────── */
const desk = await browser.newPage();
await desk.setViewport({ width: 1600, height: 900 });
const desk_errs = [];
desk.on("pageerror", (e) => desk_errs.push("pageerror: " + e.message));
desk.on("console", (m) => m.type() === "error" && desk_errs.push("console: " + m.text().slice(0, 200)));
await desk.goto(`${BASE}/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await desk.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await sleep(1500);

const alarm = await desk.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 220; i++) m.tick(0.05);
  const inc = m.incidents.find((i) => i.fired);
  return inc ? { area: inc.area, kind: inc.kind, status: inc.status, agent: inc.by?.type || null } : null;
});
check("大屏触发报警", !!alarm, JSON.stringify(alarm));

/* 等手机收到报警：事件是串行 POST，给一点余量 */
await phone.waitForSelector(".card", { timeout: 8000 }).catch(() => {});
/* 新 UI 渲染更重、总线串行 POST 也可能慢半拍：等状态离开 pending 再断言 */
for (let i = 0; i < 12; i++) {
  const status = await phone.$eval(".card", (n) => n.dataset.status).catch(() => "pending");
  if (status && status !== "pending") break;
  await sleep(500);
}
const on_phone = await phone.$$eval(".card", (nodes) =>
  nodes.map((n) => ({
    id: n.dataset.id,
    status: n.dataset.status,
    area: n.querySelector(".card-area")?.textContent.trim(),
    pill: n.querySelector(".pill")?.textContent.trim(),
    statusline: n.querySelector(".card-statusline")?.textContent.trim(),
  }))
);
/* 总线是共享的：别的验收/别的手机可能同时在写，列表里不一定只有这一条。
   按大屏报出的区域找到「我们这条」即可，不要求列表只有一张卡。 */
const mine = on_phone.find((c) => c.area === alarm?.area);
check("手机收到同一处预警", !!mine && mine.area === alarm?.area, JSON.stringify(on_phone));
check("手机已显示派单状态", ["dispatched", "on_site", "handling"].includes(mine?.status), mine?.status);
check("派单信息来自真实调度", /dog-|person-/.test(mine?.statusline || ""), mine?.statusline);
const card_model = await phone
  .$eval(`.card[data-id="${mine.id}"] .card-model`, (el) => el.textContent.replace(/\s+/g, " ").trim())
  .catch(() => "");
check("手机卡片带场景模型署名", card_model.includes("校园巡检模型") && /\d+%/.test(card_model), card_model);
await phone.screenshot({ path: "shots/e2e_phone_alarm.png" });

/* ── 让执行体到场，等完扫描与处置 ──────────────────────────────────────
   大屏的 1.8s + 3.2s 是墙钟定时器；无头浏览器对非焦点页的定时器有节流，
   实测会慢到 7~8 秒，所以这里等 10 秒，真机前台会准时很多。 */
const alert_id = mine.id;
await desk.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents.find((i) => i.fired);
  if (inc?.by) m._arrive(inc, inc.by);
});
await sleep(10000);

const target = await phone
  .$eval(`.card[data-id="${alert_id}"]`, (n) => ({
    id: n.dataset.id,
    status: n.dataset.status,
    pill: n.querySelector(".pill")?.textContent.trim(),
  }))
  .catch(() => null);
const stats = await phone.evaluate(() => ({
  pending: document.getElementById("stat-pending")?.textContent.trim(),
  handling: document.getElementById("stat-handling")?.textContent.trim(),
  resolved: document.getElementById("stat-resolved")?.textContent.trim(),
}));
check("手机卡片闭环到已处置", target?.status === "resolved", JSON.stringify(target));
check("手机统计同步刷新", Number(stats.resolved) >= 1, JSON.stringify(stats));
check("大屏控制台无报错", app_errs(desk_errs).length === 0, JSON.stringify(app_errs(desk_errs)));
check("手机控制台无报错", app_errs(phone_errs).length === 0, JSON.stringify(app_errs(phone_errs)));
await phone.screenshot({ path: "shots/e2e_phone_resolved.png" });

await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
