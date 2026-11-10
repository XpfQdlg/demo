/* 诊断：把可疑材质染成纯色，确认画面上那一大片浅色到底是谁 */
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
await new Promise((r) => setTimeout(r, 28000));
const info = await p.evaluate(() => {
  const c = window.__cine;
  const found = {};
  c.scene.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const hex = o.material.color?.getHexString?.();
    if (!hex) return;
    if (["24262a", "07131a", "1b1f25", "2a3b22", "101812"].includes(hex)) {
      found[hex] = (found[hex] || 0) + 1;
    }
  });
  return found;
});
console.log("materials", info);
/* 逐个染红，观察画面 */
const colors = ["24262a", "07131a", "1b1f25", "2a3b22"];
let i = 0;
for (const hex of colors) {
  await p.evaluate((hex) => {
    const c = window.__cine;
    c.scene.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      if (o.material.color?.getHexString?.() === hex) o.material.color.set(0xff0000);
    });
  }, hex);
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `shots/diag_${i}_${hex}.png` });
  i++;
}
await b.close();
