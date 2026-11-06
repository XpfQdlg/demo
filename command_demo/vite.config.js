import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    // 编辑器写入会经过临时目录，chokidar 在 Windows 上会 EBUSY，因此只监听源码树
    watch: {
      ignored: ["**/node_modules/**", "**/.*.tmpdir/**", "**/.*.tmp", "**/_*.png"],
    },
    port: 5179,
    strictPort: true,
    host: "localhost",
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
