/**
 * 大屏 → 本机总线 的验收。
 *
 *   node tools/checks/_alert_bus_probe.mjs            校园
 *   node tools/checks/_alert_bus_probe.mjs community  小区
 *
 * 验的是「监控层的每一步都被推到了总线」：
 *   报警 → 派单 → 到场 → 处置 → 完成，五条事件同 id、顺序正确；
 *   大屏发出去的数量与总线收到的一致；控制台无报错。
 *
 * 无头渲染只有几帧，报警计时靠直接推 monitor.tick()；
 * 到场后扫描/处置用的是墙钟（1.8s + 3.2s），正常等即可。
 * 到场直接从监控层内部调用 _arrive()，不依赖机器人走完 A* 路径。
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
const scene = process.argv[2] || "campus";

const api = (path, init) => fetch(BASE + path, init);
const reset = () => api("/api/alerts/reset", { method: "POST" });
const snapshot = () => api("/api/alerts/snapshot").then((r) => r.json());

await reset();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 240)));

await page.goto(`${BASE}/cinematic.html?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1800));

/* 推仿真时间到首起报警，等串行 POST 把 alarm / dispatched 送出去 */
const fired = await page.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 220; i++) m.tick(0.05);
  const inc = m.incidents.find((i) => i.fired);
  return inc ? { status: inc.status, area: inc.area, kind: inc.kind, has_agent: !!inc.by } : null;
});
if (!fired) {
  console.error("FAIL 报警没有触发");
  await browser.close();
  process.exit(1);
}
console.log("ALARM " + JSON.stringify(fired));
await new Promise((r) => setTimeout(r, 900));

/* 直接让执行体到场，走完扫描 1.8s → 处置 3.2s */
await page.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents.find((i) => i.fired);
  if (inc?.by) m._arrive(inc, inc.by);
});
/* 无头浏览器对非焦点页定时器有节流，扫描 1.8s + 处置 3.2s 实测会拖到 8~10s */
await new Promise((r) => setTimeout(r, 13000));

const stats = await page.evaluate(() => window.__alert_pub?.());
const snap = await snapshot();
const events = snap.events.map((e) => ({
  type: e.type,
  id: e.incident?.id,
  agent: e.agent?.name || null,
  distance: e.incident ? Math.round(e.distance_m || 0) : null,
  scene: e.scene,
}));

const seq = events.filter((e) => e.type !== "scene").map((e) => e.type);
const ids = [...new Set(events.filter((e) => e.id).map((e) => e.id))];
const ok =
  seq.join(",") === "alarm,dispatched,arrive,handling,resolved" &&
  ids.length === 1 &&
  stats?.failed === 0 &&
  errs.length === 0;

console.log("EVENTS " + JSON.stringify(events));
console.log("STATS " + JSON.stringify(stats));
console.log("ERRORS " + JSON.stringify(errs));
console.log(ok ? "PASS" : "FAIL");

await browser.close();
process.exit(ok ? 0 : 1);
