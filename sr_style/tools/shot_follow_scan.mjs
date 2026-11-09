/** 跟随时扫描建图的验收截图：node tools/shot_follow_scan.mjs <场景> <设备序号> */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
fs.mkdirSync("shots", { recursive: true });
const scene = process.argv[2] || "campus";
const n = process.argv[3] || "3";
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
await page.goto(`http://localhost:5181/cinematic.html?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
await page.keyboard.press("Digit" + n);
await page.waitForFunction(()=>!!window.__scan?.on,{timeout:20000});
for (const r of [10, 22, 40]) {
  await page.evaluate((rr)=>{ window.__scan.radius = rr; }, r);
  await new Promise((res)=>setTimeout(res,2600));
  await page.screenshot({ path: `shots/scan_${scene}_${n}_${r}.png` });
}
console.log("errors:", errs.slice(0,4));
await browser.close();
