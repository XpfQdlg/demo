/**
 * 验收：切场景之后扫描层还能画出来。
 *
 * 扫描层挂在场景根节点上，切场景时整棵树会被遍历 dispose 几何体，
 * 如果没先摘出来，第二个场景里扫描圈会消失。
 *
 *   node tools/check_scene_switch.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync("shots", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0, 200)));

await page.goto("http://localhost:5180/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 26000));

/* 默认三个场景跑一遍；命令行给了场景名就只跑那几个 */
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ["forest", "subway", "campus"];

for (const scene of scenes) {
  await page.evaluate((s) => {
    document.querySelector(`[data-scene="${s}"]`)?.click();
  }, scene);
  await new Promise((r) => setTimeout(r, 22000));

  await page.keyboard.press("Digit1");
  await page.waitForFunction(() => !!window.__scan?.on, { timeout: 20000 });
  await page.evaluate(() => (window.__scan.radius = 26));
  await new Promise((r) => setTimeout(r, 2500));

  const st = await page.evaluate(() => ({
    scene: window.__cine.scene.children.length,
    parent: window.__scan.overlay.parent?.type || null,
    vis: window.__scan.overlay.visible,
    geo_ok: !!window.__scan.overlay.geometry?.attributes?.position,
    agents: window.__cine.scene.children.length,
  }));
  console.log(scene, JSON.stringify(st));
  await page.screenshot({ path: `shots/switch_${scene}.png` });

  await page.keyboard.press("KeyG");
  await new Promise((r) => setTimeout(r, 1500));
}

console.log("errors:", errs.slice(0, 6));
await browser.close();
