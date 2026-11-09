import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`http://localhost:5181/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
/* 把机位调到与截图一致的中景 */
await page.evaluate(() => { const c = window.__cine; c.distance = c.distance * 0.45; c.phi = Math.min(0.95, (c.phi||0.9)*0.85); });
await new Promise((r)=>setTimeout(r,3500));
const pts = [[900,340],[560,520],[1240,430],[400,780]];
const out = await page.evaluate((pts) => {
  const THREE = window.__cine_three;
  const cam = window.__cine.camera;
  const scene = window.__cine.scene;
  const ray = new THREE.Raycaster();
  return pts.map(([x,y]) => {
    const ndc = new THREE.Vector2((x/innerWidth)*2-1, -(y/innerHeight)*2+1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(scene.children, true).filter(h => h.object.visible && h.object.type !== "Sprite");
    const h = hits[0];
    if (!h) return {x,y,hit:null};
    const m = h.object.material;
    return { x, y, objName: h.object.name || h.object.type, matType: m?.type,
      slug: m?.userData?.slug || null, color: m?.color ? "#"+m.color.getHexString() : null,
      map: !!m?.map, tree: !!m?.userData?.tree, opacity: m?.opacity };
  });
}, pts);
console.log(JSON.stringify(out, null, 1));
await browser.close();
