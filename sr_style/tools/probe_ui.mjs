import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push("ERR " + e.message));
page.on("console", (m) => errs.push(m.type().slice(0,3) + " " + m.text().slice(0,160)));
await page.goto("http://localhost:5181/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,24000));

console.log("before:", JSON.stringify(await page.evaluate(() => ({
  feedEl: !!document.getElementById("feedRows"),
  feedRows: document.querySelectorAll(".feed-row").length,
  agentRows: document.querySelectorAll(".agent-row").length,
  pills: [...document.querySelectorAll(".pill")].map(e=>e.textContent),
}))));

/* 点地面派单，制造一条事件流 */
await page.mouse.click(900, 600);
await new Promise((r)=>setTimeout(r,4000));

console.log("after:", JSON.stringify(await page.evaluate(() => ({
  feedRows: document.querySelectorAll(".feed-row").length,
  first: document.querySelector(".feed-row")?.textContent,
  pills: [...document.querySelectorAll(".pill")].map(e=>e.textContent),
  prog: [...document.querySelectorAll(".prog")].map(e=>e.style.width),
}))));
console.log("logs:", errs.slice(0,8));
await page.screenshot({ path: "shots/ui_check.png" });
await browser.close();
