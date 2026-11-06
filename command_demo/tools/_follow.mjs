/**
 * 设备跟随验收：按 1 跟第一台设备，截图看主画面与小窗。
 *
 *   node tools/_follow.mjs
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0, 200)));

await page.goto("http://localhost:5179/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 30000));

await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "shots/follow_1.png" });

const state = await page.evaluate(() => ({
  follow: !!window.__cine.follow,
  mode: window.__cine.follow?.mode,
  pip: document.getElementById("pipbox").classList.contains("on"),
  who: document.getElementById("pipwho").textContent,
}));
console.log("STATE:", JSON.stringify(state));

await page.keyboard.press("Digit2");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "shots/follow_2.png" });

await page.keyboard.press("KeyG");
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "shots/follow_overview.png" });

console.log("errors:", errs.slice(0, 4));
await browser.close();
