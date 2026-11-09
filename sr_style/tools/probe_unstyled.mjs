import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1200,700"] });
const page = await browser.newPage();
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
const out = await page.evaluate(() => {
  const m = new Map();
  window.__cine.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat || mat.isMeshBasicMaterial) continue;
      if (mat.userData?.style_injected) continue;
      const k = `${mat.type}|map=${!!mat.map}|slug=${mat.userData?.slug||"-"}`;
      m.set(k, (m.get(k)||0)+1);
    }
  });
  return [...m.entries()];
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
