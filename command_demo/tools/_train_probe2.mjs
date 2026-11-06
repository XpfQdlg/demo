import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1200,700"] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 700 });
await p.goto("http://localhost:5179/cinematic.html?scene=subway", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise(r => setTimeout(r, 26000));
for (const t of [3, 11, 19]) {
  await p.evaluate((t) => { window.__cine.time = t; }, t);
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: `shots/train_t${t}.png` });
  const info = await p.evaluate(() => window.__cine.scene.children.find(o => o.name === "subway") ? "subway-ok" : "no-root");
  console.log("t", t, info);
}
await b.close();
