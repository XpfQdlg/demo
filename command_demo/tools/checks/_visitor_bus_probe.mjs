/**
 * 观众上报 · 总线协议验收。
 *
 *   node tools/checks/_visitor_bus_probe.mjs
 *
 * 验三件事：
 *   A. 大屏不在线时，POST /api/commands 返回 fallback，总线自己合成完整生命周期；
 *   B. 大屏订阅指挥流后，命令推给大屏（big-screen），总线不再合成生命周期；
 *   C. 参数校验、健康检查、reset 清兜底定时器。
 *
 * 前置：dev server 在 5179。
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const BASE = process.env.DEMO_BASE || "http://127.0.0.1:5179";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snapshot = () => fetch(`${BASE}/api/alerts/snapshot`).then((r) => r.json());
const reset = () => fetch(`${BASE}/api/alerts/reset`, { method: "POST" }).then((r) => r.json());

const command = (over = {}) =>
  fetch(`${BASE}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "visitor_report",
      scene: "subway",
      kind: "trash",
      confidence: 0.91,
      name: "通道遗留物",
      client_id: "probe",
      ...over,
    }),
  });

/** 订阅指挥流，返回 { frames, close }；用 puppeteer 做客户端是为了拿到标准的 EventSource 行为 */
async function open_command_listener() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const frames = await page.evaluate(async (base) => {
    window.__cmds = [];
    const es = new EventSource(base + "/api/commands/stream");
    es.addEventListener("command", (e) => window.__cmds.push(JSON.parse(e.data)));
    await new Promise((resolve) => {
      es.addEventListener("hello", resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    return window.__cmds.length;
  }, BASE);
  return {
    browser,
    page,
    frames,
    async read() {
      return page.evaluate(() => window.__cmds.slice());
    },
    async close() {
      await browser.close();
    },
  };
}

await reset();
const cmd_before = await fetch(`${BASE}/api/commands/health`).then((r) => r.json());
const isolated = (cmd_before.clients || 0) === 0;
if (!isolated) {
  console.log(`SKIP fallback 隔离用例：总线上还有 ${cmd_before.clients} 个指挥流订阅者（大屏/其他浏览器）`);
}

/* ── A. 大屏不在线：总线兜底生命周期 ─────────────────────────────────── */
if (isolated) {
const fallback_res = await command();
const fallback_body = await fallback_res.json();
check("A1 无指挥流时返回 fallback", fallback_body.ok === true && fallback_body.mode === "fallback", JSON.stringify(fallback_body));
await sleep(14000);
const fb_snap = await snapshot();
const fb_events = fb_snap.events.filter((e) => e.incident?.visitor && e.type !== "scene");
const fb_types = fb_events.map((e) => e.type).join(",");
check(
  "A2 总线合成完整生命周期",
  fb_types === "alarm,dispatched,arrive,handling,resolved",
  fb_types
);
check(
  "A3 同一条事件共享 incident.id",
  new Set(fb_events.map((e) => e.incident?.id)).size === 1,
  JSON.stringify([...new Set(fb_events.map((e) => e.incident?.id))])
);
check(
  "A4 观众上报标记与场景本地化名",
  fb_events[0]?.incident?.visitor === true && fb_events[0]?.incident?.name === "通道遗留物" && fb_events[0]?.incident?.scene === "subway",
  JSON.stringify({ visitor: fb_events[0]?.incident?.visitor, name: fb_events[0]?.incident?.name, scene: fb_events[0]?.incident?.scene })
);
}

/* ── B. 大屏在线：只推命令，不合成 ───────────────────────────────────── */
await reset();
const listener = await open_command_listener();
await sleep(600);
const health = await fetch(`${BASE}/api/commands/health`).then((r) => r.json());
check("B1 指挥流连接计入 health", health.clients === 1, JSON.stringify(health));

const big_res = await fetch(`${BASE}/api/commands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "visitor_report", scene: "campus", kind: "fire", confidence: 0.93, name: "明火", client_id: "probe2" }),
}).then((r) => r.json());
check("B2 大屏在线时返回 big-screen", big_res.ok === true && big_res.mode === "big-screen" && big_res.listeners >= 1, JSON.stringify(big_res));

await sleep(500);
const received = await listener.read();
check(
  "B3 指挥流收到命令且字段完整",
  received.length === 1 && received[0].scene === "campus" && received[0].kind === "fire" && received[0].name === "明火" && received[0].mode === undefined,
  JSON.stringify(received)
);
await sleep(2000);
const big_snap = await snapshot();
const synthesized = big_snap.events.filter((e) => e.incident?.visitor);
check("B4 大屏在线时总线不再合成生命周期", synthesized.length === 0, JSON.stringify(synthesized.map((e) => e.type)));
await listener.close();

/* ── C. 校验与清理 ───────────────────────────────────────────────────── */
const bad_scene = await command({ scene: "moon" });
check("C1 非法场景 400", bad_scene.status === 400, String(bad_scene.status));
const bad_type = await fetch(`${BASE}/api/commands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "eat", scene: "campus" }),
});
check("C2 非法指令类型 400", bad_type.status === 400, String(bad_type.status));
const bad_json = await fetch(`${BASE}/api/commands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{oops",
});
check("C3 非法 JSON 400", bad_json.status === 400, String(bad_json.status));

/* 兜底定时器必须能被 reset 清掉，否则验收脚本会互相污染 */
await reset();
await command({ client_id: "probe3" });
await reset();
await sleep(2500);
const clean_snap = await snapshot();
check("C4 reset 清空事件与兜底定时器", clean_snap.events.length === 0, String(clean_snap.events.length));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
