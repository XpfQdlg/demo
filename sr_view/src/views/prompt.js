/* ══════════════════════════════════════════════════════════════════════════
   告警弹窗 — 调度成功后询问是否切换视角

   设计口径（docs/03 第 3.3 节）：
   - 触发时机是调度单生成之后，不是检测到就弹
   - 十秒无操作自动收起为顶栏横幅，不切换视角
   - 同时只保留一个弹窗，后来的排队
   - 轮播模式下不弹窗，直接切
   ══════════════════════════════════════════════════════════════════════════ */

const AUTO_HIDE_MS = 10000;

export class Prompt {
  constructor(app) {
    this.app = app;
    this.queue = [];
    this.current = null;
    this.timer = 0;
    this.build();
  }

  build() {
    const el = document.createElement("div");
    el.id = "prompt";
    el.className = "prompt";
    el.innerHTML = `
      <div class="pr-head">
        <span class="pr-sev" id="prSev">高风险</span>
        <span class="pr-loc" id="prLoc">—</span>
        <button class="pr-close" id="prClose" type="button" aria-label="收起">×</button>
      </div>
      <div class="pr-title" id="prTitle">—</div>
      <div class="pr-detail" id="prDetail">—</div>
      <div class="pr-dispatch" id="prDispatch">—</div>
      <div class="pr-acts">
        <button class="btn primary" id="prGo" type="button">切换视角</button>
        <button class="btn ghost" id="prStay" type="button">留在当前</button>
      </div>
      <div class="pr-bar"><i id="prBar"></i></div>
    `;
    document.getElementById("ui").appendChild(el);

    this.el = el;
    this.$sev = el.querySelector("#prSev");
    this.$loc = el.querySelector("#prLoc");
    this.$title = el.querySelector("#prTitle");
    this.$detail = el.querySelector("#prDetail");
    this.$dispatch = el.querySelector("#prDispatch");
    this.$bar = el.querySelector("#prBar");

    el.querySelector("#prGo").addEventListener("click", () => this.accept());
    el.querySelector("#prStay").addEventListener("click", () => this.dismiss());
    el.querySelector("#prClose").addEventListener("click", () => this.dismiss());
  }

  /**
   * 请求展示一个告警提示。
   * @param {object} payload { scene_name, location, severity, title, detail, agent, eta_s }
   */
  push(payload) {
    if (this.current) {
      this.queue.push(payload);
      return;
    }
    this.show(payload);
  }

  show(p) {
    this.current = p;
    this.el.classList.add("on");

    const sev_label = p.severity === "alarm" ? "高风险" : p.severity === "warn" ? "需关注" : "提示";
    this.$sev.textContent = sev_label;
    this.$sev.className = `pr-sev ${p.severity}`;
    this.$loc.textContent = p.location || "";
    this.$title.textContent = p.title || "";
    this.$detail.textContent = p.detail || "";
    this.$dispatch.innerHTML = p.agent
      ? `最近设备 <b>${p.agent.name}</b> 已出发 · ${Math.round(p.distance_m || 0)} m · 约 ${Math.round(p.eta_s || 0)} 秒`
      : "当前场景无空闲设备，事件已挂起等待";

    /* 十秒进度条，超时自动收起 */
    this.$bar.style.animation = "none";
    void this.$bar.offsetWidth;
    this.$bar.style.animation = `prompt-countdown ${AUTO_HIDE_MS}ms linear forwards`;

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), AUTO_HIDE_MS);
  }

  accept() {
    const p = this.current;
    this.close();
    /* 走导演的 auto 分支，处置完成后会自动回到用户上一次手动选择的视角 */
    if (p?.agent) this.app.director.auto(p.agent);
  }

  dismiss() {
    const p = this.current;
    this.close();
    /* 用户明确选择留在当前，该事件不再提示 */
    if (p?.event_id) this.app.events?.suppress(p.event_id, p.scene_id);
  }

  close() {
    clearTimeout(this.timer);
    this.current = null;
    this.el.classList.remove("on");
    if (this.queue.length) {
      const next = this.queue.shift();
      setTimeout(() => this.show(next), 260);
    }
  }
}
