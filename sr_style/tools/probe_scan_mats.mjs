/**
 * 诊断：场景里有多少材质没被注入扫描半径场。
 *
 *   node tools/probe_scan_mats.mjs
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));

await page.goto("http://localhost:5180/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 26000));

const out = await page.evaluate(() => {
  const scene = window.__cine.scene;
  const missing = new Map();
  let meshes = 0;
  let injected = 0;
  scene.traverse((o) => {
    if (!o.isMesh || o.isSprite) return;
    meshes++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.userData?.scan_injected) injected++;
      else {
        const k = `${m.type} | ${m.name || o.name || "?"}`;
        missing.set(k, (missing.get(k) || 0) + 1);
      }
    }
  });
  return { meshes, injected, missing: [...missing.entries()].slice(0, 20) };
});

console.log(JSON.stringify(out, null, 2));
console.log("errors:", errs.slice(0, 4));
await browser.close();
