/**
 * 线上部署验收（跑在本地，不依赖仓库构建产物）。
 *
 *   node tools/checks/live_check.mjs
 *   BASE=http://127.0.0.1:2026 node tools/checks/live_check.mjs
 *
 * 四件事：大屏能渲染（场景、设备数、四张模型卡）、手机页报错为零、
 * 手机点「演示上报」后大屏右下角回执出现、刷新大屏后事件流从总线回放，
 * 全程无 5xx / pageerror。任何一条不满足都以退出码 1 结束，方便部署脚本直接串起来。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.BASE || "http://47.104.205.57:2026";
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const b = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  // 本机开着系统代理（127.0.0.1:17897），公网 IP 不在 bypass 列表里，
  // 不显式绕开时浏览器请求会走代理并拿到 502，curl 则直连正常。
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--no-proxy-server"],
});

const errs = [];
const st = await b.newPage();
st.on("pageerror", (e) => errs.push("screen: " + e.message));
st.on("console", (m) => m.type() === "error" && errs.push("screen-console: " + m.text().slice(0, 120)));
st.on("response", (r) => r.status() >= 500 && errs.push(`screen-http: ${r.status()} ${r.url()}`));
await st.setViewport({ width: 1600, height: 900 });
await st.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 18000));
await st.screenshot({ path: "shots/live_desktop.png" });
const screen = await st.evaluate(() => ({
  scene: window.__monitor?.scene,
  agents: window.__monitor?.agents?.length,
  cards: document.querySelectorAll(".dk-card").length,
}));
console.log("screen", screen);

const ph = await b.newPage();
ph.on("pageerror", (e) => errs.push("phone: " + e.message));
ph.on("response", (r) => r.status() >= 500 && errs.push(`phone-http: ${r.status()} ${r.url()}`));
await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ph.goto(BASE + "/phone", { waitUntil: "networkidle2", timeout: 60000 });
await ph.click("#join-cta");
await new Promise((r) => setTimeout(r, 250));
await ph.click("#btn-demo");
await new Promise((r) => setTimeout(r, 4200));
await st.screenshot({ path: "shots/live_ping.png" });
console.log("phone", await ph.evaluate(() => document.querySelector("#toast")?.textContent));
const ping = await st.evaluate(() => ({
  on: document.querySelector("#visitorPing")?.className,
  title: document.querySelector("#visitorPingTitle")?.textContent,
  verdict: document.querySelector("#visitorPingVerdict")?.textContent,
}));
console.log("ping", ping);

/* 刷新一次：事件流应当从总线回放，而不是重新变空 */
await st.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await st.waitForFunction(() => document.querySelectorAll("#feedRows .feed-row").length > 0, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 800));
const feed = await st.evaluate(() =>
  [...document.querySelectorAll("#feedRows .feed-row")].map((r) => r.textContent.trim())
);
await st.screenshot({ path: "shots/live_restore.png" });
console.log("feed after reload", feed.length, feed.slice(0, 2));

console.log("errors", errs.slice(0, 3));
await b.close();

const bad = [];
if (screen.scene !== "campus") bad.push("大屏场景没起来");
if (screen.cards !== 4) bad.push("模型卡数量不是 4");
if (!String(ping.on || "").includes("on")) bad.push("回执卡没出现");
if (feed.length < 2) bad.push("刷新后事件流没有回放");
if (errs.length) bad.push(`有 ${errs.length} 条错误`);
if (bad.length) {
  console.error("✗ " + bad.join("；"));
  process.exit(1);
}
console.log("✓ 线上验收通过");
