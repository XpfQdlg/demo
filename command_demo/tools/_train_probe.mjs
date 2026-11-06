import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1200,700"] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 700 });
const errs = [];
p.on("pageerror", e => errs.push("ERR " + e.message));
await p.goto("http://localhost:5179/cinematic.html?scene=subway", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise(r => setTimeout(r, 26000));
const a = await p.evaluate(() => ({ updaters: window.__cine.updaters.length, time: window.__cine.time }));
await new Promise(r => setTimeout(r, 3000));
const c = await p.evaluate(() => ({ updaters: window.__cine.updaters.length, time: window.__cine.time }));
console.log("t1", JSON.stringify(a), "t2", JSON.stringify(c));
await p.screenshot({ path: "shots/train_probe.png" });
console.log("errors", errs.slice(0,3));
await b.close();
