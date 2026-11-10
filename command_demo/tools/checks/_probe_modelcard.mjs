/**
 * 抓模型总览浮层里 .model-card 的计算样式（颜色/背景/边框），定位为什么还是深底浅字。
 *
 *   node tools/checks/_probe_modelcard.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => document.getElementById("models-btn")?.click());
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(() => {
  const P = ["color", "background-color", "background-image", "border-color", "border-radius", "box-shadow"];
  const cs = (el) => {
    const s = getComputedStyle(el);
    const o = {};
    for (const p of P) o[p] = s[p];
    return o;
  };
  const first = document.querySelector(".model-card");
  const res = {
    panel: cs(document.querySelector(".models-panel")),
    grid: cs(document.querySelector(".models-grid")),
    card: first ? cs(first) : null,
    cardHTML: first ? first.outerHTML.slice(0, 400) : null,
  };
  if (first) {
    for (const sel of [".model-card-head", ".model-card-dot", ".model-card-name", ".model-card-current", ".model-card-tagline", ".model-card-coverage", ".model-card-caps li", ".model-card-demo", ".model-demo-label", ".model-demo-list", ".model-today", ".model-today-num"]) {
      const el = first.querySelector(sel);
      res[sel] = el
        ? { text: (el.textContent || "").trim().slice(0, 24), css: cs(el), inline: el.getAttribute("style") }
        : null;
    }
    res.pseudoBefore = getComputedStyle(first, "::before").background;
    res.pseudoColor = getComputedStyle(first, "::before").backgroundColor;
  }
  return res;
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
