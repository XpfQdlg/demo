/**
 * 闪烁探针：隔一段时间连拍两帧，逐像素比对，看「抖」是全局的、局部的还是只发生在边缘。
 *
 *   node tools/checks/_flicker_probe.mjs [--scene=campus] [--gap=900] [--wait=24000]
 *
 * 输出：
 *   diffRatio        两张图的差异像素占比
 *   grid             20x12 网格里的差异密度（找出抖在哪一块）
 *   edgeRatio        差异像素中「落在明暗边缘」的比例（高＝抗锯齿/阴影噪点，
 *                    低＝整块面在变，比如曝光或雾在漂）
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : d;
};

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const scene = arg("scene", "campus");
const gap = Number(arg("gap", 900));
const wait = Number(arg("wait", 24000));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.goto(`http://localhost:5179/cinematic.html?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, wait));

const a = (await page.screenshot({ encoding: "base64" })).toString();
await new Promise((r) => setTimeout(r, gap));
const b = (await page.screenshot({ encoding: "base64" })).toString();

const out = await page.evaluate(async (a, b) => {
  const load = (data) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = "data:image/png;base64," + data;
    });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = ia.width;
  const h = ia.height;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.drawImage(ia, 0, 0);
  const da = x.getImageData(0, 0, w, h).data;
  x.clearRect(0, 0, w, h);
  x.drawImage(ib, 0, 0);
  const db = x.getImageData(0, 0, w, h).data;

  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const CELL = 80;
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  let diff = 0;
  let edge = 0;
  let maxd = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = (y * w + xx) * 4;
      const d = Math.max(
        Math.abs(da[i] - db[i]),
        Math.abs(da[i + 1] - db[i + 1]),
        Math.abs(da[i + 2] - db[i + 2]),
      );
      if (d > 6) {
        diff++;
        if (d > maxd) maxd = d;
        /* 该像素在第一帧里是不是明暗边缘（和右/下邻居亮度差大） */
        const l0 = luma(da, i);
        const l1 = luma(da, i + 8);
        const l2 = luma(da, i + w * 4);
        if (Math.abs(l0 - l1) > 14 || Math.abs(l0 - l2) > 14) edge++;
        grid[Math.floor(y / CELL)][Math.floor(xx / CELL)]++;
      }
    }
  }
  const total = (w - 2) * (h - 2);
  const perCell = CELL * CELL;
  return {
    size: `${w}x${h}`,
    diffRatio: +((diff / total) * 100).toFixed(2),
    edgeRatio: diff ? +((edge / diff) * 100).toFixed(1) : 0,
    maxDelta: maxd,
    grid: grid.map((r) => r.map((n) => +((n / perCell) * 100).toFixed(0))),
  };
}, a, b);

console.log(JSON.stringify(out, null, 1));
console.log("grid 每格为该区块内差异像素的百分比（0-100）");
for (const row of out.grid) console.log(row.map((n) => String(n).padStart(4)).join(""));

await browser.close();
