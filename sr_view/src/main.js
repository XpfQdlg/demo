import "./style.css";
import "./ui.css";
import { App } from "./core/app.js";
import * as HUD from "./views/hud.js";

/* 先让启动遮罩画一帧，再构建场景，避免白屏 */
requestAnimationFrame(() => {
  try {
    HUD.set_boot_text("正在构建场景…");
    const app = new App();
    window.__app = app;
    HUD.set_boot_text("就绪");
    requestAnimationFrame(() => HUD.hide_boot());
  } catch (err) {
    console.error("BOOT FAILED", err);
    const boot = document.getElementById("boot");
    if (boot) {
      boot.innerHTML = `<p style="color:#ff8a96;max-width:520px;text-align:center">初始化失败：${err.message}</p>`;
    }
  }
});
