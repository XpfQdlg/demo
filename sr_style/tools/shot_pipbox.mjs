/** 第一视角检测框验收：把一起事件挪到跟随设备正前方 12 米再截图 */
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
await new Promise((r)=>setTimeout(r,24000));

/* 造一起明火（alarm 级），位置放在 dog-1 前方 */
await page.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents[0];
  const a = window.__cine ? null : null;
  /* 拿第一台设备的像素坐标，往机头方向推 12 米 */
  const agent = (window.__agents || []).find(a => a.type === "dog");
  return null;
});

const ok = await page.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents.find(i => i.kind === "fire") || m.incidents[0];
  return !!inc;
});
console.log("incident:", ok);

/* 直接点设备列表第一行跟随 */
await page.evaluate(() => document.querySelector(".agent-row")?.click());
await new Promise((r)=>setTimeout(r,2500));

/* 把事件挪到设备正前方 12 米（像素坐标） */
const moved = await page.evaluate(() => {
  const m = window.__monitor;
  const inc = m.incidents.find(i => i.kind === "fire") || m.incidents[0];
  const rows = [...document.querySelectorAll(".agent-row")];
  const i = rows.findIndex(r => r.classList.contains("on"));
  /* 通过列表行拿到 agent 不方便，直接找场景里正在跟随的实体 */
  const follow = window.__cine.follow?.entity;
  if (!follow || !inc) return false;
  const heading = follow.heading || 0;
  const wx = follow.position.x + Math.sin(heading) * 12;
  const wz = follow.position.z + Math.cos(heading) * 12;
  /* 世界 → 像素：scale 是 1.0，原点在图幅中心 */
  const W = 1333, H = 1079;
  inc.px = [wx + W / 2, wz + H / 2];
  inc.status = "alarm";
  if (inc.prop) inc.prop.position.set(wx, m.floor_y, wz);
  return true;
});
console.log("moved:", moved);

await new Promise((r)=>setTimeout(r,3000));
await page.screenshot({ path: "shots/pipbox.png" });
const marks = await page.evaluate(() =>
  [...document.querySelectorAll(".pip-mark")].map(e => ({ d: e.style.display, t: e.textContent, box: e.getBoundingClientRect().x|0 }))
);
console.log("marks:", JSON.stringify(marks));
console.log("errors:", errs.slice(0,4));
await browser.close();
