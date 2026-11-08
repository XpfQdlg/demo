import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1280,720"],
});
for (const sc of ["campus", "community", "forest", "subway"]) {
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push("ERR " + e.message));
  await p.goto(`http://localhost:5179/cinematic.html?scene=${sc}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 26000));
  const r = await p.evaluate(() => {
    const c = window.__cine;
    const out = { groups: [], meshes: 0 };
    c.scene.traverse((o) => {
      if (o.isMesh) out.meshes++;
      if (o.name === "robots") {
        out.groups.push({
          children: o.children.length,
          pos: o.children.map((k) => [
            +k.position.x.toFixed(1), +k.position.y.toFixed(1), +k.position.z.toFixed(1),
          ]),
        });
      }
    });
    return out;
  });
  console.log(sc, JSON.stringify(r).slice(0, 400), errs.slice(0, 2));
  await p.close();
}
await b.close();
