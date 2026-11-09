/**
 * 扫描建图验收：按 1 跟随第一台设备，各扫描半径截一张图。
 *
 *   node tools/check_scan.mjs
 *
 * 无头软件渲染只有 1~5 fps，仿真时间推不动，
 * 所以半径直接写 __scan.radius，不靠等。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync("shots", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--hide-scrollbars",
    "--window-size=1600,900",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("CON " + m.text().slice(0, 220)));

await page.goto("http://localhost:5180/cinematic.html?scene=campus", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 26000));

/* 进入跟随，扫描开始 */
await page.keyboard.press("Digit1");
await new Promise((r) => setTimeout(r, 2500));

const shots = [8, 18, 30, 44];
for (const r of shots) {
  await page.evaluate((rr) => {
    window.__scan.radius = rr;
    window.__scan.on = true;
  }, r);
  await new Promise((res) => setTimeout(res, 2500));
  await page.screenshot({ path: `shots/scan_${String(r).padStart(2, "0")}.png` });
}

const state = await page.evaluate(() => ({
  on: window.__scan.on,
  radius: +window.__scan.radius.toFixed(2),
  fade: +window.__scan.fade.toFixed(2),
  hud: document.getElementById("scanHud")?.className,
  hudR: document.getElementById("shR")?.textContent,
  follow: !!window.__cine.follow,
  overlay_visible: window.__scan.overlay?.visible,
  overlay_parent: !!window.__scan.overlay?.parent,
}));
console.log("STATE:", JSON.stringify(state, null, 2));

/* 退出跟随，确认淡出 */
await page.keyboard.press("KeyG");
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: "shots/scan_off.png" });
console.log(
  "OFF:",
  JSON.stringify(
    await page.evaluate(() => ({
      on: window.__scan.on,
      fade: +window.__scan.fade.toFixed(3),
      hud: document.getElementById("scanHud")?.className,
    }))
  )
);

console.log("errors:", errs.slice(0, 6));
await browser.close();
