/**
 * 把观感版（最终产物）打成单文件 HTML：内联 JS、CSS、favicon 与全部 PBR 贴图。
 * 双击即开，断网、没装 Node、端口被占用都能用。
 *
 * 用法：
 *   node tools/bundle.mjs            构建并打包
 *   node tools/bundle.mjs --clean    打包后删掉 dist-single
 *
 * 输出：command_demo/观感版演示.html
 *
 * 为什么要单独一套 vite 配置：主配置有 index 与 cinematic 两个入口，
 * 共用代码会被拆成独立 chunk；单文件里的行内模块不能再 import 外部 chunk。
 * vite.single.config.js 只留一个入口并开启 inlineDynamicImports。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const distName = "dist-single";
const dist = join(root, distName);
const OUT = join(root, "观感版演示.html");

console.log("· building …");
execFileSync(nodeBin, [viteBin, "build", "--config", "vite.single.config.js", "--logLevel", "warn"], {
  cwd: root,
  stdio: "inherit",
});

let html = readFileSync(join(dist, "cinematic.html"), "utf8");
const assetsDir = join(dist, "assets");
const files = existsSync(assetsDir) ? readdirSync(assetsDir) : [];

const MIME = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const mime_of = (f) => MIME[extname(f).toLowerCase()] || "application/octet-stream";
const data_uri = (abs) => `data:${mime_of(abs)};base64,${readFileSync(abs).toString("base64")}`;

/* ── 1. 内联 assets 目录里的 JS / CSS / 图片 ─────────────────────── */
for (const f of files) {
  const full = join(assetsDir, f);
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (f.endsWith(".js")) {
    const code = readFileSync(full, "utf8");
    const re = new RegExp(`<script[^>]*src="[^"]*${esc}"[^>]*></script>`);
    if (!re.test(html)) console.warn("!! 找不到 script 标签:", f);
    html = html.replace(re, () => `<script type="module">\n${code}\n</script>`);
  } else if (f.endsWith(".css")) {
    const css = readFileSync(full, "utf8");
    const re = new RegExp(`<link[^>]*href="[^"]*${esc}"[^>]*>`);
    if (!re.test(html)) console.warn("!! 找不到 link 标签:", f);
    html = html.replace(re, () => `<style>\n${css}\n</style>`);
  } else if (MIME[extname(f).toLowerCase()]) {
    const uri = data_uri(full);
    html = html.split(`./assets/${f}`).join(uri).split(`/assets/${f}`).join(uri);
  }
}

/* ── 2. favicon 内联，避免 file:// 下留一个 404 ──────────────────── */
const favicon = join(dist, "favicon.svg");
if (existsSync(favicon)) {
  html = html.split("./favicon.svg").join(data_uri(favicon));
}

/* ── 3. public/cinematic 贴图 + public/photos 现场照 → 内联表 ─────────
   键与源码里的相对路径一致，例如 cinematic/materials/asphalt/color.webp、
   photos/campus-road-1.jpg。pbr.js 的 asset_url() 与 views/evidence.js
   的 resolve_photo() 都优先查这张表，其次才退回 document.baseURI。
   file:// 下直接读本地图片会触发跨源限制，WebGL 上传纹理会失败。 */
const inline = {};
for (const sub of ["cinematic", "photos"]) {
  const dir = join(dist, sub);
  if (!existsSync(dir)) continue;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else inline[relative(dist, full).split("\\").join("/")] = data_uri(full);
    }
  };
  walk(dir);
}
const keys = Object.keys(inline);
if (!keys.length) console.warn("!! cinematic 素材目录为空");
const payload = JSON.stringify(inline);
html = html.replace(
  '<script type="module">',
  `<script>window.__INLINE_ASSETS=${payload};</script>\n<script type="module">`
);

/* ── 4. 残留外链检查 ─────────────────────────────────────────────── */
const leftovers = [...html.matchAll(/["'(](\.?\/?assets\/[^"')]+)["')]/g)].map((m) => m[1]);
if (leftovers.length) console.warn("!! 仍有 assets 外链:", [...new Set(leftovers)]);

writeFileSync(OUT, html, "utf8");
const mb = (Buffer.byteLength(html, "utf8") / 1048576).toFixed(1);
console.log(`✓ ${OUT}  (${mb} MB, 内联 ${keys.length} 个素材, 无外部依赖)`);

if (process.argv.includes("--clean")) {
  rmSync(dist, { recursive: true, force: true });
  console.log("· dist-single removed");
}
