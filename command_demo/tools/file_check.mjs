/**
 * 单文件交付物验收：以 file:// 打开，切四个场景各截一张，收集报错。
 * 用来确认「双击即开、离线可用」这条交付要求没有因为改动而失效。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const FILE = process.argv[2] || "联动指挥演示.html";
/* 相对路径要先解析成绝对路径，否则 file:// 会落到盘符根目录 */
const abs = fs.existsSync(FILE) ? fs.realpathSync(FILE) : FILE;
const url = "file:///" + abs.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && logs.push("console: " + m.text()));

await page.goto(url, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 9000));

const st = await page.evaluate(() => ({
  canvas: !!document.querySelector("canvas"),
  fps: document.getElementById("statusFps")?.textContent || "—",
}));
console.log("首屏:", JSON.stringify(st));

for (const sc of ["campus", "community", "forest", "subway"]) {
  await page.evaluate((s) => __app.enter_scene(s), sc);
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: `shots/file_${sc}.png` });
  console.log("  截图 shots/file_" + sc + ".png");
}

console.log("LOGS:", logs.length ? logs.slice(0, 8).join("\n") : "(clean)");
await browser.close();
