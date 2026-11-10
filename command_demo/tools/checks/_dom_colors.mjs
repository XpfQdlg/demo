/**
 * 逐个抓几个「颜色漏网」节点的 outerHTML + 关键计算样式，用来定位主题没盖住的地方。
 *
 *   node tools/checks/_dom_colors.mjs
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));

/* 打开预警详情 */
await page.evaluate(() => document.querySelector("#list .card")?.click());
await new Promise((r) => setTimeout(r, 800));

const info = await page.evaluate(() => {
  const out = {};
  const cs = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = s[p];
    return o;
  };
  const pick = (sel, props) => {
    const el = document.querySelector(sel);
    return { html: el ? el.outerHTML.slice(0, 300) : null, css: cs(el, props) };
  };
  const P = ["background-color", "background-image", "border-color", "color", "box-shadow"];
  out.infoCell = pick(".sheet .info-cell", P);
  out.chipMain = pick(".model-chip.is-main, .model-chip", P);
  out.chipTag = pick(".model-chip-tag, .model-chip .tag", P);
  out.chainStep = pick(".chain-step", P);
  out.btnClose = pick(".sheet .btn-close", [...P, "border-width", "outline"]);
  out.sheetFoot = pick(".sheet-foot", P);
  out.sheetPanel = pick(".sheet-panel", P);
  out.analysisBar = pick(".analysis-bar", P);
  return out;
});

console.log(JSON.stringify(info, null, 1));

/* 关掉抽屉，看参与浮层里的场景卡 */
await page.evaluate(() => document.querySelector("#sheet .btn-close")?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector('[data-tab="join"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.getElementById("entry-photo")?.click());
await new Promise((r) => setTimeout(r, 1000));

const join = await page.evaluate(() => {
  const P = ["background-color", "background-image", "border-color", "color", "border-radius"];
  const cs = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o = {};
    for (const p of P) o[p] = s[p];
    return o;
  };
  const one = (sel) => {
    const el = document.querySelector(sel);
    return { html: el ? el.outerHTML.slice(0, 320) : null, css: cs(el) };
  };
  return {
    kicker: one(".join-panel .join-kicker"),
    head: one(".join-panel .join-head"),
    closeBtn: one(".join-panel .icon-btn"),
    scene: one(".join-panel .join-scene"),
    sceneOn: one(".join-panel .join-scene.is-on"),
    sceneDot: one(".join-panel .join-scene .dot, .join-panel .join-scene i"),
    analyze: one(".join-panel .join-analyze"),
  };
});

console.log(JSON.stringify(join, null, 1));

await browser.close();
