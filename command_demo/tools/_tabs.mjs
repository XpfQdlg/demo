/**
 * 页签切换验收：校园 ⇄ 小区共用同一个场景，切换只换机位。
 *
 *   node tools/_tabs.mjs
 *
 * 检查：切换后场景里只有一棵根节点、没有报错、机位确实变了。
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0, 160)));

await page.goto("http://localhost:5179/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 30000));

const probe = async (label) => {
  const s = await page.evaluate(() => {
    const c = window.__cine;
    const roots = c.scene.children.filter((o) => o.type === "Group" && o.name);
    return {
      roots: roots.map((o) => o.name),
      target: c.orbit_target ? [
        Math.round(c.orbit_target.x), Math.round(c.orbit_target.z),
      ] : null,
      distance: Math.round(c.distance),
    };
  });
  console.log(label, JSON.stringify(s));
};

await probe("campus ");
await page.click('[data-scene="community"]');
await new Promise((r) => setTimeout(r, 2500));
await probe("-> comm");
await page.screenshot({ path: "shots/tab_community.png" });

await page.click('[data-scene="campus"]');
await new Promise((r) => setTimeout(r, 2500));
await probe("-> camp");
await page.screenshot({ path: "shots/tab_campus.png" });

console.log("errors:", errs.slice(0, 4));
await browser.close();
