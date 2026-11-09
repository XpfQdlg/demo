/** 不渲染，直接推进仿真，看设备最终停在离事发点多远 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1200,700"] });
const page = await browser.newPage();
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,24000));
await page.evaluate(() => { if (window.__monitor) window.__monitor.timer = 0; });
await new Promise((r)=>setTimeout(r,3000));

/* 纯推进仿真：每步 0.05 秒，跑 1200 步 = 60 秒 */
const out = await page.evaluate(() => {
  const cine = window.__cine;
  const m = window.__monitor;
  let t = 100;
  const snap = [];
  for (let i = 0; i < 1200; i++) {
    t += 0.05;
    for (const fn of cine.updaters) fn(0.05, t);
    cine.onFrame(0.05, t);
    if (i % 200 === 0) {
      const inc = m.incidents.find(x => x.status !== "wait" && x.status !== "done");
      const a = inc?.by;
      snap.push({
        step: i,
        status: inc?.status,
        dist: a ? +Math.hypot(a.x - inc.px[0], a.y - inc.px[1]).toFixed(1) : null,
        agent_status: a?.status,
        route_idx: a?.route_idx,
        route_len: a?.route?.length ?? null,
      });
    }
  }
  return snap;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
