/**
 * 精简版手机页验收：两道屏 + 详情抽屉 + 上报流程。
 *
 *   node tools/checks/_min_probe.mjs
 *
 * 输出（shots/）：
 *   min_alerts.png   现场预警
 *   min_sheet.png    点第一条卡片后的详情（含现场照片）
 *   min_report.png   上报页（未拍照）
 *   min_verdict.png  选了演示照片后的会诊结果
 *   min_sent.png     上报成功后的提示 + 回到预警页
 *
 * 同时打印控制台错误、照片库加载情况、上报请求的结果。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:5179";
const WAIT = Number(process.env.WAIT || 6000);

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const logs = [];
const posts = [];

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  args: ["--hide-scrollbars", "--mute-audio", "--window-size=390,844"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") logs.push(`[${t}] ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", async (r) => {
    if (r.url().includes("/api/commands") && r.request().method() === "POST") {
      posts.push(`${r.status()} ${await r.text().catch(() => "")}`.slice(0, 200));
    }
  });

  await page.goto(`${BASE}/mobile.html`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(WAIT);

  const info = await page.evaluate(() => ({
    conn: document.getElementById("conn-text")?.textContent,
    mode: document.getElementById("conn")?.dataset.mode,
    cards: document.querySelectorAll("#list .card").length,
    empty: !!document.querySelector("#list .empty"),
    hint: document.getElementById("list-hint")?.textContent,
    stats: [...document.querySelectorAll(".stats b")].map((n) => n.textContent).join("/"),
    scene: document.getElementById("scene-name")?.textContent,
    photos: window.__photos || "n/a",
  }));
  console.log("PAGE:", JSON.stringify(info));

  const shot = async (name) => {
    fs.mkdirSync("shots", { recursive: true });
    await page.screenshot({ path: `shots/${name}.png` });
    console.log("SHOT:", `shots/${name}.png`);
  };

  await shot("min_alerts");

  /* 详情抽屉 */
  if (info.cards > 0) {
    await page.click("#list .card");
    await sleep(900);
    const sheet = await page.evaluate(() => ({
      on: document.getElementById("sheet")?.classList.contains("is-on"),
      title: document.getElementById("sheet-title")?.textContent,
      img: (() => {
        const i = document.getElementById("sheet-img");
        return i && !i.hidden ? `${i.naturalWidth}x${i.naturalHeight} ${i.currentSrc.split("/").pop()}` : "no-photo";
      })(),
      rows: document.querySelectorAll("#sheet-rows dd").length,
      phases: document.querySelectorAll("#sheet-phases .done").length,
    }));
    console.log("SHEET:", JSON.stringify(sheet));
    await shot("min_sheet");
    await page.click("#sheet .close");
    await sleep(500);
  }

  /* 上报页 */
  await page.click('.tabbar button[data-screen="report"]');
  await sleep(700);
  await shot("min_report");

  const demo = await page.evaluate(() => {
    const b = document.getElementById("btn-demo");
    return { disabled: b.disabled, hint: document.getElementById("photo-hint").textContent };
  });
  console.log("DEMO:", JSON.stringify(demo));

  if (!demo.disabled) {
    await page.click("#btn-demo");
    await sleep(900);
    const verdict = await page.evaluate(() => {
      const v = document.getElementById("verdict");
      const img = document.getElementById("shot-img");
      return {
        shown: v && !v.hidden,
        title: document.getElementById("verdict-title")?.textContent,
        model: document.getElementById("verdict-model")?.textContent,
        img: img && !img.hidden ? `${img.naturalWidth}x${img.naturalHeight}` : "none",
        send: document.getElementById("btn-send")?.textContent,
        sendDisabled: document.getElementById("btn-send")?.disabled,
      };
    });
    console.log("VERDICT:", JSON.stringify(verdict));
    await shot("min_verdict");

    await page.click("#btn-send");
    await sleep(1600);
    const after = await page.evaluate(() => ({
      screen: [...document.querySelectorAll(".screen.is-on")].map((n) => n.id).join(","),
      toast: document.getElementById("toast")?.textContent,
      toastOn: document.getElementById("toast")?.classList.contains("is-on"),
    }));
    console.log("AFTER-SEND:", JSON.stringify(after), "POST:", posts.join(" | ") || "none");
    await shot("min_sent");
  }
} finally {
  console.log(logs.length ? "LOGS:\n" + logs.slice(0, 40).join("\n") : "LOGS: (clean)");
  await browser.close();
}
