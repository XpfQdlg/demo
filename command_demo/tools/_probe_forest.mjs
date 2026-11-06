import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1280,720"],
});
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("ERR " + e.message));
await p.goto("http://localhost:5179/cinematic.html?scene=forest", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 26000));
const r = await p.evaluate(() => {
  const c = window.__cine;
  const out = { instanced: [], hills: [], meshes: 0 };
  c.scene.traverse((o) => {
    if (o.isInstancedMesh) out.instanced.push({ n: o.name || o.type, count: o.count });
    if (o.isMesh) {
      out.meshes++;
      if ((o.name || "").startsWith("hill")) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        out.hills.push({
          n: o.name,
          pos: [o.position.x.toFixed(0), o.position.y.toFixed(0), o.position.z.toFixed(0)],
          y: [bb.min.y.toFixed(1), bb.max.y.toFixed(1)],
        });
      }
    }
  });
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log("errors:", errs.slice(0, 3));
await b.close();
