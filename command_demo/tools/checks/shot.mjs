/**
 * 无头浏览器验收：截图 + 收集控制台错误。
 *
 * 用法：
 *   node tools/checks/shot.mjs --url=http://localhost:5179/index.html --out=shots/a.png
 *   node tools/checks/shot.mjs --url=... --out=... --eval="__app.set_overview()" --after=1500
 *
 * 需要系统已安装 Microsoft Edge。本机 Edge 在 x86 目录下。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=([\s\S]*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const url = args.url || "http://localhost:5179/index.html";
const out = args.out || "shots/_shot.png";
const wait = Number(args.wait || 3000);
const W = Number(args.w || 1600);
const H = Number(args.h || 900);

const logs = [];
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--disable-gpu-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    `--window-size=${W},${H}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") logs.push(`[${t}] ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, wait));

  if (args.eval) {
    const res = await page.evaluate((code) => {
      try {
        const v = eval(code);
        return v === undefined ? "ok" : JSON.stringify(v).slice(0, 3000);
      } catch (e) {
        return "EVAL_ERROR: " + e.message;
      }
    }, args.eval);
    console.log("EVAL:", res);
    await new Promise((r) => setTimeout(r, Number(args.after || 1200)));
  }

  const stats = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return {
      canvas: c ? `${c.width}x${c.height}` : "none",
      fps: document.getElementById("statusFps")?.textContent || "—",
      agent: document.getElementById("statusAgent")?.textContent || "—",
      mode: document.getElementById("statusMode")?.textContent || "—",
    };
  });
  console.log("PAGE:", JSON.stringify(stats));

  fs.mkdirSync(out.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await page.screenshot({ path: out });
  console.log("SHOT:", out);
} finally {
  console.log(logs.length ? "LOGS:\n" + logs.slice(0, 40).join("\n") : "LOGS: (clean)");
  await browser.close();
}
