/* 公网 API 进程：只跑总线，不托管静态文件。
   nginx 把 /api/ 反代到这里，静态页面由 nginx 直接发。 */
import http from "node:http";
import { alert_bus_plugin } from "./alert_bus.mjs";

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || "127.0.0.1";
/* 手机二维码的基址：join.js 会在后面拼 /phone */
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://blog.srlove.top/aegis").replace(/\/+$/, "");

const handlers = [];
alert_bus_plugin().configurePreviewServer({
  middlewares: {
    use(fn) {
      handlers.push(fn);
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

const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];

  /* 公网没有局域网网卡的概念，二维码固定指向对外域名 */
  if (path === "/api/alerts/info") {
    json(res, 200, { ok: true, urls: [PUBLIC_ORIGIN], public: true });
    return;
  }

  let i = 0;
  const next = () => {
    const fn = handlers[i++];
    if (fn) {
      try {
        fn(req, res, next);
      } catch (err) {
        if (!res.headersSent) json(res, 500, { ok: false, error: String(err?.message || err) });
      }
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  };
  next();
});

server.listen(PORT, HOST, () => {
  console.log(`aegis api on http://${HOST}:${PORT}  qr=${PUBLIC_ORIGIN}/phone`);
});
