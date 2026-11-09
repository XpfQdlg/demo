/**
 * 大屏会话能力验收：在线值班员、本场战报、语音指挥、第一视角回传。
 *
 *   node tools/checks/_bigscreen_session_probe.mjs
 *
 * 前置：dev server 在 5179，puppeteer-core + 本机 Chrome。
 * 截图：shots/probe_bigscreen_session.png
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
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app_errs = (list) => list.filter((e) => !e.includes("Failed to load resource"));
const post = (path, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/* ── 总线层：/api/stats 与 /api/participants ─────────────────────────── */
await fetch(BASE + "/api/alerts/reset", { method: "POST" });
await post("/api/participants", { client_id: "probe-a", role: "guard", name: "安保-01", score: 150, reports: 3 });
const p2 = await post("/api/participants", { client_id: "probe-b", role: "inspect", name: "巡检-02", score: 60, reports: 1 });
check("注册值班员", p2.status === 200 && p2.body.count >= 2, JSON.stringify(p2.body));
const people = await fetch(BASE + "/api/participants").then((r) => r.json());
check("值班员按积分排序", people.ok && people.count >= 2 && people.participants[0].score >= people.participants[1].score, JSON.stringify(people.participants.map((p) => p.score)));
const bad = await post("/api/participants", { role: "guard" });
check("缺 client_id 拒绝", bad.status === 400, String(bad.status));

await post("/api/commands", { type: "visitor_report", scene: "campus", kind: "fire", confidence: 0.9, name: "明火", client_id: "probe-a" });
await post("/api/commands", { type: "voice_command", action: "scene", scene: "subway", text: "切到地铁", client_id: "probe-a" });
const stats = await fetch(BASE + "/api/stats").then((r) => r.json());
check(
  "战报统计累加上报与语音",
  stats.ok && stats.visitor_reports >= 1 && stats.voice_commands >= 1 && (stats.by_scene.campus || 0) >= 1 && (stats.by_kind.fire || 0) >= 1,
  JSON.stringify({ reports: stats.visitor_reports, voice: stats.voice_commands, by_scene: stats.by_scene, by_kind: stats.by_kind })
);

const bad_voice = await post("/api/commands", { type: "voice_command", action: "launch-missile" });
check("语音指令白名单拒绝非法 action", bad_voice.status === 400, String(bad_voice.status));

const bad_frame = await post("/api/frames", { dataUrl: "not-an-image" });
check("非法回传帧拒绝", bad_frame.status === 400, String(bad_frame.status));
const good_frame = await post("/api/frames", { dataUrl: "data:image/jpeg;base64,AAAA", scene: "campus", device: "dog-2" });
const frame = await fetch(BASE + "/api/frames/latest").then((r) => r.json());
check("帧回传可读", good_frame.status === 200 && frame.ok && frame.frame?.scene === "campus" && frame.frame?.device === "dog-2", JSON.stringify(frame.frame && { scene: frame.frame.scene, device: frame.frame.device }));

/* ── 大屏页面：在线值班员 / 战报 / 语音指挥 / 回传 ───────────────────── */
await fetch(BASE + "/api/alerts/reset", { method: "POST" });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 300000,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
await page.goto(`${BASE}/cinematic.html?scene=campus`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, { timeout: 120000 });
await page.waitForFunction(() => window.__visitor_es && window.__visitor_es.readyState === 1, { timeout: 20000 });
await sleep(1200);

await post("/api/participants", { client_id: "probe-a", role: "guard", name: "安保-01", score: 150, reports: 3 });
await post("/api/participants", { client_id: "probe-b", role: "inspect", name: "巡检-02", score: 60, reports: 1 });
await page.waitForFunction(() => document.getElementById("crowdCount")?.textContent.trim() === "2", { timeout: 12000 }).catch(() => {});
const crowd = await page.evaluate(() => ({
  count: document.getElementById("crowdCount")?.textContent.trim(),
  dots: document.querySelectorAll("#crowdAvatars i").length,
}));
check("大屏在线值班员条", crowd.count === "2" && crowd.dots === 2, JSON.stringify(crowd));

/* 造一条观众上报，让战报有数字、并进入自动跟随 */
const visitor = await post("/api/commands", { type: "visitor_report", scene: "campus", kind: "fire", confidence: 0.93, name: "明火", client_id: "probe-a" });
check("观众上报走大屏链路", visitor.body.mode === "big-screen", JSON.stringify(visitor.body));
await page.waitForFunction(() => window.__monitor?.incidents?.some((i) => i.visitor), { timeout: 30000 });
await sleep(1500);

await page.click("#battleBtn");
await page.waitForFunction(() => document.getElementById("battlePanel")?.classList.contains("on"), { timeout: 5000 });
const battle = await page.evaluate(() => ({
  stats: [...document.querySelectorAll("#battleStats .battle-stat")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  models: document.querySelectorAll("#battleModels .battle-model").length,
  top: document.querySelectorAll("#battleTop .battle-top-row").length,
}));
check("战报打开且四项指标齐全", battle.stats.length === 4, JSON.stringify(battle.stats));
check("战报四模型命中区", battle.models === 4);
check("战报值班员榜单", battle.top >= 2, String(battle.top));
await page.screenshot({ path: "shots/probe_bigscreen_session.png" });
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.getElementById("battlePanel")?.classList.contains("on"), { timeout: 4000 });
check("Esc 关闭战报", true);

/* 语音指挥：切场景 + 开战报 */
await post("/api/commands", { type: "voice_command", action: "scene", scene: "subway", text: "切到地铁", client_id: "probe-a" });
await page.waitForFunction(() => document.getElementById("modelName")?.textContent.trim() === "地铁客运模型", { timeout: 60000 });
const voice_scene = await page.evaluate(() => document.getElementById("voiceCmdToast")?.textContent || "");
check("语音指挥切场景", voice_scene.includes("已切到地铁"), voice_scene);
await post("/api/commands", { type: "voice_command", action: "battle", text: "看看战报", client_id: "probe-a" });
await page.waitForFunction(() => document.getElementById("battlePanel")?.classList.contains("on"), { timeout: 5000 });
check("语音指挥打开战报", true);
await page.keyboard.press("Escape");
await sleep(400);

/* 跟随出警时大屏把第一视角帧推给手机 */
await fetch(BASE + "/api/alerts/reset", { method: "POST" });
await page.click('.tab[data-scene="campus"]');
await page.waitForFunction(() => document.getElementById("modelName")?.textContent.trim() === "校园巡检模型", { timeout: 90000 });
await sleep(600);
await post("/api/commands", { type: "visitor_report", scene: "campus", kind: "crowd", confidence: 0.9, name: "人员聚集", client_id: "probe-b" });
await page.waitForFunction(() => window.__monitor?.incidents?.some((i) => i.visitor), { timeout: 30000 });
let relayed = null;
for (let i = 0; i < 20; i++) {
  await sleep(600);
  const r = await fetch(BASE + "/api/frames/latest").then((x) => x.json());
  if (r.frame?.dataUrl?.startsWith("data:image/")) {
    relayed = { ...r.frame, bytes: r.frame.dataUrl.length };
    break;
  }
}
/* 不能只看 data:image 前缀：不开 preserveDrawingBuffer 时抓到的是一张纯黑 JPEG。
   在页面里解码后画到 64x36 画布上，查颜色数/亮度标准差，再确认后续有刷新。 */
let decoded = null;
let refreshed = false;
if (relayed) {
  decoded = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    try {
      await img.decode();
    } catch {
      await new Promise((r) => {
        img.onload = r;
        img.onerror = r;
      });
    }
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    const colors = new Set();
    let s = 0;
    let s2 = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      s += l;
      s2 += l * l;
      n += 1;
    }
    const mean = s / n;
    return { colors: colors.size, mean: Math.round(mean), std: Math.round(Math.sqrt(s2 / n - mean * mean)) };
  }, relayed.dataUrl);
  const ts1 = relayed.ts;
  await sleep(1700);
  const r2 = await fetch(BASE + "/api/frames/latest").then((x) => x.json());
  refreshed = !!(r2.frame && r2.frame.ts > ts1);
}
check(
  "跟随出警时回传真实第一视角帧（非黑帧且持续刷新）",
  !!relayed && relayed.bytes > 5000 && decoded?.colors > 20 && decoded?.std > 8 && refreshed,
  JSON.stringify({ bytes: relayed?.bytes, decoded, refreshed })
);

check("大屏无应用层报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));
await browser.close();

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
