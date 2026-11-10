/**
 * 皮肤验收：手机端四个 Tab + 大屏各场景各拍一张，用来核对黑白主题有没有漏掉的彩色。
 *
 *   node tools/checks/_theme_probe.mjs mobile     只拍手机端四个 Tab
 *   node tools/checks/_theme_probe.mjs big        只拍大屏
 *   node tools/checks/_theme_probe.mjs all
 *
 * 输出到 shots/theme_*.png。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const what = process.argv[2] || "all";
const wait = Number(process.env.WAIT || 4000);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});

async function shot(page, out) {
  fs.mkdirSync("shots", { recursive: true });
  await page.screenshot({ path: out });
  console.log("SHOT:", out);
}

if (what === "mobile" || what === "all") {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 160)));
  await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, wait));

  for (const tab of ["alerts", "models", "join", "me"]) {
    const ok = await page.evaluate((t) => {
      const b = document.querySelector(`[data-tab="${t}"]`);
      if (!b) return false;
      b.click();
      return true;
    }, tab);
    if (!ok) {
      console.log("MISSING TAB:", tab);
      continue;
    }
    await new Promise((r) => setTimeout(r, 700));
    await shot(page, `shots/theme_mobile_${tab}.png`);
  }
  if (errs.length) console.log("LOGS:\n" + errs.slice(0, 6).join("\n"));
  await page.close();
}

if (what === "ov" || what === "all") {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 160)));
  await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, wait));

  /* 预警详情抽屉：点开第一张预警卡 */
  const cardOk = await page.evaluate(() => {
    const c = document.querySelector("#list .card");
    if (!c) return false;
    c.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 900));
  if (cardOk) await shot(page, "shots/theme_ov_sheet.png");
  await page.evaluate(() => document.querySelector("#sheet .btn-close")?.click());
  await new Promise((r) => setTimeout(r, 500));

  /* 四大模型总览 */
  await page.evaluate(() => document.getElementById("models-btn")?.click());
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, "shots/theme_ov_models.png");
  await page.evaluate(() => document.querySelector(".models-panel .icon-btn")?.click());
  await new Promise((r) => setTimeout(r, 500));

  /* 参与页四个入口 */
  await page.evaluate(() => document.querySelector('[data-tab="join"]')?.click());
  await new Promise((r) => setTimeout(r, 500));
  for (const [id, name] of [
    ["entry-photo", "join"],
    ["entry-voice", "voice"],
    ["entry-ar", "ar"],
    ["entry-quiz", "quiz"],
  ]) {
    const ok = await page.evaluate((i) => {
      const b = document.getElementById(i);
      if (!b) return false;
      b.click();
      return true;
    }, id);
    await new Promise((r) => setTimeout(r, 1100));
    if (ok) await shot(page, `shots/theme_ov_${name}.png`);
    await page.evaluate(() => {
      document.querySelectorAll(".join-panel .icon-btn, .voice-panel .icon-btn, .ar-panel .icon-btn, .quiz-panel .icon-btn").forEach((b) => b.click());
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  if (errs.length) console.log("LOGS:\n" + errs.slice(0, 6).join("\n"));
  await page.close();
}

if (what === "big" || what === "all") {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 160)));
  await page.goto("http://localhost:5179/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, Number(process.env.BIGWAIT || 26000)));
  await shot(page, "shots/theme_big_campus.png");

  /* 手机入口弹层：二维码是白底的，顺带看卡片皮肤 */
  await page.evaluate(() => document.getElementById("phoneBtn")?.click());
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, "shots/theme_big_phone.png");
  await page.evaluate(() => document.getElementById("phoneClose")?.click());
  await new Promise((r) => setTimeout(r, 500));

  /* 本场战报 */
  await page.evaluate(() => document.getElementById("battleBtn")?.click());
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, "shots/theme_big_battle.png");
  await page.evaluate(() => document.getElementById("battleClose")?.click());

  if (errs.length) console.log("LOGS:\n" + errs.slice(0, 6).join("\n"));
  await page.close();
}

await browser.close();
