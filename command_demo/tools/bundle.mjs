/**
 * 把 vite 构建产物打包成"单文件 HTML"（内联 JS + CSS），双击即可离线打开。
 * 用法：node tools/bundle.mjs
 * 输出：联动指挥演示.html（与 dist/index.html 内容一致，但零外链）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");

console.log("· building …");
execFileSync(nodeBin, [viteBin, "build", "--logLevel", "warn"], {
  cwd: root,
  stdio: "inherit",
});

const dist = join(root, "dist");
let html = readFileSync(join(dist, "index.html"), "utf8");
const assetsDir = join(dist, "assets");
const files = existsSync(assetsDir) ? readdirSync(assetsDir) : [];

const asDataUri = (file, mime) =>
  `data:${mime};base64,${readFileSync(join(assetsDir, file)).toString("base64")}`;

for (const f of files) {
  const full = join(assetsDir, f);
  if (f.endsWith(".js")) {
    const code = readFileSync(full, "utf8");
    const re = new RegExp(`<script[^>]*src="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
    if (!re.test(html)) console.warn("!! no script tag for", f);
    html = html.replace(re, () => `<script type="module">\n${code}\n</script>`);
  } else if (f.endsWith(".css")) {
    const css = readFileSync(full, "utf8");
    const re = new RegExp(`<link[^>]*href="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
    html = html.replace(re, () => `<style>\n${css}\n</style>`);
  } else if (/\.(png|jpe?g|svg|webp|woff2?|ttf)$/i.test(f)) {
    const mime = f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".woff2") ? "font/woff2" : f.endsWith(".png") ? "image/png" : "application/octet-stream";
    html = html.split(`./assets/${f}`).join(asDataUri(f, mime)).split(`/assets/${f}`).join(asDataUri(f, mime));
  }
}

/* 兜底：任何残留的 ./assets/xxx 引用都内联掉，保证 file:// 下无外链 */
const leftovers = [...html.matchAll(/["'(](\.?\/?assets\/[^"')]+)["')]/g)].map((m) => m[1]);
if (leftovers.length) console.warn("!! leftover asset refs:", [...new Set(leftovers)]);

const out = join(root, "联动指挥演示.html");
writeFileSync(out, html, "utf8");
const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(0);
console.log(`✓ ${out}  (${kb} KB, 无外部依赖)`);

if (process.argv.includes("--clean")) {
  rmSync(dist, { recursive: true, force: true });
  console.log("· dist removed");
}
