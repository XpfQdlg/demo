import { media_for } from "../data/media_map.js";

/* ══════════════════════════════════════════════════════════════════════════
   现场视频浮层 — 3D 讲态势，真实画面讲证据

   规则（docs/03 第 3.4 节）：
   - 预录片段为主，右侧浮层，占屏幕三分之一，不遮 3D 主体
   - 播放时暂停 3D 渲染，播完自动关闭并恢复
   - 左上角固定角标"真实检测画面"
   - 没有片段时按钮置灰，不弹空窗
   ══════════════════════════════════════════════════════════════════════════ */

export class VideoLayer {
  constructor(app) {
    this.app = app;
    this.open = false;
    this.build();
  }

  build() {
    const el = document.createElement("div");
    el.id = "videoLayer";
    el.className = "video-layer";
    el.innerHTML = `
      <div class="vl-head">
        <span class="vl-badge">真实检测画面</span>
        <b id="vlTitle">—</b>
        <button class="vl-close" id="vlClose" type="button" aria-label="关闭">×</button>
      </div>
      <div class="vl-body">
        <video id="vlVideo" playsinline muted controls></video>
        <div class="vl-none" id="vlNone">
          <span>该事件暂无对应现场片段</span>
          <small>素材目录 assets/media/&lt;场景&gt;/ 为空，放入 mp4 后在 media_map.js 中填写路径即可</small>
        </div>
      </div>
      <div class="vl-foot" id="vlFoot">—</div>
    `;
    document.getElementById("ui").appendChild(el);

    this.el = el;
    this.$video = el.querySelector("#vlVideo");
    this.$none = el.querySelector("#vlNone");
    this.$title = el.querySelector("#vlTitle");
    this.$foot = el.querySelector("#vlFoot");

    el.querySelector("#vlClose").addEventListener("click", () => this.hide());
    this.$video.addEventListener("ended", () => this.hide());
  }

  /** 是否有可播素材，供按钮判断置灰 */
  available(scene_id, target_id) {
    return !!media_for(scene_id, target_id);
  }

  /**
   * 打开某个点位对应的现场画面。
   * 没有素材时展示空态说明，不静默失败。
   */
  show({ scene_id, target_id, title }) {
    const media = media_for(scene_id, target_id);
    this.open = true;
    this.el.classList.add("on");
    this.$title.textContent = title || "现场画面";

    /* 播放时暂停 3D，避免画面争夺，也省性能 */
    this.app.engine.paused = true;

    if (!media) {
      this.$video.style.display = "none";
      this.$none.style.display = "";
      this.$foot.textContent = "演示原型 · 素材待接入";
      return;
    }

    this.$video.style.display = "";
    this.$none.style.display = "none";
    this.$video.src = media.url;
    this.$video.play().catch(() => {
      /* 自动播放被拦截时留给用户手动点播放，不算错误 */
    });
    this.$foot.textContent = media.note || "";
  }

  hide() {
    this.open = false;
    this.el.classList.remove("on");
    this.$video.pause();
    this.$video.removeAttribute("src");
    this.$video.load();
    this.app.engine.paused = false;
  }
}
