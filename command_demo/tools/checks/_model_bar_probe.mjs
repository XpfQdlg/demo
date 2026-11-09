/**
 * 大屏「四模型场景应用」验收：模型条、页签路由、场景本地化异常名。
 *
 *   node tools/checks/_model_bar_probe.mjs
 *
 * 验的是：
 *   1. 顶部模型条随页签切换（校园巡检 / 小区安防 / 地铁客运 / 森林火险）；
 *   2. 页签 tooltip 带模型名与定位；
 *   3. 切到地铁 / 森林后，监控层发出的异常名是场景本地化的
 *      （通道遗留物 / 火险烟雾），不再是大一统的「垃圾堆积 / 明火」；
 *   4. 事件流提示与告警事件总线同口径。
 *
 * 前置：dev server（npm run dev）、puppeteer-core、本机 Chrome/Edge。
 * 截屏：shots/model_bar_probe.png
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

const MODELS = {
  campus: { name: "校园巡检模型", short: "校园巡检", names: ["明火", "人员聚集", "垃圾堆积"] },
  community: { name: "小区安防模型", short: "小区安防", names: ["烟雾火灾", "出入口拥挤", "垃圾满溢"] },
  subway: { name: "地铁客运模型", short: "地铁客运", names: ["明火烟雾", "人员密度异常", "通道遗留物"] },
  forest: { name: "森林火险模型", short: "森林火险", names: ["火险烟雾", "人员活动异常", "林区垃圾"] },
};

await fetch(`${BASE}/api/alerts/reset`, { method: "POST" });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));

await page.goto(`${BASE}/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await sleep(800);

const read_ui = () =>
  page.evaluate(() => ({
    name: document.getElementById("modelName")?.textContent?.trim(),
    meta: document.getElementById("modelMeta")?.textContent?.trim(),
    feed: document.getElementById("feedHint")?.textContent?.trim(),
    accent: document.getElementById("modelBar")?.style.getPropertyValue("--model-accent"),
    titles: [...document.querySelectorAll("[data-scene]")].map((t) => t.title),
  }));

const campus = await read_ui();
check("首屏模型条 = 校园巡检模型", campus.name === MODELS.campus.name, JSON.stringify(campus));
check("模型条带覆盖说明", /覆盖校园|四模型接入/.test(campus.meta || ""), campus.meta);
check("四个页签都带模型 tooltip", campus.titles.every((t) => Object.values(MODELS).some((m) => t.includes(m.name))), JSON.stringify(campus.titles));

/* 逐个切页签，模型条与事件流提示同步 */
for (const scene of ["community", "subway", "forest"]) {
  await page.click(`.tab[data-scene="${scene}"]`);
  /* 森林场景在无头软件渲染下构建要十几秒（地形 + 树），给足时间 */
  await page.waitForFunction(
    (name) => document.getElementById("modelName")?.textContent?.trim() === name,
    { timeout: 90000 },
    MODELS[scene].name
  );
  const ui = await read_ui();
  check(`切到${MODELS[scene].name}，模型条跟随`, ui.name === MODELS[scene].name && ui.feed.includes(MODELS[scene].short), JSON.stringify(ui));
  check(`${MODELS[scene].name} 主题色不同`, !!ui.accent && ui.accent !== campus.accent, ui.accent);
}

/* 模型条在点击时就切了，场景还在重建；等监控层真正换成 forest 再推报警 */
await page.waitForFunction(
  () => window.__monitor && window.__monitor.scene === "forest" && window.__monitor.cameras.length > 0,
  { timeout: 90000 }
);
await sleep(600);

/* 森林页签推一起报警，事件名应是场景本地化口径 */
await fetch(`${BASE}/api/alerts/reset`, { method: "POST" });
await page.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 240; i++) m.tick(0.05);
});
await sleep(1600);
const snap = await fetch(`${BASE}/api/alerts/snapshot`).then((r) => r.json());
const alarm = snap.events.find((e) => e.type === "alarm");
check("森林报警名是「火险烟雾」口径之一", !!alarm && MODELS.forest.names.includes(alarm.incident?.name), JSON.stringify(alarm?.incident));
check("报警事件带森林场景与模型场景", alarm?.scene === "forest" && alarm?.incident?.scene === "forest");
check("控制台无应用层报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));

await page.screenshot({ path: "shots/model_bar_probe.png" });
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
