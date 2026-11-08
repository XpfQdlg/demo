import { defineConfig } from "vite";

/* 单文件打包专用配置。
   主配置有两个入口（index 与 cinematic），Rollup 会把共用的 three 与场景代码
   拆成单独 chunk；单文件里行内模块无法再 import 外部 chunk，所以这里只留观感版
   一个入口，并强制把动态导入并进同一块。 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    outDir: "dist-single",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { cinematic: "cinematic.html" },
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
