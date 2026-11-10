/* 光照对比：同一机位下改 sun/hemi/exposure，看哪一组最平衡 */
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
const variants = [
  { sun: 1.4, hemi: 0.9, exp: 1.0 },
  { sun: 1.8, hemi: 0.7, exp: 0.95 },
  { sun: 1.0, hemi: 1.1, exp: 1.1 },
];
let i = 0;
for (const v of variants) {
  await p.evaluate((v) => {
    const c = window.__cine;
    c.sun.intensity = v.sun;
    c.hemi.intensity = v.hemi;
    c.renderer.toneMappingExposure = v.exp;
  }, v);
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `shots/light_${i}.png` });
  i++;
}
await b.close();
