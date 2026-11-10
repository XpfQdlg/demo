import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=high&look=night", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 26000));
const out = await p.evaluate(() => {
  const c = window.__cine;
  const T = window.__cine_three;
  const rc = new T.Raycaster();
  const res = [];
  for (const [px, py] of [[1300, 620], [1390, 580], [1250, 700], [1200, 640]]) {
    const ndc = new T.Vector2((px / 1600) * 2 - 1, -(py / 900) * 2 + 1);
    rc.setFromCamera(ndc, c.camera);
    const hits = rc.intersectObjects(c.scene.children, true).filter((h) => h.object.isMesh).slice(0, 3);
    res.push({
      px, py,
      hits: hits.map((h) => ({
        name: h.object.name,
        mat: h.object.material?.type,
        color: h.object.material?.color?.getHexString?.(),
        map: !!h.object.material?.map,
        y: +h.point.y.toFixed(2),
        pos: h.object.position.toArray().map((v) => +v.toFixed(1)),
      })),
    });
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
