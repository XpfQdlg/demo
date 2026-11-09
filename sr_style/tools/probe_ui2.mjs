import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,24000));

/* 连开三轮报警，凑齐三种等级的事件流 */
await page.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 3; i++) { m.timer = 0; m._advance(); }
});
await new Promise((r)=>setTimeout(r,5000));
await page.screenshot({ path: "shots/ui_feed.png" });
console.log(JSON.stringify(await page.evaluate(() => ({
  rows: [...document.querySelectorAll(".feed-row")].map(r => r.className + " | " + r.textContent.slice(0, 40)),
  pills: [...document.querySelectorAll(".pill")].map(e=>e.textContent),
})), null, 1));
console.log("errors:", errs.slice(0,4));
await browser.close();
