import { defineConfig } from "vite";
import { alert_bus_plugin } from "./tools/alert_bus.mjs";

/* 根路径直接跳观感版。展台上只展示一个页面，避免有人打开根地址看到另一套旧观感。
   要恢复入口页，把下面这个插件从 plugins 里去掉即可。 */
function redirect_root(req, res, next) {
  const url = (req.url || "").split("?")[0];
  /* 只重定向根地址。不要把 /index.html 也跳走，
     否则联动指挥主演示在开发服里没有任何入口，验收脚本也打不开 */
  if (url === "/") {
    res.writeHead(302, { Location: "/cinematic.html?scene=campus" });
    res.end();
    return;
  }
  next();
}

const root_to_cinematic = {
  name: "root-to-cinematic",
  configureServer(server) {
    server.middlewares.use(redirect_root);
  },
  /* preview 用构建产物时根地址也要跳观感版，不然打开的是旧主演示 */
  configurePreviewServer(server) {
    server.middlewares.use(redirect_root);
  },
};

/* 手机预警页的短地址：二维码里放 /phone 比 /mobile.html 短，
   扫出来不占二维码密度，讲解时也好念。开发服与 preview 都要生效。 */
const phone_entry = {
  name: "phone-entry",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (url === "/tablet" || url === "/console") {
        res.writeHead(302, { Location: "/tablet.html" });
        res.end();
        return;
      }
      if (url === "/phone" || url === "/mobile") {
        res.writeHead(302, { Location: "/mobile.html" });
        res.end();
        return;
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (url === "/tablet" || url === "/console") {
        res.writeHead(302, { Location: "/tablet.html" });
        res.end();
        return;
      }
      if (url === "/phone" || url === "/mobile") {
        res.writeHead(302, { Location: "/mobile.html" });
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  /* 本地默认相对路径；部署到子路径时用 AEGIS_BASE=/aegis/ 构建 */
  base: process.env.AEGIS_BASE || "./",
  /* 第三个插件是手机与大屏之间的本机联动总线，见 tools/alert_bus.mjs */
  plugins: [root_to_cinematic, phone_entry, alert_bus_plugin()],
  server: {
    // 编辑器写入会经过临时目录，chokidar 在 Windows 上会 EBUSY，因此只监听源码树
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/.*.tmpdir/**",
        "**/.*.tmp",
        "**/_*.png",
        /* 打包与验收脚本的产物目录：npm run bundle 会先建 dist-single 再删，
           watcher 正好逮到被删/被占用的 webp 就 EBUSY 整个服务器崩掉 */
        "**/dist-single/**",
        "**/dist/**",
        "**/shots/**",
      ],
    },
    port: 5179,
    strictPort: true,
    /* 0.0.0.0：局域网里的手机、另一台电脑也能打开。
       原先是 localhost，只绑回环，只有本机能访问 */
    host: "0.0.0.0",
  },
  preview: {
    /* preview 也绑 0.0.0.0，用构建产物演示时手机照样能连预警页 */
    port: 5179,
    strictPort: true,
    host: "0.0.0.0",
  },
  build: {
    target: "es2020",
    /* 公网部署按文件发，字体/图片可缓存；单文件包用 vite.single.config.js 单独内联 */
    /* 每个入口单独出 CSS：手机页与大屏页的 :root 变量不同，
       合并成一份时后者的 --font 会把大屏盖掉（公网部署踩过）。 */
    cssCodeSplit: true,
    chunkSizeWarningLimit: 3000,
    /* 三个页面：联动指挥演示（index）、观感版（cinematic）、手机预警接收（mobile） */
    rollupOptions: {
      input: {
        index: "index.html",
        cinematic: "cinematic.html",
        mobile: "mobile.html",
        tablet: "tablet.html",
      },
    },
  },
});
