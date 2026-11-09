/** 派单后跟随时看导航线：node tools/shot_route.mjs campus */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));

/* 点地面派单，找一台正在走的设备跟上去 */
await page.mouse.click(900, 620);
await new Promise((r)=>setTimeout(r,1500));
const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".agent-row")];
  return rows.map(r => r.textContent);
});
console.log("rows:", JSON.stringify(info));

/* 找到第一台状态不是待命的设备序号 */
const idx = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".agent-row")];
  const i = rows.findIndex(r => !r.textContent.includes("待命"));
  return i >= 0 ? i + 1 : 1;
});
console.log("follow:", idx);
await page.keyboard.press("Digit" + idx);
await page.evaluate(()=>{ window.__scan.radius = 30; });
await new Promise((r)=>setTimeout(r,3000));
await page.screenshot({ path: "shots/route_campus.png" });
const st = await page.evaluate(() => ({
  has_route: !!window.__route_line.mesh.visible,
  quads: window.__route_line.count,
  follow: window.__cine.follow ? true : false,
}));
console.log("route:", JSON.stringify(st));
console.log("errors:", errs.slice(0,4));
await browser.close();
