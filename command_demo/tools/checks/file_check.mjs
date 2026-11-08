/**
 * 单文件交付物验收：以 file:// 打开观感版单文件，切四个场景各截一张，收集报错。
 *
 *   node tools/checks/file_check.mjs                   默认 观感版演示.html
 *   node tools/checks/file_check.mjs 其他单文件.html
 *
 * 除了「能打开」，还要确认贴图真的从 data URI 里解出来了。
 * file:// 下直接读本地图片会触发跨源限制，纹理上传失败时画面是纯色，
 * 但控制台不一定会报错，所以要看 __pbr.peek("asphalt/color")。
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

const FILE = process.argv[2] || "观感版演示.html";
/* 相对路径先解析成绝对路径，否则 file:// 会落到盘符根目录 */
const abs = fs.existsSync(FILE) ? fs.realpathSync(FILE) : FILE;
const url = "file:///" + abs.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
console.log("· 打开", url);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  /* 不加 --allow-file-access-from-files：展台双击打开时没有这个参数，
     验收要按真实条件跑，才能证明贴图确实走了 data URI */
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && logs.push("console: " + m.text()));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction("window.__cine && window.__pbr", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 12000));

const st = await page.evaluate(() => ({
  canvas: !!document.querySelector("canvas"),
  inline_assets: Object.keys(window.__INLINE_ASSETS || {}).length,
  asphalt: window.__pbr?.peek("asphalt/color"),
  agents: document.querySelectorAll("#agentRows .agent-row").length,
  fps: document.getElementById("fps")?.textContent || "—",
}));
console.log("首屏:", JSON.stringify(st));

for (const sc of ["campus", "community", "forest", "subway"]) {
  await page.click(`[data-scene="${sc}"]`);
  await new Promise((r) => setTimeout(r, 7000));
  const n = await page.evaluate(() => document.querySelectorAll("#agentRows .agent-row").length);
  await page.screenshot({ path: `shots/file_${sc}.png` });
  console.log(`  ${sc}: ${n} 台设备，截图 shots/file_${sc}.png`);
}

console.log("LOGS:", logs.length ? logs.slice(0, 8).join("\n") : "(clean)");
await browser.close();
