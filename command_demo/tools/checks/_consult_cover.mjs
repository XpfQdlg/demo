/* 7 秒时到底是谁盖在中间 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const BASE = "http://127.0.0.1:5179";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto(`${BASE}/cinematic.html?scene=campus&q=low`, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(14000);
await fetch(`${BASE}/api/commands`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "visitor_report", scene: "campus", kind: "fire", confidence: 0.93, name: "明火", client_id: "dbg" }),
});
await sleep(13000);
const info = await p.evaluate(() => {
  const out = [];
  for (const n of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.02) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) continue;
    if (r.x > 1200 || r.x + r.width < 400) continue;
    out.push({
      tag: n.tagName, id: n.id, cls: n.className?.baseVal ?? n.className,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      z: cs.zIndex, pos: cs.position, txt: (n.textContent || "").trim().slice(0, 40),
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: "shots/consult_cover.png" });
await b.close();
