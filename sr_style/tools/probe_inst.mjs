import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1200,700"] });
const page = await browser.newPage();
await page.goto(`http://localhost:5181/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
const out = await page.evaluate(() => {
  const res = [];
  window.__cine.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const m = o.material;
    res.push({
      count: o.count,
      type: m?.type,
      slug: m?.userData?.slug || null,
      color: m?.color ? "#" + m.color.getHexString() : null,
      transparent: m?.transparent,
      opacity: m?.opacity,
      alphaTest: m?.alphaTest,
      side: m?.side,
      hasMap: !!m?.map,
      injected: !!m?.userData?.scan_injected,
      geo: o.geometry?.attributes?.position?.count,
    });
  });
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
