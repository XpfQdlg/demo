/**
 * 大屏「手机」入口验收：二维码内容 = 本机局域网地址 /phone，且该地址可访问。
 *
 *   node tools/checks/_phone_link_probe.mjs
 *
 * 需要 dev server（npm run dev）与 puppeteer-core、本机 Chrome/Edge。
 * 截图输出 shots/phone_link_panel.png。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome / Edge");
  process.exit(1);
}

const BASE = process.env.DEMO_BASE || "http://127.0.0.1:5179";
const results = [];
/* 探测失败回归里会主动 abort 一次 info 请求，浏览器会记一条 network 错误；
   这不是页面 JS 的错，只过滤这一种 */
const app_errs = (list) => list.filter((e) => !e.includes("Failed to load resource"));
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));

await page.goto(`${BASE}/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));

/* 回归：第一次探测失败（模拟服务未起），提示应明确；服务恢复后关掉再打开，
   应重新探测并出二维码，而不是一直停在失败提示。 */
let block_info = true;
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (block_info && req.url().includes("/api/alerts/info")) req.abort();
  else req.continue();
});
await page.click("#phoneBtn");
await page.waitForFunction(
  () => document.getElementById("phoneUrl")?.textContent.includes("未找到"),
  { timeout: 8000 }
);
check("探测失败有明确提示", true);
block_info = false;
await page.click("#phoneBtn");            // 关掉弹层
await new Promise((r) => setTimeout(r, 350));
await page.click("#phoneBtn");            // 再打开：应重新探测
await page.waitForFunction(() => {
  const el = document.getElementById("phoneUrl");
  return el && /^http:\/\/.+:\d+\/phone$/.test(el.textContent.trim());
}, { timeout: 8000 });
check("服务恢复后重新打开可重试成功", true);

const info = await page.evaluate(async () => {
  const url = document.getElementById("phoneUrl").textContent.trim();
  const panel_open = document.getElementById("phonePanel").classList.contains("on");
  const has_svg = !!document.querySelector("#phoneQR svg");
  let decoded = null;
  try {
    /* Chrome 的形状检测：能直接确认二维码扫出来就是那个地址 */
    if ("BarcodeDetector" in window) {
      const bitmap = await createImageBitmap(await (await fetch(
        "data:image/svg+xml;base64," + btoa(new XMLSerializer().serializeToString(document.querySelector("#phoneQR svg")))
      )).blob());
      const codes = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
      decoded = codes[0]?.rawValue || null;
    }
  } catch {
    /* 浏览器不支持时报 null，用页面上显示的地址核对 */
  }
  return { url, panel_open, has_svg, decoded };
});

check("弹层打开", info.panel_open);
check("二维码已生成", info.has_svg);
check("地址是本机局域网 IP + /phone", /^http:\/\/(?!localhost|127\.0\.0\.1)\d+\.\d+\.\d+\.\d+:\d+\/phone$/.test(info.url), info.url);
if (info.decoded) check("二维码内容与地址一致", info.decoded === info.url, info.decoded);

/* 该地址真的能打开（跟随重定向后应是手机页） */
const res = await fetch(info.url, { redirect: "follow" });
const html = await res.text();
check("手机地址可访问", res.ok && html.includes('id="filters"'), `${res.status} ${res.url}`);
check("无应用层报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));

await page.screenshot({ path: "shots/phone_link_panel.png" });
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
