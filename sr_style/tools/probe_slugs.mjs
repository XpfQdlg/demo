import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1200,700"] });
const page = await browser.newPage();
const scene = process.argv[2] || "subway";
await page.goto(`http://localhost:5181/cinematic.html?scene=${scene}&style=0`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
const out = await page.evaluate(() => {
  const m = new Map();
  window.__cine.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      const slug = mat.userData?.slug || mat.type;
      const rec = m.get(slug) || { n: 0, ymin: 1e9, ymax: -1e9, color: "#" + (mat.color?.getHexString?.() || "?") };
      rec.n++;
      if (o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) { rec.ymin = Math.min(rec.ymin, b.min.y); rec.ymax = Math.max(rec.ymax, b.max.y); }
      }
      m.set(slug, rec);
    }
  });
  return [...m.entries()].map(([k, v]) => [k, v.n, +v.ymin.toFixed(1), +v.ymax.toFixed(1), v.color]);
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
