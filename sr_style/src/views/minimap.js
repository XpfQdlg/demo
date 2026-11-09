import { MAP } from "../map/coords.js";

/* ══════════════════════════════════════════════════════════════════════════
   Minimap — 2D 指挥图

   底图来自 engine.snapshotTopDown：把 3D 场景用正交相机离屏渲染成俯视图，
   所以图上的建筑轮廓、道路走向与 3D 完全一致，不会出现两套数据对不上的问题。

   两态：
     单场景态  —— 一张图铺满面板，显示该场景全部执行体、点位、调度路径
     全局态    —— 四个场景缩略图排成 2×2，每格显示设备位置与告警闪烁

   投影公式（与快照取景一致）：
     u = (x - cx) / span + 0.5
     v = (z - cz) / span + 0.5
   ══════════════════════════════════════════════════════════════════════════ */

const SEV_COLOR = { alarm: "#ff5a6a", warn: "#ffb454", info: "#38e1ff" };
const STATUS_COLOR = { idle: "#8595a7", moving: "#38e1ff", scanning: "#ffb454", alert: "#ff5a6a" };

export class Minimap {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // scene_id -> { url, cx, cz, span }
    this.global = false;
    this.el = null;
    this.build();
  }

  build() {
    const el = document.createElement("div");
    el.id = "minimap";
    el.className = "minimap";
    el.innerHTML = `
      <header class="mm-head">
        <b id="mmTitle">场景总览</b>
        <div class="mm-acts">
          <button class="mm-btn" id="mmGlobal" type="button" title="全局 / 单场景">⛶</button>
          <button class="mm-btn" id="mmExpand" type="button" title="放大查看">⤢</button>
        </div>
      </header>
      <div class="mm-body" id="mmBody">
        <div class="mm-single" id="mmSingle">
          <img id="mmImg" alt="" draggable="false" />
          <svg class="mm-route" id="mmRoute" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
          <div class="mm-marks" id="mmMarks"></div>
          <div class="mm-empty" id="mmLoading">正在生成底图…</div>
        </div>
        <div class="mm-grid" id="mmGrid"></div>
      </div>
      <footer class="mm-legend">
        <span><i class="lg-dog"></i>四足</span>
        <span><i class="lg-humanoid"></i>人形</span>
        <span><i class="lg-alarm"></i>告警</span>
      </footer>
    `;
    document.getElementById("ui").appendChild(el);
    this.el = el;

    this.$title = el.querySelector("#mmTitle");
    this.$img = el.querySelector("#mmImg");
    this.$route = el.querySelector("#mmRoute");
    this.$marks = el.querySelector("#mmMarks");
    this.$single = el.querySelector("#mmSingle");
    this.$grid = el.querySelector("#mmGrid");
    this.$loading = el.querySelector("#mmLoading");

    el.querySelector("#mmGlobal").addEventListener("click", () => this.toggle_global());
    el.querySelector("#mmExpand").addEventListener("click", () => this.toggle_expand());
    this.bind_click();
  }

  /* ── 底图 ─────────────────────────────────────────────────────────── */

  /** 取（或生成）某场景的俯视底图 */
  ensure(scene_id) {
    if (this.cache.has(scene_id)) return this.cache.get(scene_id);

    /* 全局态需要四个场景的缩略图，没建过的场景在这里补建 */
    const entry = this.app.world.ensure_scene(scene_id);
    if (!entry) return null;

    /* 底图必须在场景根节点未被挂到主场景时渲染，否则会被主场景的相机同时看到。
       这里临时从主场景摘下，渲染后挂回，避免闪烁。 */
    const built = entry.built;
    const root = built.root;
    const parent = root.parent;

    const raw = this.app.engine.snapshotTopDown({
      root,
      env: built.env,
      cx: built.extent.cx,
      cz: built.extent.cz,
      span: built.extent.span,
      px: 900,
    });

    if (parent && !root.parent) parent.add(root);

    const item = {
      url: this.stylize(raw),
      cx: built.extent.cx,
      cz: built.extent.cz,
      span: built.extent.span,
    };
    this.cache.set(scene_id, item);
    return item;
  }

  /** 压一层网格与暗角，读起来像总平面图而不是游戏截图 */
  stylize(cv) {
    const px = cv.width;
    const out = document.createElement("canvas");
    out.width = px;
    out.height = px;
    const c = out.getContext("2d");
    c.filter = "saturate(1.05) contrast(1.1) brightness(1.02)";
    c.drawImage(cv, 0, 0);
    c.filter = "none";

    c.strokeStyle = "rgba(150, 220, 255, 0.09)";
    c.lineWidth = 1.2;
    for (let i = 1; i < 16; i++) {
      const p = (px / 16) * i;
      c.beginPath();
      c.moveTo(p, 0);
      c.lineTo(p, px);
      c.moveTo(0, p);
      c.lineTo(px, p);
      c.stroke();
    }

    const g = c.createRadialGradient(px / 2, px / 2, px * 0.32, px / 2, px / 2, px * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(4,10,18,0.55)");
    c.fillStyle = g;
    c.fillRect(0, 0, px, px);

    return out.toDataURL("image/jpeg", 0.88);
  }

  /* ── 单场景态 ─────────────────────────────────────────────────────── */

  project(scene_id, x, y) {
    const it = this.cache.get(scene_id);
    if (!it) return [50, 50];
    /* 像素 → 世界 → 归一化显示坐标 */
    const wx = (x - MAP.width_px / 2) * MAP.meters_per_px;
    const wz = (y - MAP.height_px / 2) * MAP.meters_per_px;
    return [((wx - it.cx) / it.span + 0.5) * 100, ((wz - it.cz) / it.span + 0.5) * 100];
  }

  /** project 的逆运算：图上的百分比 → 像素坐标 */
  unproject(scene_id, u_pct, v_pct) {
    const it = this.cache.get(scene_id);
    if (!it) return null;
    const wx = (u_pct / 100 - 0.5) * it.span + it.cx;
    const wz = (v_pct / 100 - 0.5) * it.span + it.cz;
    return {
      x: wx / MAP.meters_per_px + MAP.width_px / 2,
      y: wz / MAP.meters_per_px + MAP.height_px / 2,
    };
  }

  /**
   * 指挥图上点击导航。
   * 单场景态点底图任意位置 → 派最近的空闲设备过去；
   * 全局态点某一格 → 先切到那个场景，再派设备。
   */
  bind_click() {
    this.$single.addEventListener("click", (e) => {
      /* 点在设备标记上时不导航，那是切换视角 */
      if (e.target.closest(".mm-mark")) return;
      const r = this.$single.getBoundingClientRect();
      const u = ((e.clientX - r.left) / r.width) * 100;
      const v = ((e.clientY - r.top) / r.height) * 100;
      if (u < 0 || u > 100 || v < 0 || v > 100) return;

      const p = this.unproject(this.app.scene_id, u, v);
      if (p) this.app.navigate_to_px(p);
    });
  }

  render_single(scene_id) {
    const it = this.ensure(scene_id);
    this.global = false;
    this.$single.style.display = "";
    this.$grid.style.display = "none";
    if (!it) return;

    this.$img.src = it.url;
    this.$loading.style.display = "none";
    this.$title.textContent = `${this.app.world.scenes.get(scene_id)?.built?.name || ""} · 单场景`;

    const agents = this.app.world.agents_of(scene_id);
    this.$marks.innerHTML = "";

    for (const a of agents) {
      const [u, v] = this.project(scene_id, a.x, a.y);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mm-mark ${a.type} ${a.status === "alert" ? "alert" : ""}`;
      b.style.left = `${u}%`;
      b.style.top = `${v}%`;
      b.innerHTML = `<span class="mm-dot"></span><span class="mm-tip">${a.name}</span>`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.app.select_agent(a);
      });
      this.$marks.appendChild(b);
      a.__mm_el = b;
      a.__mm_proj = [u, v];
    }
  }

  /* ── 全局态 ───────────────────────────────────────────────────────── */

  render_global() {
    this.global = true;
    this.$single.style.display = "none";
    this.$grid.style.display = "";
    this.$title.textContent = "全局 · 四场景";

    const ids = ["forest", "community", "campus", "subway"];
    this.$grid.innerHTML = "";

    for (const id of ids) {
      /* 先补建再取名，否则未建过的场景拿不到中文名 */
      const it = this.ensure(id);
      const entry = this.app.world.scenes.get(id);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "mm-cell";
      cell.dataset.scene = id;

      const name = entry?.built?.name || id;
      const agents = this.app.world.agents_of(id);
      const alerting = agents.some((a) => a.status === "alert" || a.status === "scanning");

      cell.innerHTML = `
        <div class="mm-cell-img" style="background-image:url('${it?.url || ""}')">
          <div class="mm-cell-marks"></div>
        </div>
        <div class="mm-cell-foot">
          <b>${name}</b>
          <span>${agents.length} 台${alerting ? " · <em>有事件</em>" : ""}</span>
        </div>
      `;
      if (alerting) cell.classList.add("alerting");
      if (id === this.app.scene_id) cell.classList.add("current");

      const marks = cell.querySelector(".mm-cell-marks");
      for (const a of agents) {
        const [u, v] = this.project(id, a.x, a.y);
        const dot = document.createElement("i");
        dot.className = `mm-mini ${a.type}`;
        dot.style.left = `${u}%`;
        dot.style.top = `${v}%`;
        marks.appendChild(dot);
      }

      cell.addEventListener("click", () => this.app.enter_scene(id));
      this.$grid.appendChild(cell);
    }
  }

  /* ── 刷新 ─────────────────────────────────────────────────────────── */

  /** 在当前执行体的移动路线上画一条折线 */
  draw_route(scene_id) {
    const agent = this.app.current;
    const pts = agent?.route;
    if (!pts || pts.length < 2) {
      this.$route.innerHTML = "";
      return;
    }
    const d = pts
      .map(([x, y], i) => {
        const [u, v] = this.project(scene_id, x, y);
        return `${i ? "L" : "M"}${u.toFixed(2)} ${v.toFixed(2)}`;
      })
      .join(" ");
    this.$route.innerHTML = `
      <path d="${d}" fill="none" stroke="rgba(56,225,255,0.35)" stroke-width="2.2" stroke-linecap="round" />
      <path d="${d}" fill="none" stroke="#38e1ff" stroke-width="0.9" stroke-dasharray="2 3" />
    `;
  }

  /** 每帧同步设备标记位置；只在必要时重排，避免抖动 */
  tick() {
    if (this.global) return;
    const scene_id = this.app.scene_id;
    if (!scene_id) return;

    this.draw_route(scene_id);

    for (const a of this.app.world.agents_of(scene_id)) {
      if (!a.__mm_el) continue;
      const [u, v] = this.project(scene_id, a.x, a.y);
      /* 位移小于半个像素就不写样式，省掉大量重排 */
      const [pu, pv] = a.__mm_proj || [u, v];
      if (Math.abs(u - pu) < 0.15 && Math.abs(v - pv) < 0.15) continue;
      a.__mm_el.style.left = `${u}%`;
      a.__mm_el.style.top = `${v}%`;
      a.__mm_proj = [u, v];
    }
  }

  /* ── 交互 ─────────────────────────────────────────────────────────── */

  toggle_global() {
    if (this.global) this.render_single(this.app.scene_id);
    else this.render_global();
  }

  toggle_expand() {
    this.el.classList.toggle("expanded");
  }

  /** 切场景后重绘 */
  refresh() {
    if (this.global) this.render_global();
    else this.render_single(this.app.scene_id);
  }

  /** 告警时让全局态的那一格闪起来 */
  flash(scene_id) {
    if (!this.global) return;
    const cell = this.$grid.querySelector(`[data-scene="${scene_id}"]`);
    if (!cell) return;
    cell.classList.add("alerting");
    cell.classList.remove("pulse");
    void cell.offsetWidth;
    cell.classList.add("pulse");
  }
}
