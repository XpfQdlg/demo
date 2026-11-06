import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const scene = process.argv[2] || "community";
const views = JSON.parse(process.argv[3] || "[]");
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push("ERR " + e.message));
await p.goto(`http://localhost:5179/cinematic.html?scene=${scene}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 26000));
let i = 0;
for (const v of views) {
  const r = await p.evaluate((v) => {
    const c = window.__cine;
    c.theta = v.theta; c.phi = v.phi; c.distance = v.d;
    if (v.target) c.bind_orbit(new window.__cine_three.Vector3(v.target[0], v.target[1] || 2, v.target[2]));
    /* 把镜头对准最近的设备，方便看清造型 */
    let best = null;
    if (v.nearRobots) {
      c.scene.traverse((o) => {
        if (o.name === "robots" && o.children.length && !best) best = o.children[0].position.clone();
      });
      if (best) c.bind_orbit(new window.__cine_three.Vector3(best.x, 1.0, best.z));
    }
    return best ? [best.x, best.z] : null;
  }, v);
  await new Promise((r) => setTimeout(r, 1600));
  await p.screenshot({ path: `shots/close_${scene}_${i}.png` });
  console.log("shot", scene, i, JSON.stringify(r));
  i++;
}
console.log("errors:", errs.slice(0, 3));
await b.close();
