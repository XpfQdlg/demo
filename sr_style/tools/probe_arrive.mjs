/** 量一下「到场」时设备离事发点到底多远 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1200,700"] });
const page = await browser.newPage();
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,24000));
/* 推快一点 */
await page.evaluate(() => { if (window.__monitor) window.__monitor.timer = 0; });
await new Promise((r)=>setTimeout(r,9000));

const out = await page.evaluate(() => {
  const m = window.__monitor;
  return (m?.incidents || []).map(inc => {
    const a = inc.by;
    if (!a) return { kind: inc.kind, status: inc.status, agent: null };
    return {
      kind: inc.kind,
      status: inc.status,
      agent: a.type,
      dist_m: +Math.hypot(a.x - inc.px[0], a.y - inc.px[1]).toFixed(1),
      route_end: a.route ? +Math.hypot(a.route.at(-1)[0] - inc.px[0], a.route.at(-1)[1] - inc.px[1]).toFixed(1) : null,
    };
  });
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
