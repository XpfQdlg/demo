/* 把某一个颜色对应的材质染红，看它在画面上的范围 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const hex = process.argv[2] || "0a1a24";
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=high&look=night", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 28000));
const n = await p.evaluate((hex) => {
  const c = window.__cine;
  let n = 0;
  c.scene.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    if (o.material.color?.getHexString?.() === hex) { o.material.color.set(0xff0000); n++; }
  });
  return n;
}, hex);
await new Promise((r) => setTimeout(r, 900));
await p.screenshot({ path: `shots/dye_${hex}.png` });
console.log("dyed", n, "meshes");
await b.close();
