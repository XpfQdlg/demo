/**
 * 皮肤改版用的结构探测：把手机端几个动态渲染区块的 DOM 骨架打出来，
 * 方便按真实类名写 theme_mono.css，而不是照着截图猜。
 *
 *   node tools/checks/_dom_dump.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--mute-audio"],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto("http://localhost:5179/mobile.html", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));

/* 只保留标签名 + class，文字截断，压缩成一行好读 */
const skeleton = `(el) => {
  if (!el) return "(未找到)";
  const walk = (n, d) => {
    if (n.nodeType !== 1) return "";
    const cls = (n.className && typeof n.className === "string" ? n.className.trim() : "")
      .split(/\\s+/).filter(Boolean).slice(0, 6).join(".");
    let t = "";
    for (const c of n.childNodes) if (c.nodeType === 3) t += c.textContent;
    t = t.replace(/\\s+/g, " ").trim().slice(0, 28);
    const head = "  ".repeat(d) + n.tagName.toLowerCase() + (cls ? "." + cls : "") + (t ? " \\"" + t + "\\"" : "");
    const kids = [...n.children].map((c) => walk(c, d + 1)).filter(Boolean).join("\\n");
    return head + (kids ? "\\n" + kids : "");
  };
  return walk(el, 0);
}`;

const targets = {
  feedItem: "#list > *",
  levelMini: "#level-mini",
  meBoard: "#me-board > *",
  chainList: "#models-tab-chain > *",
  modelChip: "#models-tab-grid > *",
  sheet: "#sheet-panel",
  quizPanel: "#quiz .quiz-panel",
  voicePanel: "#voice .voice-panel",
  arPanel: "#ar .ar-panel",
  joinPanel: "#join .join-panel",
  meCard: ".me-card",
  battleCard: ".battle-card",
  entryCard: ".entry-card",
  joinCta: ".join-cta",
  tabbar: "#tabbar",
  filter: ".filters",
  stat: ".stat",
};

for (const [name, sel] of Object.entries(targets)) {
  const html = await page.evaluate(`(${skeleton})(document.querySelector(${JSON.stringify(sel)}))`);
  console.log("\n===== " + name + " (" + sel + ") =====");
  console.log(html || "(未找到)");
}

await browser.close();
