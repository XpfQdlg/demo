/**
 * 设备牌探针：查大屏里 person-1 / dog-3 那些小胶囊到底是 DOM 还是 canvas 精灵。
 *
 *   node tools/checks/_probe_label.mjs
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
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
page.on("console", (m) => console.log("CONSOLE:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:5179/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 22000));

const out = await page.evaluate(() => {
  const res = {};
  res.tag3d = document.querySelectorAll(".tag3d").length;
  res.css2dAny = document.querySelectorAll("#stage div").length;
  res.stageKids = [...(document.querySelector("#stage")?.children ?? [])].map(
    (e) => e.tagName + "." + (e.className || "") + "#" + (e.id || ""),
  );
  const divs = [...document.querySelectorAll("#stage div")].slice(0, 8);
  res.sample = divs.map((e) => {
    const s = getComputedStyle(e);
    return {
      cls: e.className,
      text: (e.textContent || "").trim().slice(0, 20),
      color: s.color,
      bg: s.backgroundColor,
      border: s.borderColor,
      filter: s.filter,
    };
  });
  res.canvasCount = document.querySelectorAll("canvas").length;
  return res;
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
