/**
 * 诊断：点屏幕上几个位置，看射线打到什么、离扫描中心多远、材质注入了没。
 *
 *   node tools/probe_scan_pick.mjs
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto("http://localhost:5180/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 26000));

await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => (window.__scan.radius = 30));
await new Promise((r) => setTimeout(r, 2000));

const pts = [
  [800, 210], // 环外（黄绿色带）
  [300, 260], // 环外左侧
  [800, 700], // 环内
  [800, 120], // 更远
];
const out = await page.evaluate((pts) => {
  const THREE = window.__cine_three;
  const cam = window.__cine.camera;
  const scene = window.__cine.scene;
  const ray = new THREE.Raycaster();
  const c = window.__scan.uniforms.u_scan_center.value;
  return pts.map(([x, y]) => {
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.visible);
    const h = hits[0];
    if (!h) return { x, y, hit: null };
    const mats = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
    return {
      x,
      y,
      obj: h.object.name || h.object.type,
      mat: mats.map((m) => m?.type).join(","),
      injected: mats.map((m) => !!m?.userData?.scan_injected).join(","),
      dist: +Math.hypot(h.point.x - c.x, h.point.z - c.z).toFixed(1),
      y3: +h.point.y.toFixed(2),
    };
  });
}, pts);

console.log(JSON.stringify(out, null, 2));
await browser.close();
