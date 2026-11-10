/**
 * 彩色残留巡检：遍历整棵 DOM，找出「计算样式里还有明显色相」的节点。
 * 判定：把 rgb 拆开，max-min > 10 就算有彩（灰阶阈值），并跳过 canvas/svg 内部与图片。
 *
 *   node tools/checks/_color_audit.mjs             # 四个 Tab + 六个浮层全扫
 *   node tools/checks/_color_audit.mjs alerts      # 只扫指定页
 *
 * 输出按「选择器路径 → 属性 → 颜色」列出，并统计条数。
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
await new Promise((r) => setTimeout(r, 4500));

async function audit(label) {
  const rows = await page.evaluate(() => {
    const chroma = (str) => {
      const m = String(str).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      const a = m[4] === undefined ? 1 : +m[4];
      if (a < 0.06) return null;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return mx - mn > 10 ? [r, g, b, a] : null;
    };
    const path = (el) => {
      const bits = [];
      let n = el;
      let depth = 0;
      while (n && n.nodeType === 1 && depth < 4) {
        const cls = (n.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        bits.unshift(n.tagName.toLowerCase() + (cls ? "." + cls : "") + (n.id ? "#" + n.id : ""));
        n = n.parentElement;
        depth += 1;
      }
      return bits.join(" > ");
    };
    const PROPS = [
      "color",
      "backgroundColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "outlineColor",
      "textDecorationColor",
      "fill",
      "stroke",
    ];
    const out = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (tag === "canvas" || tag === "img" || tag === "video" || tag === "path" || tag === "use") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) continue;
      for (const p of PROPS) {
        const v = s[p];
        const c = chroma(v);
        if (c) out.push({ el: path(el), prop: p, color: `rgb(${c[0]},${c[1]},${c[2]})`, a: c[3] });
      }
      /* 渐变色标里也可能藏彩 */
      if (s.backgroundImage && s.backgroundImage !== "none") {
        const hits = [...s.backgroundImage.matchAll(/rgba?\([\d.,\s]+\)/g)].map((m) => m[0]).filter((x) => chroma(x));
        if (hits.length) out.push({ el: path(el), prop: "backgroundImage", color: hits.slice(0, 2).join(" "), a: 1 });
      }
      if (s.boxShadow && s.boxShadow !== "none") {
        const hits = [...s.boxShadow.matchAll(/rgba?\([\d.,\s]+\)/g)].map((m) => m[0]).filter((x) => chroma(x));
        if (hits.length) out.push({ el: path(el), prop: "boxShadow", color: hits.slice(0, 2).join(" "), a: 1 });
      }
    }
    return out;
  });
  console.log(`\n== ${label} :: ${rows.length} 处 ==`);
  const seen = new Set();
  for (const r of rows) {
    const key = r.el + "|" + r.prop;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${r.prop.padEnd(18)} ${r.color.padEnd(26)} ${r.el}`);
  }
  return rows.length;
}

const only = process.argv[2];

if (!only || only === "all" || only === "alerts") await audit("alerts");
if (!only || only === "all" || only === "models") {
  await page.evaluate(() => document.querySelector('[data-tab="models"]')?.click());
  await new Promise((r) => setTimeout(r, 600));
  await audit("models");
}
if (!only || only === "all" || only === "join") {
  await page.evaluate(() => document.querySelector('[data-tab="join"]')?.click());
  await new Promise((r) => setTimeout(r, 600));
  await audit("join");
}
if (!only || only === "all" || only === "me") {
  await page.evaluate(() => document.querySelector('[data-tab="me"]')?.click());
  await new Promise((r) => setTimeout(r, 600));
  await audit("me");
}

if (!only || only === "all") {
  const ovs = [
    ["sheet", () => document.querySelector('[data-tab="alerts"]')?.click(), () => document.querySelector("#list .card")?.click()],
    ["models", null, () => document.getElementById("models-btn")?.click()],
    ["join", () => document.querySelector('[data-tab="join"]')?.click(), () => document.getElementById("entry-photo")?.click()],
    ["voice", () => document.querySelector('[data-tab="join"]')?.click(), () => document.getElementById("entry-voice")?.click()],
    ["ar", () => document.querySelector('[data-tab="join"]')?.click(), () => document.getElementById("entry-ar")?.click()],
    ["quiz", () => document.querySelector('[data-tab="join"]')?.click(), () => document.getElementById("entry-quiz")?.click()],
  ];
  for (const [name, pre, open] of ovs) {
    await page.evaluate(() => {
      for (const sel of ["#sheet-close", "#join-close", "#models-close"]) document.querySelector(sel)?.click();
      document.querySelector(".ar-backdrop")?.click();
    });
    await new Promise((r) => setTimeout(r, 350));
    if (pre) await page.evaluate(pre);
    await new Promise((r) => setTimeout(r, 350));
    await page.evaluate(open);
    await new Promise((r) => setTimeout(r, 900));
    await audit("overlay:" + name);
  }
}

await browser.close();
