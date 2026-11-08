/**
 * 监控报警与就近调度的验收。
 *
 *   node tools/checks/_alert_probe.mjs            校园
 *   node tools/checks/_alert_probe.mjs community  小区
 *
 * 无头渲染只有 2~5 帧，cinematic 的 dt 上限 0.05，仿真时间比墙钟慢十倍以上。
 * 所以报警计时不靠等，直接在页面里推 monitor.tick(0.05)。
 * 处置段用的是 setTimeout（墙钟），可以正常等。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const scene = process.argv[2] || "campus";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));

await page.goto(`http://localhost:5179/cinematic.html?scene=${scene}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

await page.waitForFunction(() => window.__monitor && window.__monitor.cameras.length > 0, {
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2500));

const info = await page.evaluate(() => {
  const m = window.__monitor;
  return {
    scene: m.scene,
    floor_y: m.floor_y,
    agents: m.agents.length,
    cameras: m.cameras.map((c) => ({ id: c.id, px: c.px.map((v) => Math.round(v)), h: c.height })),
    incidents: m.incidents.map((i) => ({
      kind: i.kind, area: i.area, px: i.px.map((v) => Math.round(v)),
      status: i.status, prop: !!i.prop,
    })),
  };
});
console.log("INFO " + JSON.stringify(info));

/* 推十秒仿真时间，第一起报警应该在这个时候触发 */
const fired = await page.evaluate(() => {
  const m = window.__monitor;
  for (let i = 0; i < 220; i++) m.tick(0.05);
  const inc = m.incidents.find((i) => i.fired);
  if (!inc) return null;
  const by = inc.by;
  return {
    status: inc.status,
    kind: inc.name,
    area: inc.area,
    camera: inc.camera.id,
    by: by ? { type: by.type, status: by.status, straight_px: Math.round(Math.hypot(by.x - inc.px[0], by.y - inc.px[1])) } : null,
    distance_m: Math.round(inc.distance_m),
    eta_s: Math.round(inc.eta_s),
    led: +inc.camera.led.emissiveIntensity.toFixed(2),
    ring: !!inc.ring && inc.ring.visible,
    toast: document.getElementById("toast")?.textContent || "",
    toast_on: document.getElementById("toast")?.classList.contains("on"),
    bubbles: m.root.getObjectByName("markers")?.children.length ?? -1,
    others: m.agents
      .filter((a) => a !== by)
      .map((a) => ({ type: a.type, status: a.status, d: Math.round(Math.hypot(a.x - inc.px[0], a.y - inc.px[1])) })),
  };
});
console.log("ALARM " + JSON.stringify(fired));

await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `shots/alert_${scene}_global.png` });
console.log("SHOT global");

/* 镜头挪到摄像杆旁边，确认杆子、云台与指示灯；再挪到事发点看光圈与道具 */
async function frame_at(kind, sel, dist) {
  await page.evaluate(({ sel, dist }) => {
    const m = window.__monitor;
    const inc = m.incidents.find((i) => i.fired);
    const w = sel === "camera" ? inc.camera.world : window.__cine_three ? null : null;
    const V = window.__cine_three.Vector3;
    const target =
      sel === "camera"
        ? new V(w.x, 2.2, w.z)
        : new V(
            (inc.px[0] - 539.5) * 0.5,
            1.6,
            (inc.px[1] - 777) * 0.5
          );
    const c = window.__cine;
    c.theta = 2.2;
    c.phi = 1.0;
    c.distance = dist;
    c.bind_orbit(target);
  }, { sel, dist });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `shots/alert_${scene}_${kind}.png` });
  console.log("SHOT " + kind);
}

await frame_at("camera", "camera", 22);
await frame_at("scene", "incident", 40);

/* 到场这一段有两种验法：
   默认直接判到场，几秒就能走完状态机；
   带 --natural 则等设备自己走过去——无头下每帧只走 0.05 秒，
   二十八米的路要跑一分多钟，用来确认调度下发的折线真的能走完。 */
if (process.argv.includes("--natural")) {
  console.log("WAIT 等设备自己走到（无头帧率低，可能要一两分钟）");
  await page.waitForFunction(
    () => window.__monitor.incidents.some((i) => i.status === "done"),
    { timeout: 240000, polling: 1000 }
  );
} else {
  const after = await page.evaluate(() => {
    const m = window.__monitor;
    const inc = m.incidents.find((i) => i.fired);
    m._arrive(inc, inc.by);
    return { status: inc.status, agent_status: inc.by.status };
  });
  console.log("ON_SITE " + JSON.stringify(after));
  await new Promise((r) => setTimeout(r, 6500));
}

const done = await page.evaluate(() => {
  const m = window.__monitor;
  const resolved = m.incidents.find((i) => i.status === "done");
  const target = resolved || m.incidents[0];
  return {
    resolved_status: resolved ? resolved.status : null,
    prop_visible: target.prop ? target.prop.visible : null,
    ring_visible: target.ring ? target.ring.visible : null,
    camera_alarm: target.camera.alarm,
    agent_status: target.by ? target.by.status : null,
    toast: document.getElementById("toast")?.textContent || "",
  };
});
console.log("RESOLVED " + JSON.stringify(done));
await page.screenshot({ path: `shots/alert_${scene}_done.png` });
console.log("SHOT done");

/* 一轮全部处置完 45 秒后重开：道具重新显示，状态回到 wait */
const cycle = await page.evaluate(() => {
  const m = window.__monitor;
  for (const i of m.incidents) {
    i.status = "done";
    i.camera.alarm = false;
    if (i.prop) i.prop.visible = false;
  }
  for (let k = 0; k < 60 * 21; k++) m.tick(0.05);   // 推 63 秒，越过 45 秒的轮空
  return m.incidents.map((i) => ({ kind: i.kind, status: i.status, prop: i.prop.visible }));
});
console.log("CYCLE " + JSON.stringify(cycle));

console.log("ERRORS " + JSON.stringify(errs.slice(0, 5)));
await browser.close();
