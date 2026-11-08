import fs from "node:fs";
import puppeteer from "puppeteer-core";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1400,900"] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 200)));
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
const scene = process.argv[2] || "campus";
await p.goto(`http://localhost:5179/cinematic.html?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, Number(process.argv[3] || 28000)));
const ok = await p.evaluate(() => ({
  monitor: !!window.__monitor,
  cameras: window.__monitor?.cameras.length ?? 0,
  agents: window.__monitor?.agents.length ?? 0,
  children: window.__cine?.scene.children.length ?? 0,
  hud: document.getElementById("hud")?.textContent?.slice(0, 60) || "",
}));
await p.screenshot({ path: `shots/map_${scene}.png` });
console.log(JSON.stringify(ok));
console.log("ERRORS " + JSON.stringify(errs.slice(0, 6)));
await b.close();
