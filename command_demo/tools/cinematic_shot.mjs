/**
 * 观感版预览页的截图验收。
 *
 *   node tools/cinematic_shot.mjs                    两个场景各一张
 *   node tools/cinematic_shot.mjs --scene=community  只拍小区
 *
 * 注意：材质要先预载完才建场景，一共四百多张贴图，
 * 无头环境下要等 20 秒以上。等的时间短了会拍到空场景。
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
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const scenes = args.scene ? [args.scene] : ["plaza", "community"];
const wait = Number(args.wait || 26000);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});

for (const sc of scenes) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 160)));

  await page.goto(`http://localhost:5179/cinematic.html?scene=${sc}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, wait));

  const out = `shots/final_${sc}.png`;
  await page.screenshot({ path: out });
  console.log("SHOT:", out);
  if (errs.length) console.log("LOGS:\n" + errs.slice(0, 4).join("\n"));
  await page.close();
}

await browser.close();
