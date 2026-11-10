/**
 * 大屏探针：打印指定选择器的计算样式（颜色/背景/字体/透明度），用来定位「文字看不见」的问题。
 *
 *   node tools/checks/_probe_big.mjs "#tip" "#feed"
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sels = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const list = sels.length
  ? sels
  : ["#tip", "#tip b", "#credit", "#feed", "#feed .panel-h", "#feedHint", "#agents", ".agent-row .name", ".panel-h"];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto("http://localhost:5179/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 20000));

const out = await page.evaluate((list) => {
  const PROPS = [
    "color",
    "backgroundColor",
    "opacity",
    "textShadow",
    "mixBlendMode",
    "filter",
    "fontSize",
    "fontWeight",
    "zIndex",
    "position",
    "visibility",
    "display",
  ];
  const res = [];
  for (const sel of list) {
    const el = document.querySelector(sel);
    if (!el) {
      res.push({ sel, missing: true });
      continue;
    }
    const s = getComputedStyle(el);
    const o = { sel, text: (el.textContent || "").trim().slice(0, 30) };
    for (const p of PROPS) o[p] = s[p];
    const r = el.getBoundingClientRect();
    o.box = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    res.push(o);
  }
  /* 谁压在 #tip 上面 */
  const tip = document.querySelector("#tip");
  if (tip) {
    const r = tip.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + 8, r.y + r.height / 2);
    res.push({ topmostAtTip: hit ? hit.tagName + "#" + hit.id + "." + (hit.className || "") : null });
  }
  return res;
}, list);

console.log(JSON.stringify(out, null, 1));
await browser.close();
