/**
 * 观众上报 · 大屏会诊与出警截图
 *   node tools/checks/_consult_shot.mjs [scene] [kind] [name]
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const BASE = "http://127.0.0.1:5179";
const scene = process.argv[2] || "campus";
const kind = process.argv[3] || "fire";
const name = process.argv[4] || "明火";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reset = () => fetch(`${BASE}/api/alerts/reset`, { method: "POST" }).then((r) => r.json());
const send = () =>
  fetch(`${BASE}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "visitor_report", scene, kind, confidence: 0.93, name, client_id: "shot" }),
  }).then((r) => r.json());

await reset();
const b = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--window-size=1600,900"],
});
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 900 });
await p.goto(`${BASE}/cinematic.html?scene=${scene}&q=high&look=night`, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(30000);
await p.screenshot({ path: `shots/consult_${scene}_0_idle.png` });

const res = await send();
console.log("command:", res);
await sleep(2200);
await p.screenshot({ path: `shots/consult_${scene}_1_verdict.png` });
await sleep(5200);
await p.screenshot({ path: `shots/consult_${scene}_2_dispatch.png` });
await sleep(7000);
await p.screenshot({ path: `shots/consult_${scene}_3_after.png` });
const state = await p.evaluate(() => {
  const rows = [...document.querySelectorAll("#visitorRows .v-row")].map((n) => n.textContent.trim());
  return {
    on: document.getElementById("visitorToast")?.classList.contains("on"),
    title: document.getElementById("visitorTitle")?.textContent,
    scene: document.getElementById("visitorScene")?.textContent,
    main: document.getElementById("visitorMain")?.textContent,
    verdict: document.getElementById("visitorVerdict")?.textContent,
    rows,
    chain: [...document.querySelectorAll("#chain .ch-step")].map((n) => n.className),
    deck: [...document.querySelectorAll("#deck .dk-card")].map((n) => n.className),
    feed: document.getElementById("feedRows")?.textContent?.slice(0, 120),
  };
});
console.log(JSON.stringify(state, null, 2));
await b.close();
