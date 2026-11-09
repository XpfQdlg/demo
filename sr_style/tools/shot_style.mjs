/**
 * SR 风格化截图。用法：
 *   node tools/shot_style.mjs subway        # 风格化
 *   node tools/shot_style.mjs subway 0      # 关掉风格化做对比
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
fs.mkdirSync("shots", { recursive: true });
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0,200)));
const scene = process.argv[2] || "subway";
const on = process.argv[3] !== "0";
const tag = on ? "style" : "plain";
await page.goto(`http://localhost:5181/cinematic.html?scene=${scene}${on ? "" : "&style=0"}`,
  { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,28000));
await page.screenshot({ path: `shots/${tag}_${scene}_overview.png` });

/* 中景：把机位拉近、俯角放低，用来看道路标线与建筑关系 */
await page.evaluate(() => {
  const c = window.__cine;
  if (c.distance) c.distance = c.distance * 0.45;
  c.phi = Math.min(0.95, (c.phi || 0.9) * 0.85);
});
await new Promise((r)=>setTimeout(r,3500));
await page.screenshot({ path: `shots/${tag}_${scene}_mid.png` });

await page.keyboard.press("Digit1");
await page.waitForFunction(()=>!!window.__scan?.on,{timeout:20000});
await page.evaluate(()=>{window.__scan.radius=22;});
await new Promise((r)=>setTimeout(r,3000));
await page.screenshot({ path: `shots/${tag}_${scene}_follow.png` });
console.log("errors:", errs.slice(0,6));
await browser.close();
