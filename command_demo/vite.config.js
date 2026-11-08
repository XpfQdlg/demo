import { defineConfig } from "vite";

/* 根路径直接跳观感版。展台上只展示一个页面，避免有人打开根地址看到另一套旧观感。
   要恢复入口页，把下面这个插件从 plugins 里去掉即可。 */
const root_to_cinematic = {
  name: "root-to-cinematic",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      /* 只重定向根地址。不要把 /index.html 也跳走，
         否则联动指挥主演示在开发服里没有任何入口，验收脚本也打不开 */
      if (url === "/") {
        res.writeHead(302, { Location: "/cinematic.html?scene=campus" });
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  base: "./",
  plugins: [root_to_cinematic],
  server: {
    // 编辑器写入会经过临时目录，chokidar 在 Windows 上会 EBUSY，因此只监听源码树
    watch: {
      ignored: ["**/node_modules/**", "**/.*.tmpdir/**", "**/.*.tmp", "**/_*.png"],
    },
    port: 5179,
    strictPort: true,
    /* 0.0.0.0：局域网里的手机、另一台电脑也能打开。
       原先是 localhost，只绑回环，只有本机能访问 */
    host: "0.0.0.0",
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 3000,
    /* 两个页面：联动指挥演示（index）与观感版预览（cinematic） */
    rollupOptions: {
      input: {
        index: "index.html",
        cinematic: "cinematic.html",
      },
    },
  },
});
