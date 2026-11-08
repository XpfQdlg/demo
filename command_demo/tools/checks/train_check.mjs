/**
 * 列车运行验收：把仿真时间推到不同相位，截三张图。
 * 无头软件渲染只有 3-5 fps，engine.time 累积很慢（每帧最多 0.05 秒），
 * 等真实时间没用，必须直接改 engine.time。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on("console", (m) => (m.type() === "error") && logs.push(m.text()));
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));

await page.goto("http://localhost:5179/index.html", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 5000));

await page.evaluate(() => {
  __app.enter_scene("subway");
  const e = __app.engine;
  e.setRig(null);
  e.camera.fov = 72;
  e.camera.updateProjectionMatrix();
  /* 站在站台上方偏南，斜看近侧轨道的整列车。站台 z 305..317，近侧轨道 z 300.6..305 */
  e.controls.target.set(-140, 1.9, 303);
  e.camera.position.set(-45, 2.5, 300);
  e.controls.update();
});
await new Promise((r) => setTimeout(r, 2000));

for (const [name, tt] of [["approach", 6], ["dwell", 12.5], ["depart", 22]]) {
  const info = await page.evaluate((t) => {
    __app.engine.time = t;
    const r = __app.world.active.built.root;
    const tr = [];
    r.children.forEach((o) => {
      if (o.type === "Group" && o.children.length > 20) tr.push(+o.position.x.toFixed(1));
    });
    return { t: __app.engine.time, trainX: tr };
  }, tt);
  await new Promise((r) => setTimeout(r, 900));
  const after = await page.evaluate(() => {
    const r = __app.world.active.built.root;
    const tr = [];
    r.children.forEach((o) => {
      if (o.type === "Group" && o.children.length > 20) tr.push(+o.position.x.toFixed(1));
    });
    return { t: +__app.engine.time.toFixed(2), trainX: tr };
  });
  console.log(name, "set:", JSON.stringify(info), "-> now:", JSON.stringify(after));
  await page.screenshot({ path: `shots/train_${name}.png` });
}

console.log("LOGS:", logs.length ? logs.slice(0, 10).join("\n") : "(clean)");
await browser.close();
