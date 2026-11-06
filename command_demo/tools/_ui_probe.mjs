/**
 * 讲解面板与点击派单的验收。
 *
 *   node tools/_ui_probe.mjs            校园
 *   node tools/_ui_probe.mjs community  小区
 *
 * 检查四件事：
 *   1. 左侧设备列表按当前场景渲染，条数与设备数一致
 *   2. 自动报警会在事件流里留下「发现 / 派单」两条
 *   3. 在画面上点一下地面，会派最近的空闲设备，并留下「手动派」记录
 *   4. 按 H 能把面板收起来
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const scene = process.argv[2] || "campus";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 160)));

await page.goto(`http://localhost:5179/cinematic.html?scene=${scene}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, {
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2500));

const read_ui = () =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll("#agentRows .agent-row")].map((r) => r.textContent.trim()),
    count: document.getElementById("agentCount")?.textContent,
    feed: [...document.querySelectorAll("#feedRows .feed-row")].map((r) => r.textContent.trim()),
    toast: document.getElementById("toast")?.textContent || "",
    agents: window.__monitor.agents.map((a) => ({ type: a.type, status: a.status })),
  }));

console.log("UI0 " + JSON.stringify(await read_ui()));

/* 自动报警：把仿真时间推过 9 秒 */
await page.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 220; i++) m.tick(0.05);
});
await new Promise((r) => setTimeout(r, 600));
console.log("UI1 " + JSON.stringify(await read_ui()));

/* 在画面上点两处地面（避开顶栏与左右面板） */
for (const [x, y] of [[820, 620], [1000, 430]]) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));
}
console.log("UI2 " + JSON.stringify(await read_ui()));

await page.screenshot({ path: `shots/ui_${scene}.png` });
console.log("SHOT ui");

/* 跟随一台空闲设备后再点地面：应该派它去，而不是派最近的另一台 */
await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 600));
await page.mouse.move(700, 560);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 700));
const followClick = await page.evaluate(() => ({
  feed: [...document.querySelectorAll("#feedRows .feed-row")].map((r) => r.textContent.trim()).slice(0, 1),
  toast: document.getElementById("toast")?.textContent || "",
}));
console.log("FOLLOW_CLICK " + JSON.stringify(followClick));

/* H 收起面板 */
await page.keyboard.press("KeyH");
await new Promise((r) => setTimeout(r, 600));
const clean = await page.evaluate(() => ({
  clean: document.body.classList.contains("clean"),
  agentsVisible: getComputedStyle(document.getElementById("agents")).display,
}));
console.log("CLEAN " + JSON.stringify(clean));
await page.screenshot({ path: `shots/ui_${scene}_clean.png` });

console.log("ERRORS " + JSON.stringify(errs.slice(0, 5)));
await browser.close();
