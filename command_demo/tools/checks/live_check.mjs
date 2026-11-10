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
  // 渲染走硬件（D3D11）：软件光栅下 MSAA 4× 一帧要一两秒，截图会把
  // 10 秒的回执窗口等过去，验收就会拍到一张已经收起的空卡。
  args: ["--use-angle=d3d11", "--hide-scrollbars", "--no-proxy-server"],
});

const errs = [];
const st = await b.newPage();
st.on("pageerror", (e) => errs.push("screen: " + e.message));
st.on("console", (m) => m.type() === "error" && errs.push("screen-console: " + m.text().slice(0, 120)));
st.on("response", (r) => r.status() >= 500 && errs.push(`screen-http: ${r.status()} ${r.url()}`));
await st.setViewport({ width: 1600, height: 900 });
await st.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
/* 自动轮播每 45 秒切一次场景，切场景会清掉回执与抓拍卡。
   验收期间把它钉住，否则告警刚好撞上切换就永远抓不到。 */
await st.evaluate(() => {
  window.__auto_paused = true;
});
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
/* 演示照片的「分析进度」走 requestAnimationFrame：手机页一旦被切到后台，
   进度条就停了、永远发不出上报。所以先等 POST /api/commands 真的发出去，
   再把大屏页提到前面去等回执。 */
const sent = new Promise((resolve) => {
  ph.on("response", (r) => {
    if (r.url().includes("/api/commands") && r.status() === 200) resolve();
  });
});
await ph.click("#btn-demo");
await Promise.race([sent, new Promise((_, reject) => setTimeout(() => reject(new Error("手机页没有发出上报")), 30000))]);
await st.bringToFront();
/* 上报后要先跑四模型会诊再派单，回执卡出现的时间随当前场景浮动
   （实测 3–9 秒），固定等 4 秒会偶发拍到「已受理，正在派单…」。 */
/* 先等回执卡出现，再等「会诊 + 派单」落定（文案变成「已派 …」）。
   只等 .on 会在「已受理，正在派单…」时就读，抓拍卡那时还没弹。 */
await st.waitForFunction(() => document.querySelector("#visitorPing")?.classList.contains("on"), {
  polling: 500,
  timeout: 30000,
});
await st.waitForFunction(
  () => /已派/.test(document.querySelector("#visitorPingVerdict")?.textContent || ""),
  { polling: 500, timeout: 40000 }
);
/* 先读 DOM 再截图：截图在软件光栅下可能要十几秒，
   而回执 10 秒就收起、抓拍卡 13 秒收起，顺序反了会拍到空画面。 */
const ping = await st.evaluate(() => ({
  on: document.querySelector("#visitorPing")?.className,
  title: document.querySelector("#visitorPingTitle")?.textContent,
  verdict: document.querySelector("#visitorPingVerdict")?.textContent,
}));
console.log("ping", ping);

/* 现场抓拍卡：报警后事发点上方应出现一张实拍图，且图片真的解码成功
   （naturalWidth 为 0 说明 /photos 没传上去或被拦） */
const evi = await st.evaluate(() => {
  const el = document.querySelector(".evi");
  const img = el?.querySelector("img");
  return el
    ? {
        area: el.querySelector(".evi-meta b")?.textContent,
        note: el.querySelector(".evi-meta span")?.textContent,
        w: img?.naturalWidth || 0,
        flip: el.classList.contains("is-flip"),
      }
    : null;
});
console.log("evidence", evi);

await st.screenshot({ path: "shots/live_ping.png" });
console.log("phone", await ph.evaluate(() => document.querySelector("#toast")?.textContent));

/* 再开一个标签页：事件流应当从总线回放，而不是新页面从空开始。
   这里不用 reload——刷新会掐掉在途的 keepalive POST，服务端读到半截 JSON
   回 400、控制台多几条假错误；新开一页同样证明「数据在服务端」，
   而且更接近观众换一台设备打开的场景。 */
const st2 = await b.newPage();
st2.on("pageerror", (e) => errs.push("restore: " + e.message));
st2.on("response", (r) => r.status() >= 500 && errs.push(`restore-http: ${r.status()} ${r.url()}`));
await st2.setViewport({ width: 1600, height: 900 });
await st2.goto(BASE + "/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await st2.waitForFunction(() => document.querySelectorAll("#feedRows .feed-row").length > 0, {
  polling: 1000,
  timeout: 60000,
});
await new Promise((r) => setTimeout(r, 800));
const feed = await st2.evaluate(() =>
  [...document.querySelectorAll("#feedRows .feed-row")].map((r) => r.textContent.trim())
);
await st2.screenshot({ path: "shots/live_restore.png" });
console.log("feed after reload", feed.length, feed.slice(0, 2));

console.log("errors", errs.slice(0, 3));
await b.close();

const bad = [];
if (screen.scene !== "campus") bad.push("大屏场景没起来");
if (screen.cards !== 4) bad.push("模型卡数量不是 4");
if (!String(ping.on || "").includes("on")) bad.push("回执卡没出现");
if (!evi) bad.push("现场抓拍卡没出现");
else if (!evi.w) bad.push("现场抓拍卡图片没解码");
if (feed.length < 2) bad.push("刷新后事件流没有回放");
if (errs.length) bad.push(`有 ${errs.length} 条错误`);
if (bad.length) {
  console.error("✗ " + bad.join("；"));
  process.exit(1);
}
console.log("✓ 线上验收通过");
