/** 报警联动 + 热区 + 第一视角检测框 验收 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0,200)));
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,24000));

/* 把仿真时间推快一点，让报警尽快出现 */
await page.evaluate(() => {
  const m = window.__monitor;
  if (m) { m.timer = 0; }
});
await new Promise((r)=>setTimeout(r,6000));

const st = await page.evaluate(() => {
  const m = window.__monitor;
  return {
    incidents: (m?.incidents || []).map(i => ({ kind: i.kind, name: i.name, status: i.status, area: i.area })),
    heat: !!window.__heat?.mesh.visible,
    feed: [...document.querySelectorAll(".feed-row")].slice(0,4).map(r => r.className + " | " + r.textContent),
  };
});
console.log(JSON.stringify(st, null, 1));

await page.screenshot({ path: "shots/events_overview.png" });

/* 跟到正在处置的那台设备上，看小窗检测框 */
const idx = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".agent-row")];
  const i = rows.findIndex(r => !r.textContent.includes("待命"));
  return i >= 0 ? i + 1 : 1;
});
await page.evaluate((i) => {
  const rows = [...document.querySelectorAll(".agent-row")];
  rows[i-1]?.click();
}, idx);
await new Promise((r)=>setTimeout(r,3000));
await page.screenshot({ path: "shots/events_follow.png" });
const marks = await page.evaluate(() => [...document.querySelectorAll(".pip-mark")].map(e => ({ d: e.style.display, t: e.textContent })));
console.log("marks:", JSON.stringify(marks));
console.log("errors:", errs.slice(0,5));
await browser.close();
