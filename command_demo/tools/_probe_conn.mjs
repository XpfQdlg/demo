/**
 * 西北连体楼整改的验收截图。
 *
 *   node tools/_probe_conn.mjs
 *
 * 两个机位：北区学生公寓（north_dorm 六段）、西侧公寓（west_dorm 七段）。
 * 相机参数与 _closeup.mjs 一致，直接改 __cine 的目标机位后截图。
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
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0, 160)));

await page.goto("http://localhost:5179/cinematic.html?scene=campus&q=medium", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 26000));

const views = [
  // 北区学生公寓：从东南方俯视，看六段之间的山墙缝
  { name: "conn_north", target: [-118, 8, -243], theta: 0.75, phi: 0.42, d: 210 },
  // 西侧公寓：从东侧平视，看七段是否还连成一堵墙
  { name: "conn_west", target: [-219, 6, -97], theta: 1.45, phi: 0.30, d: 190 },
];

for (const v of views) {
  await page.evaluate((v) => {
    const c = window.__cine;
    const T = window.__cine_three;
    c.theta = v.theta;
    c.phi = v.phi;
    c.distance = v.d;
    c.bind_orbit(new T.Vector3(v.target[0], v.target[1], v.target[2]));
  }, v);
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `shots/${v.name}.png` });
  console.log("SHOT:", v.name);
}

console.log("errors:", errs.slice(0, 3));
await browser.close();
