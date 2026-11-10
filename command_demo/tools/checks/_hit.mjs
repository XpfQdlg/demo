/**
 * 点名的黑点定位器：在给点坐标上做 elementFromPoint，打印该元素及父链的 class / 文本 / 计算样式。
 *
 *   node tools/checks/_hit.mjs 290 55 752 862
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const pts = [];
for (let i = 2; i + 1 < process.argv.length; i += 2) pts.push([+process.argv[i], +process.argv[i + 1]]);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));

const res = await page.evaluate((points) => {
  const out = [];
  for (const [x, y] of points) {
    const el = document.elementFromPoint(x, y);
    if (!el) {
      out.push({ x, y, el: null });
      continue;
    }
    const s = getComputedStyle(el);
    const chain = [];
    let n = el;
    for (let i = 0; i < 4 && n; i += 1) {
      chain.push(`${n.tagName.toLowerCase()}.${(n.className || "").toString().trim().replace(/\s+/g, ".")}${n.id ? "#" + n.id : ""}`);
      n = n.parentElement;
    }
    out.push({
      x,
      y,
      chain,
      text: (el.textContent || "").trim().slice(0, 40),
      bg: s.backgroundColor,
      color: s.color,
      size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      opacity: s.opacity,
    });
  }
  return out;
}, pts);

console.log(JSON.stringify(res, null, 1));
await browser.close();
