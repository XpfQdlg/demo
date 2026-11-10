/**
 * 观感版自动验收：不靠人看截图，直接断言运行时状态。
 *
 *   npm run check                四场景冒烟 + 调度算法 + 绘制预算
 *   npm run check -- --only=campus
 *   npm run check -- --url=http://localhost:5179
 *
 * 需要开发服在跑（npm run dev）。检查项：
 *   1. 四个场景都能进：__cine/__monitor 就位、设备数 > 0、没有 pageerror；
 *   2. 大屏 DOM：四张模型卡、上报回执初始隐藏、事件流容器在位；
 *   3. 调度口径：shortest_route 的选择必须等于暴力枚举 A* 折线最短的那台，
 *      防止「剪枝写错 → 选了更远的一台」这类回归；
 *   4. 绘制预算：材质数、网格数、每帧 draw call 不超过本轮优化后的水位
 *      （2026-11-10 从 1797 材质 / 1815 网格降到 912 / 929，别涨回去）；
 *   5. 默认 maquette 下 bloom 不该开启（强度 0.06，肉眼也看不出）。
 *
 * 任何一项失败退出码为 1，可直接接 CI。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};

const BASE = arg("url", "http://localhost:5179").replace(/\/+$/, "");
const ONLY = arg("only", "");
const SCENES = ONLY ? [ONLY] : ["campus", "community", "forest", "subway"];

/* 本轮优化后的水位。留 10% 余量：素材换版会小幅波动，但涨回 1500 材质
   就说明又有地方在逐网格 clone 材质了。材质按「网格引用数」计，
   合并前是 1797，合并后 1047。 */
const BUDGET = { materials: 1200, meshes: 1200, calls_per_frame: 1900 };

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error("找不到 Microsoft Edge");
  process.exit(1);
}

const fails = [];
const notes = [];
function check(ok, label, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ""}`);
    fails.push(label + (detail ? ` (${detail})` : ""));
  }
}

/* 开发服没起时给出人话提示，而不是 puppeteer 的 ECONNREFUSED 堆栈 */
try {
  const res = await fetch(`${BASE}/cinematic.html`, { method: "HEAD" });
  if (!res.ok) throw new Error(String(res.status));
} catch (e) {
  console.error(`开发服不可用：${BASE}（${e.message}）`);
  console.error("先运行 npm run dev，或改用 --url= 指定地址");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
});

for (const scene of SCENES) {
  console.log(`\n[${scene}]`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    /* 字体/贴图 404 在这套静态资源里不会出现；真出现就该失败 */
    errors.push(`console: ${t.slice(0, 200)}`);
  });

  await page.goto(`${BASE}/cinematic.html?scene=${scene}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  let booted = true;
  try {
    await page.waitForFunction("window.__cine && window.__monitor", { timeout: 60000 });
  } catch {
    booted = false;
  }
  check(booted, "场景启动（__cine / __monitor 就位）");
  if (!booted) {
    await page.close();
    continue;
  }

  /* 场景网格是异步搭的：先等一帧，再等 agents 稳定下来 */
  await page.waitForFunction("window.__monitor.agents.length > 0", { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const st = await page.evaluate(() => {
    const m = window.__monitor;
    return {
      agents: m.agents.length,
      cams: m.cameras?.length ?? 0,
      cards: document.querySelectorAll("#deck .dk-card").length,
      ping_on: document.getElementById("visitorPing")?.classList.contains("on") ?? null,
      feed: !!document.querySelector("#feed"),
      canvas: !!document.querySelector("canvas"),
      three: window.__cine_three?.REVISION ?? null,
    };
  });

  check(st.canvas, "WebGL 画布存在");
  check(st.agents > 0, "设备已布场", `agents=${st.agents}`);
  check(st.cams > 0, "监控点位已布场", `cams=${st.cams}`);
  check(st.cards === 4, "四张模型卡", `cards=${st.cards}`);
  check(st.ping_on === false, "上报回执初始隐藏");
  check(st.feed, "事件流容器在位");

  /* ── 调度口径：与暴力枚举对拍 ─────────────────────────────────────── */
  const routecheck = await page.evaluate(async () => {
    const { shortest_route } = await import("/src/map/choose.js");
    const { route, route_length } = await import("/src/map/routes.js");
    const agents = window.__monitor.agents.filter((a) => a.status === "idle");
    if (agents.length < 2) return { skipped: true, why: `idle=${agents.length}` };

    /* 目标点选设备自己的位置与两点中点：一定落在可走网格上 */
    const goals = [
      { x: agents[0].x, y: agents[0].y },
      { x: agents.at(-1).x, y: agents.at(-1).y },
      { x: (agents[0].x + agents.at(-1).x) / 2, y: (agents[0].y + agents.at(-1).y) / 2 },
    ];

    const rows = [];
    for (const goal of goals) {
      const brute = [];
      agents.forEach((a, idx) => {
        const path = route({ x: a.x, y: a.y }, goal, window.__monitor.scene, a.type);
        if (!path || path.length < 2) return;
        const gap = Math.hypot(path[0][0] - a.x, path[0][1] - a.y);
        brute.push({ idx, len: route_length(path) + gap });
      });
      if (!brute.length) continue;
      const min = Math.min(...brute.map((b) => b.len));
      const chosen = shortest_route(agents, goal, window.__monitor.scene);
      rows.push({
        min,
        chosen: chosen ? chosen.len_px : null,
        best_idxs: brute.filter((b) => b.len <= min + 0.01).map((b) => b.idx),
        got: chosen ? agents.indexOf(chosen.agent) : -1,
      });
    }
    return { rows };
  });

  if (routecheck.skipped) {
    notes.push(`[${scene}] 调度对拍跳过：${routecheck.why}`);
  } else {
    for (const [i, r] of routecheck.rows.entries()) {
      check(
        r.chosen != null && Math.abs(r.chosen - r.min) < 0.01 && r.best_idxs.includes(r.got),
        `调度选的是最短折线（目标 ${i + 1}）`,
        `min=${r.min?.toFixed(1)} chosen=${r.chosen?.toFixed(1)} agent#${r.got}`
      );
    }
  }

  /* ── 绘制预算：连采 4 帧求平均，避开阴影隔帧重绘造成的锯齿 ───────── */
  const perf = await page.evaluate(async () => {
    const cine = window.__cine;
    const info = cine.renderer.info;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    info.autoReset = false;
    const frames = 4;
    info.reset();
    for (let i = 0; i < frames; i++) await frame();
    const calls = info.render.calls / frames;
    const meshes = cine.scene.getObjectByProperty("isMesh", true)
      ? (() => {
          let n = 0;
          cine.scene.traverse((o) => {
            if (o.isMesh) n++;
          });
          return n;
        })()
      : 0;
    let materials = 0;
    cine.scene.traverse((o) => {
      if (o.isMesh && o.material) materials += Array.isArray(o.material) ? o.material.length : 1;
    });
    const out = {
      calls: Math.round(calls),
      meshes,
      /* 材质引用数（逐网格累加）。three r169 的 info.memory 只有
         geometries/textures，没有材质计数，只能自己数。 */
      materials,
      material_refs: materials,
      bloom: cine.bloom?.enabled ?? null,
      shadow: cine.sun?.shadow?.mapSize?.x ?? null,
    };
    info.autoReset = true;
    return out;
  });

  check(perf.materials <= BUDGET.materials, "材质数在预算内", `${perf.materials} ≤ ${BUDGET.materials}`);
  check(perf.meshes <= BUDGET.meshes, "网格数在预算内", `${perf.meshes} ≤ ${BUDGET.meshes}`);
  check(
    perf.calls > 0 && perf.calls <= BUDGET.calls_per_frame,
    "每帧 draw call 在预算内",
    `${perf.calls} ≤ ${BUDGET.calls_per_frame}`
  );
  check(perf.bloom === false, "默认 maquette 下 bloom 关闭");
  check(perf.shadow === 2048, "阴影贴图 2048", `shadow=${perf.shadow}`);
  notes.push(`[${scene}] ${JSON.stringify(perf)}`);

  check(errors.length === 0, "无页面报错", errors.slice(0, 3).join(" | "));

  await page.close();
}

await browser.close();

console.log("\n── 摘要 ──");
for (const n of notes) console.log("  " + n);
if (fails.length) {
  console.error(`\n✗ ${fails.length} 项失败：`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log("\n✓ 全部通过");
