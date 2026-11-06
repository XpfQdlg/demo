/**
 * 观感版性能体检：数网格、三角形、材质、纹理数量。
 *
 *   node tools/perf.mjs            两个场景都测
 *   node tools/perf.mjs community  只测小区
 *
 * 无头环境是软件渲染，脚本不报帧率（那是 swiftshader 的数字，没有参考价值）。
 * 这里看的是结构性指标：网格数与绘制调用。
 * 三千个网格就是三千次调用，显卡再好也卡——这类问题只能靠合并几何解决。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1280,720"],
});
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });

const scenes = process.argv[2] ? [process.argv[2]] : ["plaza", "community"];

for (const sc of scenes) {
  await p.goto(`http://localhost:5179/cinematic.html?scene=${sc}`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 24000));

  const info = await p.evaluate(() => {
    const cine = window.__cine;
    const r = cine.renderer;
    let meshes = 0, tris = 0, mats = new Set(), geos = new Set();
    cine.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      geos.add(o.geometry.uuid);
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => m && mats.add(m.uuid));
      const g = o.geometry;
      if (g.index) tris += g.index.count / 3;
      else if (g.attributes.position) tris += g.attributes.position.count / 3;
    });
    return {
      meshes,
      geometries: geos.size,
      materials: mats.size,
      triangles: Math.round(tris),
      drawCalls: r.info.render.calls,
      programs: r.info.programs?.length ?? 0,
      textures: r.info.memory.textures,
      pixelRatio: r.getPixelRatio(),
      passes: cine.composer.passes.length,
    };
  });
  console.log(sc, JSON.stringify(info, null, 1));
}
await b.close();
