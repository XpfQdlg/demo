/* 量一下会诊面板实际几何 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=low", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 12000));
await p.evaluate(() => {
  const t = document.getElementById("visitorToast");
  t.classList.add("on");
  document.querySelectorAll("#visitorRows .v-row").forEach((n, i) => setTimeout(() => n.classList.add("on"), i * 50));
});
await new Promise((r) => setTimeout(r, 1200));
const info = await p.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { sel, x: r.x, y: r.y, w: r.width, h: r.height, display: cs.display, position: cs.position, transform: cs.transform, margin: cs.margin };
  };
  return {
    dpr: window.devicePixelRatio,
    vw: innerWidth,
    vh: innerHeight,
    stage: box("#stage"),
    toast: box("#visitorToast"),
    wrap: box("#visitorToast .v-wrap"),
    head: box("#visitorToast .v-head"),
    rows: box("#visitorToast .v-rows"),
    row: box("#visitorToast .v-row"),
    verdict: box("#visitorToast .v-verdict"),
    canvas: box("canvas"),
    html: document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight,
    body: document.body.scrollWidth + "x" + document.body.scrollHeight,
  };
});
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: "shots/consult_debug.png" });
await b.close();
