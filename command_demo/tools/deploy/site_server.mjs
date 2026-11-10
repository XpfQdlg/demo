/**
 * AEGIS 展台站点（端口 2026）的独立服务进程。
 *
 * 服务器上没有 nginx，就一个 Node 进程做三件事：
 *   1. 发静态文件（Vite 构建产物，部署在 ./site）；
 *   2. 短地址： /            → /cinematic.html?scene=campus
 *                 /phone /mobile → /mobile.html
 *                 /tablet /console → /tablet.html
 *   3. 挂手机↔大屏的联动总线（./alert_bus.mjs），并覆写 /api/alerts/info，
 *      让二维码指向公网地址而不是服务器的内网网卡。
 *
 * 启动：node /opt/aegis2026/server.mjs
 * 环境变量：PORT（默认 2026）、HOST（默认 0.0.0.0）
 *          PUBLIC_ORIGINS（逗号分隔的对外基址，二维码按访客用的那个回；第一个是兜底）
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { alert_bus_plugin } from "./alert_bus.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "site");
const PORT = Number(process.env.PORT || 2026);
const HOST = process.env.HOST || "0.0.0.0";
/* 对外基址可以有多个：域名和 IP:端口 并存时，二维码跟访客用的地址保持一致，
   免得在 agikid.com 上打开却扫出一串 IP。PUBLIC_ORIGIN 仍兼容老写法。 */
const PUBLIC_ORIGINS = (process.env.PUBLIC_ORIGINS || process.env.PUBLIC_ORIGIN || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function origin_for(req) {
  const host = String(req.headers.host || "").toLowerCase();
  for (const origin of PUBLIC_ORIGINS) {
    try {
      if (new URL(origin).host.toLowerCase() === host) return origin;
    } catch {
      /* 写坏的条目直接跳过，不影响兜底 */
    }
  }
  return PUBLIC_ORIGINS[0] || "";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const SHORT = {
  "/phone": "/mobile.html",
  "/mobile": "/mobile.html",
  "/tablet": "/tablet.html",
  "/console": "/tablet.html",
};

/* 文本类资源压缩后再发：公网带宽只有几 Mbps，构建产物里
   crowd 那个 chunk 有 845 KB，gzip 后不到 220 KB。 */
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt)$/i;
const gz_cache = new Map();

/* 联动总线的中间件是按 Vite 插件的形状写的，这里用同样的办法把它取出来 */
const api = [];
alert_bus_plugin().configurePreviewServer({
  middlewares: {
    use(fn) {
      api.push(fn);
    },
  },
});

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(data);
}

function not_found(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("404");
}

function serve_file(req, res, file, pathname) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      not_found(res);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = pathname.startsWith("/assets/");
    const headers = {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": immutable ? "public, max-age=604800, immutable" : "no-cache",
    };

    const wants_gzip = (req.headers["accept-encoding"] || "").includes("gzip");
    if (wants_gzip && COMPRESSIBLE.test(ext)) {
      const hit = gz_cache.get(file);
      if (hit && hit.mtime === st.mtimeMs) {
        res.writeHead(200, {
          ...headers,
          "content-encoding": "gzip",
          "content-length": hit.buf.length,
          vary: "Accept-Encoding",
        });
        res.end(req.method === "HEAD" ? undefined : hit.buf);
        return;
      }
      fs.readFile(file, (read_err, raw) => {
        if (read_err) {
          not_found(res);
          return;
        }
        const buf = zlib.gzipSync(raw, { level: 9 });
        gz_cache.set(file, { mtime: st.mtimeMs, buf });
        res.writeHead(200, {
          ...headers,
          "content-encoding": "gzip",
          "content-length": buf.length,
          vary: "Accept-Encoding",
        });
        res.end(req.method === "HEAD" ? undefined : buf);
      });
      return;
    }

    res.writeHead(200, { ...headers, "content-length": st.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD" && !req.url.startsWith("/api/")) {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    not_found(res);
    return;
  }

  if (pathname === "/") {
    res.writeHead(302, { location: "/cinematic.html?scene=campus" });
    res.end();
    return;
  }

  if (SHORT[pathname]) {
    res.writeHead(302, { location: SHORT[pathname] });
    res.end();
    return;
  }

  /* 页面已经用 favicon.svg，浏览器仍会顺手要一次 .ico，给个空响应免得控制台报 404 */
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  /* 公网部署没有「局域网网卡」这回事：二维码按访客进来的地址给 */
  if (pathname === "/api/alerts/info") {
    const origin = origin_for(req);
    if (origin) {
      json(res, 200, { ok: true, urls: [origin], public: true });
      return;
    }
  }

  if (pathname.startsWith("/api/")) {
    let i = 0;
    const next = () => {
      const fn = api[i++];
      if (!fn) {
        json(res, 404, { ok: false, error: "no route" });
        return;
      }
      fn(req, res, next);
    };
    next();
    return;
  }

  /* 静态文件：解析后必须还在 site/ 里，防止 ../ 穿越 */
  const file = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    not_found(res);
    return;
  }
  serve_file(req, res, file, pathname);
});

server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => {
  console.log(`aegis site listening on http://${HOST}:${PORT}  root=${ROOT}`);
  if (PUBLIC_ORIGINS.length) console.log(`public origins for QR: ${PUBLIC_ORIGINS.join(", ")}`);
});
