/**
 * 主演示冒烟：用 domcontentloaded 进页面，等固定时间后截图并收集报错。
 *
 * shot.mjs 用 networkidle2，遇到长任务或 HMR 连接时会一直等不到空闲；
 * 这里改用固定等待，专门用来确认「地图数据改完之后主演示还能不能建起来」。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const wait = Number(process.argv[2] || 18000);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1600,900"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));
page.on("requestfailed", (r) => logs.push("[reqfail] " + r.url()));

const t0 = Date.now();
await page.goto("http://localhost:5179/", { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("domcontentloaded", Date.now() - t0, "ms");
await new Promise((r) => setTimeout(r, wait));

const info = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const st = window.__app?.world?.agents ? Object.keys(window.__app.world.agents).length : "n/a";
  return {
    canvas: c ? `${c.width}×${c.height}` : "none",
    agents: st,
    scene: window.__app?.current_scene ?? "n/a",
    fps: document.querySelector("[data-fps]")?.textContent ?? "",
  };
});
console.log("STATE:", JSON.stringify(info));
await page.screenshot({ path: "shots/smoke_main.png" });
console.log("LOGS:", logs.length ? logs.slice(0, 6).join("\n") : "(clean)");
await browser.close();
