import { Engine } from "./engine.js";
import { World } from "./world.js";
import { Events } from "./events.js";
import { Patrol } from "./patrol.js";
import { Director } from "./director.js";
import { ThirdPersonRig } from "../views/tp.js";
import { route } from "../map/routes.js";
import { world_to_px, MAP } from "../map/coords.js";
import { Minimap } from "../views/minimap.js";
import { Prompt } from "../views/prompt.js";
import { VideoLayer } from "../views/video.js";
import * as HUD from "../views/hud.js";
import { SCENARIOS } from "../data/events.js";

/* ══════════════════════════════════════════════════════════════════════════
   App — 流程编排

   组合关系：
     Engine   渲染
     World    执行体与场景
     Events   事件层，内部持有 Dispatcher
     Director 视角导演
     Minimap  2D 指挥图
     Prompt   告警弹窗
     Video    现场画面
   ══════════════════════════════════════════════════════════════════════════ */

export class App {
  constructor() {
    this.engine = new Engine(document.getElementById("stage"));
    this.world = new World(this.engine);

    this.mode = "fp";
    this.scene_id = null;
    this.current = null;
    this._last_evt_for_card = null;
    this._evt_status = new Map();

    /* 视角装置 */
    this.fp = new ThirdPersonRig(this.engine);
    this.director = new Director(this);

    /* 事件层 */
    this.events = new Events(this.world, this);
    this.events.on_change = () => this.on_events_changed();

    /* 自动巡检：空闲设备自己沿航点走 */
    this.patrol = new Patrol(this.world);

    /* 视图 */
    this.minimap = new Minimap(this);
    this.prompt = new Prompt(this);
    this.video = new VideoLayer(this);

    this._fps_t0 = performance.now();
    this._fps_n = 0;
    this._fps = 0;

    this.bind_ui();

    this.engine.onFrame((dt, t) => this.tick(dt, t));

    HUD.render_scenarios(SCENARIOS, (s) => this.run_scenario(s));
    this.enter_scene("campus");
  }

  /* ── UI ───────────────────────────────────────────────────────────── */

  bind_ui() {
    HUD.bind_scene_tabs((id) => this.enter_scene(id));
    HUD.bind_feed_clear(() => HUD.clear_feed());
    HUD.bind_banner((evt) => this.focus_event(evt));

    document.getElementById("btnOverview").addEventListener("click", () => this.toggle_mode());
    document.getElementById("btnKiosk").addEventListener("click", () => this.toggle_kiosk());

    /* 识别卡片里的现场画面按钮，用事件委托避免每次重绘重新绑定 */
    document.getElementById("detCard").addEventListener("click", (e) => {
      if (!e.target.closest("[data-video]")) return;
      const evt = this._last_evt_for_card;
      if (!evt) return;
      this.video.show({
        scene_id: evt.scene,
        target_id: evt.task_id,
        title: `${evt.scene_name} · ${evt.location}`,
      });
    });

    addEventListener("keydown", (e) => this.on_key(e));
    this.bind_ground_click();
  }

  /* ── 场景 ─────────────────────────────────────────────────────────── */

  enter_scene(scene_id) {
    if (scene_id === this.scene_id && this.current) return;

    this.scene_id = scene_id;
    const entry = this.world.enter_scene(scene_id);

    HUD.set_scene_tab(scene_id);
    HUD.render_agents(entry.agents, (a) => this.select_agent(a));

    this.director.on_scene_changed();

    /* 保持当前视角模式：俯瞰继续俯瞰，第一人称换到该场景首台设备 */
    this.current = null;
    if (!entry.agents.length) {
      this.fp.detach();
      this.set_overview();
      this.minimap.refresh();
      return;
    }

    if (this.mode === "overview") {
      this.current = entry.agents[0];
      HUD.set_status({ agent: this.current, mode: "overview" });
      this.overview();
    } else {
      this.select_agent(entry.agents[0]);
    }

    this.minimap.refresh();
  }

  /* ── 执行体与视角 ─────────────────────────────────────────────────── */

  /** 用户主动选择，走导演的锁定逻辑 */
  select_agent(agent) {
    this.director.set(agent);
  }

  /** 直接套用视角，不经过导演判定。Director 调用。 */
  apply_agent(agent) {
    if (!agent) return;
    this.current = agent;
    this.mode = "fp";
    this.fp.attach(agent);
    this.engine.setRig(this.fp);
    HUD.set_active_agent(agent.agent_id);
    HUD.set_status({ agent, mode: "fp" });
    HUD.set_reticle(false);
    document.getElementById("btnOverview").classList.remove("on");
  }

  toggle_mode() {
    if (this.mode === "fp") this.set_overview();
    else if (this.current) this.select_agent(this.current);
  }

  set_overview() {
    this.mode = "overview";
    this.fp.detach();
    this.engine.setRig(null);
    this.overview();
    HUD.set_reticle(false);
    HUD.set_status({ mode: "overview" });
    document.getElementById("btnOverview").classList.add("on");
  }

  overview() {
    const e = this.world.active?.built?.extent;
    if (!e) return;
    const d = Math.max(60, e.span * 0.95);
    this.engine.overview({
      pos: [e.cx + d * 0.62, d * 0.92, e.cz + d * 0.62],
      target: [e.cx, 0.4, e.cz],
      maxDistance: d * 2.4,
    });
  }

  /* ── 剧本 ─────────────────────────────────────────────────────────── */

  run_scenario(scenario) {
    /* 允许只传 id，便于控制台调试与外部调用 */
    if (!scenario.scene) {
      scenario = SCENARIOS.find((s) => s.id === scenario.id) || scenario;
    }
    if (!scenario.scene) {
      console.warn("剧本缺少场景信息", scenario);
      return;
    }
    if (scenario.scene !== this.scene_id) this.enter_scene(scenario.scene);
    HUD.add_feed(
      { title: scenario.name, scene_name: scenario.scene, severity: { key: "info" }, timeline: [] },
      "剧本开始"
    );
    this.events.run_scenario(scenario);
  }

  /* ── 事件联动 ─────────────────────────────────────────────────────── */

  on_events_changed() {
    const latest = this.events.list.at(-1);
    if (!latest) return;

    /* 每一条事件只在状态变化时写一行事件流，避免同一件事刷满屏 */
    const seen = this._evt_status.get(latest.event_id);
    if (seen === latest.status) return;
    this._evt_status.set(latest.event_id, latest.status);

    this._last_evt_for_card = latest;
    HUD.show_detection(latest);

    const NOTE = {
      detected: "检测到异常",
      dispatched: latest.dispatch ? `派 ${latest.dispatch.device_name} 前往` : "待调度",
      pending: "无空闲设备，等待中",
      arrived: `${latest.dispatch?.device_name || "设备"} 已到场`,
      resolving: "现场处置中",
      resolved: "已关闭",
    };
    HUD.add_feed(latest, NOTE[latest.status] || "");

    /* 告警时让 2D 图也闪一下，即便用户没切过去也能看见 */
    if (latest.status === "detected" || latest.status === "dispatched") {
      this.minimap.flash(latest.scene);
    }

    /* 顶栏横幅：未关闭的事件常驻提示，点一下切到对应设备 */
    HUD.render_banner(latest.status === "resolved" ? null : latest);

    /* 自动切过去的视角，处置完成后回到用户上一次手动选择 */
    if (latest.status === "resolved" && this.director.state === "auto") {
      this.director.back();
    }
  }

  /* ── 轮播模式 ─────────────────────────────────────────────────────── */

  /**
   * 无人值守模式：自动轮播三个剧本，告警不弹窗而是直接切视角。
   * 展台接大屏时用，讲解模式下手动控制。
   */
  toggle_kiosk(force) {
    const on = force ?? !this.kiosk;
    this.kiosk = on;
    document.body.classList.toggle("kiosk", on);
    document.getElementById("btnKiosk").classList.toggle("on-kiosk", on);

    clearInterval(this._kiosk_timer);
    if (!on) {
      if (this._kiosk_idx != null) this._kiosk_idx = null;
      return;
    }

    this._kiosk_idx = 0;
    const next = () => {
      const sc = SCENARIOS[this._kiosk_idx % SCENARIOS.length];
      this._kiosk_idx += 1;
      this.run_scenario(sc);
    };
    next();
    this._kiosk_timer = setInterval(next, 26000);
  }

  /** 点横幅：切到该事件的执行设备 */
  focus_event(evt) {
    if (!evt) return;
    if (evt.scene !== this.scene_id) this.enter_scene(evt.scene);
    const agent = this.world.agent_by_id(evt.dispatch?.device_id);
    if (agent) this.director.auto(agent);
  }

  /* ── 地面点击导航 ─────────────────────────────────────────────────── */

  /**
   * 点击地面：取点击位置对应的像素坐标，选场景内离它最近的空闲设备，
   * 用 A* 规划路线后交给该设备。点在建筑上时会吸附到最近的可行走格。
   * 点击已有设备或巡检点时不触发导航。
   */
  bind_ground_click() {
    const canvas = this.engine.renderer.domElement;
    let down = null;

    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      /* 拖拽旋转视角时不算点击 */
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const held = performance.now() - down.t;
      down = null;
      if (moved > 6 || held > 400) return;
      this.navigate_to_click(e.clientX, e.clientY);
    });
  }

  navigate_to_click(clientX, clientY) {
    const hit = this.engine.groundPoint(clientX, clientY);
    if (!hit) return;
    const p = world_to_px(hit.x, hit.z);
    this.navigate_to_px(p);
  }

  /**
   * 按像素坐标派最近的空闲设备过去。
   * 3D 画面点击与 2D 指挥图点击都走这里，保证两处行为一致。
   */
  navigate_to_px(p) {
    const scene_name = this.world.active?.built?.name || "";

    /* 点在场景范围外（背景空地）时不导航，否则设备会走向几百米外 */
    const ext = this.world.active?.built?.extent;
    if (ext) {
      const half = ext.span * 0.62;
      const wx = (p.x - MAP.width_px / 2) * MAP.meters_per_px;
      const wz = (p.y - MAP.height_px / 2) * MAP.meters_per_px;
      if (Math.abs(wx - ext.cx) > half || Math.abs(wz - ext.cz) > half) {
        HUD.add_feed(
          { title: "超出场景范围", scene_name, severity: { key: "warn" }, timeline: [] },
          "请在场景范围内点击"
        );
        return;
      }
    }

    const agents = this.world.agents_of(this.scene_id);
    const idle = agents.filter((a) => a.status === "idle");
    if (!idle.length) {
      HUD.add_feed({ title: "无空闲设备", scene_name, severity: { key: "warn" }, timeline: [] }, "全部设备忙碌，导航未执行");
      return;
    }

    /* 选离点击点最近的空闲设备 */
    const agent = idle
      .map((a) => ({ a, d: Math.hypot(a.x - p.x, a.y - p.y) }))
      .sort((x, y) => x.d - y.d)[0].a;

    const path = route({ x: agent.x, y: agent.y }, { x: p.x, y: p.y }, this.scene_id, agent.type);
    if (!path || path.length < 2) {
      HUD.add_feed(
        { title: "到不了这个位置", scene_name, severity: { key: "warn" }, timeline: [] },
        `${agent.name} 没有通往该点的路线`
      );
      return;
    }

    agent.status = "moving";
    agent.route = path;
    agent.route_idx = 1;
    agent.stuck = 0;
    agent.target = null;
    agent.manual = true;
    agent.patrol = false;

    HUD.add_feed(
      { title: "手动导航", scene_name, severity: { key: "info" }, timeline: [] },
      `${agent.name} 前往点击位置`
    );
  }

  /* ── 输入 ─────────────────────────────────────────────────────────── */

  on_key(e) {
    if (e.code === "Escape") {
      if (this.kiosk) this.toggle_kiosk(false);
      else if (this.minimap.el.classList.contains("expanded")) this.minimap.toggle_expand();
      return;
    }
    if (e.code === "KeyV") {
      this.toggle_mode();
      return;
    }
    if (e.code === "KeyM") {
      this.minimap.toggle_global();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) {
      const list = this.world.agents_of(this.scene_id);
      if (list[n - 1]) this.select_agent(list[n - 1]);
    }
  }

  /* ── 每帧 ─────────────────────────────────────────────────────────── */

  tick(dt, t) {
    /* 巡检先决定去哪，world.update 再按 dest 移动实体，顺序不能反 */
    this.patrol.tick(dt);
    this.world.update(dt, t);
    this.events.tick(dt);

    HUD.sync_agent_status(this.world.agents_of(this.scene_id));
    this.minimap.tick();

    /* 帧率用真实墙钟时间统计。不能用 dt：dt 有 0.05 的上限，
       低帧率时会被压平，算出来的数字虚高。 */
    const now = performance.now();
    this._fps_n += 1;
    const span = now - this._fps_t0;
    if (span >= 500) {
      this._fps = Math.round((this._fps_n * 1000) / span);
      this._fps_n = 0;
      this._fps_t0 = now;
      HUD.set_status({ fps: this._fps });
    }
  }
}
