/* 台上平板 → 大屏 的整条链路：点一个情景，看会诊与切场景 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const b = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const st = await b.newPage();
await st.setViewport({ width: 1600, height: 900 });
await st.goto("http://localhost:5179/cinematic.html?scene=campus&q=medium", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 26000));

const tab = await b.newPage();
await tab.setViewport({ width: 1180, height: 820 });
await tab.goto("http://localhost:5179/tablet.html", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await tab.screenshot({ path: "shots/tablet_live.png" });

/* 第三个模型（地铁）× 第一个情景 */
await tab.click(".model:nth-child(3) .fire-btn:nth-child(1)");
await new Promise((r) => setTimeout(r, 3200));
await st.screenshot({ path: "shots/flow_1_consult.png" });
const state = await st.evaluate(() => ({
  scene: document.querySelector(".tab.on")?.textContent,
  title: document.querySelector("#visitorTitle")?.textContent,
  on: document.querySelector("#visitorToast")?.classList.contains("on"),
}));
console.log("after click", state);

await new Promise((r) => setTimeout(r, 8000));
await st.screenshot({ path: "shots/flow_2_after.png" });
const state2 = await st.evaluate(() => ({
  scene: document.querySelector(".tab.on")?.textContent,
  on: document.querySelector("#visitorToast")?.classList.contains("on"),
  deck: [...document.querySelectorAll(".dk-card")].map((n) => n.className),
  chain: [...document.querySelectorAll(".ch-step")].map((n) => n.className),
  feed: document.querySelector("#feed")?.innerText?.slice(0, 120),
}));
console.log("after 11s", state2);
await b.close();
