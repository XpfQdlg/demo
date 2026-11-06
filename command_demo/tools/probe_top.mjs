/**
 * 临时探针：把某场景的俯视快照存成 PNG，便于逐像素核对道路与建筑。
 * 用法：node tools/probe_top.mjs --scene=campus --out=shots/_top.png --px=1600
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=([\s\S]*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
await page.goto("http://localhost:5179/", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 4500));

const data = await page.evaluate((scene, hide) => {
  const entry = window.__app.world.ensure_scene(scene);
  const b = entry.built;
  if (hide) {
    const node = b.root.children.find((c) => c.name === hide || c.name === hide);
    if (node) node.visible = false;
  }
  const cv = window.__app.engine.snapshotTopDown({
    root: b.root,
    env: b.env,
    cx: b.extent.cx,
    cz: b.extent.cz,
    span: b.extent.span,
    px: 1200,
  });
  return cv.toDataURL("image/png");
}, args.scene || "campus", args.hide || null);

const buf = Buffer.from(data.split(",")[1], "base64");
fs.writeFileSync(args.out || "shots/_top.png", buf);
console.log("WROTE", args.out || "shots/_top.png", buf.length);
await browser.close();
