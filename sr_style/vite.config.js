import { defineConfig } from "vite";

/* 车机 SR 风格化试验台：从观感版复制而来，只保留一个入口。
   原工程在 ../command_demo，端口 5179；这里用 5181，两边可以同时开着对比。 */

const root_to_cinematic = {
  name: "root-to-cinematic",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (url === "/" || url === "/index.html") {
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
    watch: {
      ignored: ["**/node_modules/**", "**/.*.tmpdir/**", "**/.*.tmp", "**/_*.png"],
    },
    port: 5181,
    strictPort: true,
    host: "0.0.0.0",
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: { cinematic: "cinematic.html" },
    },
  },
});
