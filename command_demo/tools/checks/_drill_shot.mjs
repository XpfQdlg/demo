/* 自动演练：__drill() 立刻来一遍，检查会诊与出警 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=medium", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 24000));
console.log("scene before", await p.evaluate(() => document.querySelector(".tab.on")?.textContent));
await p.evaluate(() => window.__drill());
await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: "shots/drill_1.png" });
console.log(await p.evaluate(() => ({
  scene: document.querySelector(".tab.on")?.textContent,
  on: document.querySelector("#visitorToast")?.classList.contains("on"),
  kicker: document.querySelector(".v-kicker")?.textContent,
  title: document.querySelector("#visitorTitle")?.textContent,
})));
await new Promise((r) => setTimeout(r, 9000));
await p.screenshot({ path: "shots/drill_2.png" });
await b.close();
