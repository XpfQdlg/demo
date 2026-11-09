import { SCENARIOS } from "../data/events.js";
import { Dispatcher, advance_along_route } from "./dispatch.js";

/* ══════════════════════════════════════════════════════════════════════════
   Events — 事件层

   字段沿用 docs/02 第 4.1 节的事件模型，与总体方案保持一致，
   这样地图换了、界面换了，事件层仍然是可复用的资产。

   状态机：
     detected → dispatched → arrived → resolving → resolved
     无空闲设备时停在 pending，指挥图上闪烁等待
   ══════════════════════════════════════════════════════════════════════════ */

let seq = 0;
const next_id = () => `evt_${String(++seq).padStart(4, "0")}`;

const clock = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export class Events {
  constructor(world, app) {
    this.world = world;
    this.app = app;
    this.dispatcher = new Dispatcher(world);
    this.list = [];
    this.suppressed = new Set(); // 用户选择"留在当前"的事件不再提示
    this.timers = [];
    this.on_change = null; // 事件列表变化回调，供 HUD 刷新
  }

  /* ── 产生事件 ─────────────────────────────────────────────────────── */

  detect({ scene_id, target, sev, title, detail, conf, action }) {
    const entry = this.world.scenes.get(scene_id);
    const agent_list = this.world.agents_of(scene_id);

    const evt = {
      event_id: next_id(),
      scene: scene_id,
      scene_name: entry?.built?.name || scene_id,
      task_id: target.id,
      title,
      detail,
      location: target.name,
      x: target.x,
      y: target.y,
      confidence: conf,
      severity: { level: sev === "alarm" ? "高" : sev === "warn" ? "中" : "低", key: sev },
      status: "detected",
      dispatch: null,
      timeline: [{ t: clock(), state: "detected" }],
      action,
      created_at: Date.now(),
    };

    this.list.push(evt);
    this.on_change?.();

    /* 研判之后立刻派发 */
    const d = this.dispatcher.dispatch(scene_id, target);
    if (d) {
      evt.status = "dispatched";
      evt.dispatch = {
        device_id: d.agent.agent_id,
        device_name: d.agent.name,
        eta_s: Math.round(d.eta_s),
        distance_m: Math.round(d.distance_m),
        path: d.path,
      };
      evt.timeline.push({ t: clock(), state: "dispatched" });
      d.agent.event_id = evt.event_id;
    } else {
      evt.status = "pending";
    }
    this.on_change?.();

    return { evt, d };
  }

  /* ── 每帧推进 ─────────────────────────────────────────────────────── */

  tick(dt) {
    for (const scene of this.world.scenes.values()) {
      for (const a of scene.agents) {
        if (a.status !== "moving" || !a.route) continue;

        const arrived = advance_along_route(a, dt);
        if (!arrived) continue;

        /* 手动导航到达：只停下回到待命，不进入扫描与处置流程 */
        if (a.manual) {
          a.manual = false;
          a.status = "idle";
          a.route = null;
          a.route_idx = 0;
          a.entity.stop();
          continue;
        }

        /* 到场 → 扫描识别 */
        a.status = "scanning";
        a.entity.startScan(1.8);

        const evt = this.list.find((e) => e.event_id === a.event_id);
        if (evt && evt.status !== "resolved") {
          evt.status = "arrived";
          evt.timeline.push({ t: clock(), state: "arrived" });
          this.on_change?.();
        }

        /* 扫描结束 → 处置 */
        const timer = setTimeout(() => {
          a.entity.endScan();
          a.entity.setStatus?.(
            evt?.severity.key === "alarm" ? 0xff5a6a : evt?.severity.key === "warn" ? 0xffb454 : 0x46e39a
          );
          a.status = "alert";

          if (evt && evt.status !== "resolved") {
            evt.status = "resolving";
            evt.timeline.push({ t: clock(), state: "resolving" });
            this.on_change?.();
          }

          /* 处置 → 关闭 */
          const t2 = setTimeout(() => {
            this.resolve(evt);
            a.status = "idle";
            a.entity.setStatus?.(0x38e1ff);
            this.dispatcher.release(a);
          }, 3200);
          this.timers.push(t2);
        }, 1900);
        this.timers.push(timer);
      }
    }
  }

  resolve(evt) {
    if (!evt || evt.status === "resolved") return;
    evt.status = "resolved";
    evt.timeline.push({ t: clock(), state: "resolved" });
    this.on_change?.();
  }

  suppress(event_id, scene_id) {
    if (event_id) this.suppressed.add(event_id);
  }

  /* ── 剧本 ─────────────────────────────────────────────────────────── */

  /** 运行一个剧本。target 从场景点位里按 id 查。 */
  run_scenario(scenario) {
    const sc = SCENARIOS.find((s) => s.id === scenario.id) || scenario;
    const entry = this.world.ensure_scene(sc.scene);

    let acc = 0;
    for (const step of sc.steps) {
      acc += step.at;
      const t = setTimeout(() => {
        if (step.do === "detect") {
          const target = entry.built.targets.find((x) => x.id === step.target_id);
          if (!target) {
            console.warn("剧本点位不存在", step.target_id);
            return;
          }
          this.fire(sc, target, step);
        }
      }, acc);
      this.timers.push(t);
    }
  }

  fire(scenario, target, step) {
    const { evt, d } = this.detect({
      scene_id: scenario.scene,
      target,
      sev: step.sev,
      title: step.title,
      detail: step.detail,
      conf: step.conf,
      action: step.action,
    });

    /* 事件发生在其他场景时，先让人知道 */
    if (scenario.scene !== this.app.scene_id) {
      this.app.minimap.flash(scenario.scene);
    }

    /* 轮播模式不弹窗，直接切到被调度的设备 */
    if (this.app.kiosk && d) {
      this.app.director.auto(d.agent);
      return;
    }

    /* 调度成功才弹窗；用户已选择"留在当前"的事件不再提示 */
    if (d && !this.suppressed.has(evt.event_id)) {
      this.app.prompt.push({
        event_id: evt.event_id,
        scene_id: scenario.scene,
        scene_name: evt.scene_name,
        location: `${evt.scene_name} · ${target.name}`,
        severity: step.sev,
        title: step.title,
        detail: step.detail,
        agent: d.agent,
        distance_m: d.distance_m,
        eta_s: d.eta_s,
      });
    }
  }

  clear_timers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
