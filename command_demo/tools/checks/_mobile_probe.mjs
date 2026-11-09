/**
 * 手机预警接收页的验收。
 *
 *   node tools/checks/_mobile_probe.mjs
 *
 * 两段：
 *   A. 实时链路 —— 页面连上总线后，从外部 POST 三条预警的不同状态，
 *      检查卡片、统计、筛选、未读角标、详情抽屉。
 *   B. 演示模式 —— 拦掉 /api/alerts，页面应落到演示模式，并随时间推进状态。
 *
 * 截图输出到 shots/mobile_*.png。前置：dev server 在 5179（npm run dev）。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome / Edge");
  process.exit(1);
}

const BASE = process.env.DEMO_BASE || "http://127.0.0.1:5179";
const MODE = process.argv[2] || "all";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 总线写手：模拟大屏推进一条完整生命周期 ─────────────────────────── */

async function reset_bus() {
  await fetch(`${BASE}/api/alerts/reset`, { method: "POST" });
}

function scene_event() {
  return { v: 1, type: "scene", scene: "campus", scene_label: "校园", ts: Date.now(), source: "probe" };
}

function event(type, inc, extra = {}) {
  return {
    v: 1,
    type,
    scene: "campus",
    scene_label: "校园",
    ts: Date.now(),
    source: "probe",
    incident: {
      id: inc.id,
      kind: inc.kind,
      name: inc.name,
      scene: "campus",
      scene_label: "校园",
      area: inc.area,
      camera: inc.camera,
      px: inc.px || [420, 320],
      level: inc.level,
    },
    ...extra,
  };
}

async function publish(events) {
  const res = await fetch(`${BASE}/api/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });
  if (!res.ok) throw new Error("bus publish failed: " + res.status);
}

const INC = {
  fire: { id: "probe-fire-1", kind: "fire", name: "明火", area: "教学区 12东侧", camera: "cam-1", level: 3 },
  crowd: { id: "probe-crowd-1", kind: "crowd", name: "人员聚集", area: "图书馆北侧", camera: "cam-2", level: 2 },
  trash: { id: "probe-trash-1", kind: "trash", name: "垃圾堆积", area: "宿舍区 19南侧", camera: "cam-3", level: 1 },
};

/* ── 浏览器 ──────────────────────────────────────────────────────────── */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"],
});

async function new_phone_page({ offline = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
  if (offline) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("/api/alerts")) req.abort();
      else req.continue();
    });
  }
  return { page, errs };
}

/* 过滤掉「连不上总线」这类浏览器网络层报错 */
const app_errs = (list) => list.filter((e) => !e.includes("Failed to load resource"));

/* ══════════════════════════════════════════════════════════════════════
   A. 实时链路
   ══════════════════════════════════════════════════════════════════════ */
if (MODE === "all" || MODE === "live") {
  await reset_bus();
  const { page, errs } = await new_phone_page();
  await page.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('#conn[data-mode="live"]', { timeout: 8000 }).catch(() => {});

  check("实时模式已连接", await page.$eval("#conn", (el) => el.dataset.mode === "live"));

  /* 三条预警、三种状态：一条闭环，一条处置中，一条待派单 */
  await publish([
    scene_event(),
    event("alarm", INC.fire, { note: "cam-1 自动识别" }),
    event("dispatched", INC.fire, {
      agent: { name: "dog-2", type: "dog" },
      distance_m: 28,
      eta_s: 19,
    }),
    event("arrive", INC.fire, { agent: { name: "dog-2", type: "dog" } }),
    event("handling", INC.fire, { agent: { name: "dog-2", type: "dog" } }),
    event("resolved", INC.fire, { agent: { name: "dog-2", type: "dog" } }),
    event("alarm", INC.crowd, { note: "cam-2 自动识别" }),
    event("dispatched", INC.crowd, {
      agent: { name: "person-1", type: "person" },
      distance_m: 41,
      eta_s: 33,
    }),
    event("alarm", INC.trash, { note: "cam-3 自动识别" }),
  ]);
  await sleep(900);

  const cards = await page.$$eval(".card", (nodes) =>
    nodes.map((n) => ({
      id: n.dataset.id,
      status: n.dataset.status,
      area: n.querySelector(".card-area")?.textContent.trim(),
      line: n.querySelector(".card-statusline")?.textContent.trim(),
    }))
  );
  check("三条预警都渲染出来", cards.length === 3, JSON.stringify(cards.map((c) => c.id)));
  check("状态各自正确", new Set(cards.map((c) => c.status)).size === 3, JSON.stringify(cards.map((c) => c.status)));
  check(
    "已处置排在进行中之后",
    cards.slice(0, 2).every((c) => c.status !== "resolved") && cards[2].status === "resolved"
  );
  check(
    "派单文案带设备与距离",
    cards.some((c) => c.id === "probe-crowd-1" && c.line.includes("person-1") && c.line.includes("41"))
  );

  /* 四模型应用：卡片带模型署名与置信度，场景条显示当前场景模型 */
  const model_line = await page
    .$eval('.card[data-id="probe-crowd-1"] .card-model', (el) => el.textContent.replace(/\s+/g, " ").trim())
    .catch(() => "");
  const scene_model = await page.$eval(".scene-model", (el) => el.textContent.trim()).catch(() => "");
  check("卡片带模型署名与置信度", model_line.includes("校园巡检模型") && /\d+%/.test(model_line), model_line);
  check("场景条显示当前场景模型", scene_model === "校园巡检模型", scene_model);

  const stats = await page.evaluate(() => ({
    pending: document.getElementById("stat-pending").textContent.trim(),
    handling: document.getElementById("stat-handling").textContent.trim(),
    resolved: document.getElementById("stat-resolved").textContent.trim(),
    today: document.getElementById("stat-today").textContent.trim(),
    unread: document.getElementById("unread-badge").hidden
      ? "0"
      : document.getElementById("unread-badge").textContent.trim(),
  }));
  check(
    "统计与未读角标准确",
    stats.pending === "1" && stats.handling === "1" && stats.resolved === "1" && stats.today === "3" && stats.unread === "2",
    JSON.stringify(stats)
  );

  await page.screenshot({ path: "shots/mobile_live_list.png" });

  /* 筛选 */
  await page.click('[data-filter="pending"]');
  await sleep(250);
  check("待处置筛选只剩一条", (await page.$$(".card")).length === 1);
  await page.click('[data-filter="resolved"]');
  await sleep(250);
  check("已处置筛选只剩一条", (await page.$$(".card")).length === 1);
  await page.click('[data-filter="all"]');
  await sleep(250);

  /* 详情抽屉 */
  await page.click('.card[data-id="probe-crowd-1"]');
  await sleep(450);
  const sheet = await page.evaluate(() => ({
    open: document.getElementById("sheet").classList.contains("is-open"),
    title: document.getElementById("sheet-title").textContent.trim(),
    timeline: document.querySelectorAll("#sheet-timeline li").length,
    info: document.getElementById("sheet-info").textContent.replace(/\s+/g, " ").trim(),
  }));
  check(
    "详情抽屉打开并带时间线",
    sheet.open && sheet.title.includes("图书馆北侧") && sheet.timeline >= 2,
    JSON.stringify({ open: sheet.open, title: sheet.title, timeline: sheet.timeline })
  );
  check("详情里有处置设备与距离", sheet.info.includes("person-1") && sheet.info.includes("41"));

  const model_sheet = await page.evaluate(() => ({
    chips: [...document.querySelectorAll("#sheet-models .model-chip")].map((chip) => ({
      name: chip.querySelector(".model-chip-name")?.textContent.trim(),
      tag: chip.querySelector(".model-chip-tag")?.textContent.trim(),
      main: chip.classList.contains("is-main"),
    })),
    chain: [...document.querySelectorAll("#sheet-chain .chain-step")].map((step) => step.className),
    conf: document.getElementById("analysis-confidence")?.textContent.trim(),
    rows: document.getElementById("analysis-rows")?.textContent.replace(/\s+/g, " ").trim(),
  }));
  check(
    "详情列出四个模型且当前模型主判",
    model_sheet.chips.length === 4 &&
      model_sheet.chips.filter((c) => c.main).length === 1 &&
      model_sheet.chips.find((c) => c.main)?.name === "校园巡检" &&
      model_sheet.chips.find((c) => c.main)?.tag === "主判",
    JSON.stringify(model_sheet.chips)
  );
  check(
    "详情应用链路四段",
    model_sheet.chain.length === 4 && model_sheet.chain[0].includes("chain-step"),
    JSON.stringify(model_sheet.chain)
  );
  check(
    "详情有置信度与研判理由/处置建议",
    /\d+%/.test(model_sheet.conf || "") &&
      (model_sheet.rows || "").includes("研判理由") &&
      (model_sheet.rows || "").includes("处置建议"),
    JSON.stringify({ conf: model_sheet.conf, rows: model_sheet.rows })
  );
  await page.screenshot({ path: "shots/mobile_live_detail.png" });
  await page.$eval("#sheet-close", (el) => el.click());
  await sleep(450);

  /* 顶栏「模型」：四模型应用总览 */
  await page.click("#models-btn");
  await page.waitForFunction(() => document.getElementById("models")?.classList.contains("is-open"), { timeout: 4000 });
  const overview = await page.evaluate(() => ({
    open: document.getElementById("models").classList.contains("is-open"),
    cards: [...document.querySelectorAll("#models-grid .model-card")].map((card) => ({
      model: card.dataset.model,
      current: card.classList.contains("is-current"),
      name: card.querySelector(".model-card-name")?.textContent.trim(),
      caps: card.querySelectorAll(".model-card-caps li").length,
      today: card.querySelector(".model-today-num")?.textContent.trim(),
    })),
    chain: document.querySelectorAll("#models-chain .chain-list-item").length,
    note: document.querySelector(".models-note")?.textContent.trim(),
  }));
  check("模型总览打开且列出四个模型", overview.open && overview.cards.length === 4, JSON.stringify(overview.cards.map((c) => c.model)));
  check(
    "当前场景模型高亮",
    overview.cards.filter((c) => c.current).length === 1 && overview.cards.find((c) => c.current)?.model === "campus",
    JSON.stringify(overview.cards.map((c) => ({ model: c.model, current: c.current })))
  );
  check("模型卡有能力清单", overview.cards.every((c) => c.caps >= 3));
  check("总览有应用链路四段与演示声明", overview.chain === 4 && /模拟/.test(overview.note || ""), JSON.stringify({ chain: overview.chain, note: overview.note }));
  await page.screenshot({ path: "shots/mobile_models_overview.png" });
  await page.click("#models-close");
  await page.waitForFunction(() => document.getElementById("models")?.hidden === true, { timeout: 4000 });

  /* 点开未读的待派单卡片后角标应减一。
     用 evaluate 里 click() 触发：抽屉收起有 300ms 过渡，遮罩还在时
     puppeteer 的坐标点击偶尔会判成不可点，这里测的是业务逻辑不是命中测试 */
  const unread_before = await page.$$eval("#unread-badge", (n) => (n[0].hidden ? 0 : +n[0].textContent));
  await page.$eval('.card[data-id="probe-trash-1"]', (el) => el.click());
  await sleep(400);
  await page.$eval("#sheet-close", (el) => el.click());
  await sleep(450);
  const unread_after = await page.$$eval("#unread-badge", (n) => (n[0].hidden ? 0 : +n[0].textContent));
  check("看过详情后未读减少", unread_after === unread_before - 1, `${unread_before} -> ${unread_after}`);

  /* 终态回归：已处置后再收到迟到的派单事件（模拟乱序），卡片不能退回进行中 */
  await publish([
    event("dispatched", INC.fire, { agent: { name: "dog-2", type: "dog" }, distance_m: 10, eta_s: 5 }),
  ]);
  await sleep(500);
  const fire_status = await page.$eval('.card[data-id="probe-fire-1"]', (el) => el.dataset.status);
  check("已处置是终态，迟到事件不回退", fire_status === "resolved", fire_status);
  await page.$eval('.card[data-id="probe-fire-1"]', (el) => el.click());
  await sleep(450);
  const timeline_tail = await page.$$eval("#sheet-timeline li", (nodes) =>
    nodes.map((n) => ({ label: n.querySelector(".tl-label")?.textContent.trim(), type: n.dataset.type }))
  );
  check(
    "迟到事件不进时间线",
    timeline_tail.length === 5 && timeline_tail.at(-1).label === "处置完成",
    JSON.stringify(timeline_tail)
  );
  await page.$eval("#sheet-close", (el) => el.click());
  await sleep(450);

  /* 场景本地化名回归：森林的 fire 叫「火险烟雾」。
     卡片 meta / 详情副标题 / 异常类型格都不能回退成通用「明火」 */
  const forest_inc = { id: "probe-forest-1", kind: "fire", name: "火险烟雾", area: "西山脊防火道", camera: "cam-1", level: 3 };
  await publish([
    { v: 1, type: "scene", scene: "forest", scene_label: "西山林区", ts: Date.now(), source: "probe" },
    {
      v: 1,
      type: "alarm",
      scene: "forest",
      scene_label: "西山林区",
      ts: Date.now(),
      source: "probe",
      note: "森林火险模型 · cam-1 自动识别",
      incident: {
        id: forest_inc.id,
        kind: forest_inc.kind,
        name: forest_inc.name,
        scene: "forest",
        scene_label: "西山林区",
        area: forest_inc.area,
        camera: forest_inc.camera,
        px: [252, 602],
        level: forest_inc.level,
      },
    },
  ]);
  await sleep(800);
  const forest_meta = await page
    .$eval('.card[data-id="probe-forest-1"] .card-meta', (el) => el.textContent.replace(/\s+/g, " ").trim())
    .catch(() => "");
  check("森林卡片显示本地化异常名", forest_meta.includes("火险烟雾") && !forest_meta.includes("明火"), forest_meta);
  await page.$eval('.card[data-id="probe-forest-1"]', (el) => el.click());
  await sleep(500);
  const forest_sheet = await page.evaluate(() => ({
    sub: document.getElementById("sheet-sub")?.textContent.replace(/\s+/g, " ").trim(),
    info: document.getElementById("sheet-info")?.textContent.replace(/\s+/g, " ").trim(),
    time: document.getElementById("sheet-timeline")?.textContent.replace(/\s+/g, " ").trim(),
  }));
  check(
    "森林详情显示本地化异常名",
    (forest_sheet.sub || "").includes("火险烟雾") &&
      (forest_sheet.info || "").includes("异常类型火险烟雾") &&
      (forest_sheet.time || "").includes("森林火险模型"),
    JSON.stringify(forest_sheet)
  );
  await page.$eval("#sheet-close", (el) => el.click());
  await sleep(450);

  const layout = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    sh: document.documentElement.scrollHeight,
  }));
  check("无横向滚动", layout.sw <= layout.iw, JSON.stringify(layout));
  check("实时链路无控制台报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));

  /* 桌面宽度看同一页面（展台预览/投屏） */
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false });
  await sleep(500);
  await page.screenshot({ path: "shots/mobile_desktop.png" });
  await page.close();
}

/* ══════════════════════════════════════════════════════════════════════
   B. 演示模式：拦掉总线，页面应自己落到 demo_feed
   ══════════════════════════════════════════════════════════════════════ */
if (MODE === "all" || MODE === "demo") {
  const { page, errs } = await new_phone_page({ offline: true });
  await page.goto(`${BASE}/mobile.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('#conn[data-mode="demo"]', { timeout: 8000 }).catch(() => {});
  check("总线不可用时进入演示模式", await page.$eval("#conn", (el) => el.dataset.mode === "demo"));

  await page.waitForSelector(".card", { timeout: 6000 }).catch(() => {});
  check("演示数据出新预警", (await page.$$(".card")).length >= 1);

  const banner = await page.evaluate(() => {
    const slot = document.getElementById("banner-slot");
    return { hidden: slot.hidden, text: slot.textContent.replace(/\s+/g, " ").trim() };
  });
  check("演示模式有明确标注", !banner.hidden && banner.text.includes("演示模式"), JSON.stringify(banner));

  /* 演示数据要真的在动：等到「有新卡片」或「状态推进到到场以后」。
     demo_feed 的赶路时间 9~35 秒、下一起 9~13 秒，最多等 22 秒。 */
  const before = await page.$$eval(".card", (nodes) => nodes.map((n) => n.dataset.status));
  let after = before;
  let advanced = false;
  for (let i = 0; i < 22; i++) {
    await sleep(1000);
    after = await page.$$eval(".card", (nodes) => nodes.map((n) => n.dataset.status));
    advanced =
      after.length > before.length ||
      after.some((s) => ["on_site", "handling", "resolved"].includes(s));
    if (advanced) break;
  }
  check("演示状态随时间推进", advanced, JSON.stringify({ before, after }));

  /* 演示模式应展示「校园巡检模型」，并自动轮换到「小区安防模型」 */
  const demo_model = await page.$eval(".scene-model", (el) => el.textContent.trim()).catch(() => "");
  check("演示模式首屏是校园巡检模型", demo_model === "校园巡检模型", demo_model);
  let switched = "";
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    switched = await page.$eval(".scene-model", (el) => el.textContent.trim()).catch(() => "");
    if (switched && switched !== "校园巡检模型") break;
  }
  /* 切场景后第一起预警有 ~1 秒延迟，给新卡片的模型署名留时间 */
  let demo_card_models = [];
  for (let i = 0; i < 10; i++) {
    await sleep(800);
    demo_card_models = await page.$$eval(".card-model-name", (nodes) => nodes.map((n) => n.textContent.trim()));
    if (demo_card_models.includes("小区安防模型")) break;
  }
  check(
    "演示模式会自动轮换到下一个场景模型",
    switched === "小区安防模型" && demo_card_models.includes("小区安防模型"),
    JSON.stringify({ switched, demo_card_models })
  );
  await page.screenshot({ path: "shots/mobile_demo_models.png" });
  await page.screenshot({ path: "shots/mobile_demo_list.png" });
  /* 演示模式本来就连不上总线，Chrome 会把连接失败记成一条 network 资源错误；
     这不是页面 JS 的错，验收只看应用层报错 */
  check("演示模式无应用层报错", app_errs(errs).length === 0, JSON.stringify(app_errs(errs)));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
