/* 夜景取景检查：默认机位 + 若干手动机位，顺带收集报错 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const scene = process.argv[2] || "campus";
const views = JSON.parse(process.argv[3] || "[]");
const look = process.argv[4] || "dusk";
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push("ERR " + e.message));
p.on("console", (m) => {
  if (m.type() === "error") errs.push("CONSOLE " + m.text().slice(0, 300));
});
await p.goto(`http://localhost:5179/cinematic.html?scene=${scene}&q=high&look=${look}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 30000));
await p.screenshot({ path: `shots/${look}_${scene}_default.png` });

let i = 0;
for (const v of views) {
  await p.evaluate((v) => {
    const c = window.__cine;
    if (v.theta !== undefined) c.theta = v.theta;
    if (v.phi !== undefined) c.phi = v.phi;
    if (v.d) c.distance = v.d;
    if (v.target) c.bind_orbit(new window.__cine_three.Vector3(v.target[0], v.target[1] || 2, v.target[2]));
  }, v);
  await new Promise((r) => setTimeout(r, 1800));
  await p.screenshot({ path: `shots/night_${scene}_${i}.png` });
  console.log("shot", scene, i);
  i++;
}
console.log("errors:", errs.slice(0, 6));
await b.close();
