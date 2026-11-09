import { SEV_META } from "../data/events.js";

/* ══════════════════════════════════════════════════════════════════════════
   Director — 视角导演

   核心规则（docs/03 第六节）：手动选择后三十秒内不自动抢视角，
   告警只弹窗询问。没有这一条，展台上会变成"讲到哪被抢到哪"。

   状态：
     manual   用户手动选定某台设备
     prompt   告警已弹窗，等待用户决定
     auto     用户接受弹窗，切到被调度的设备
     overview 全景俯瞰
   ══════════════════════════════════════════════════════════════════════════ */

const MANUAL_LOCK_MS = 30000;

export class Director {
  constructor(app) {
    this.app = app;
    this.state = "manual";
    this.locked_until = 0;
    this.last_manual = null; // 自动视角结束后回到这里
  }

  /** 用户手动切换 */
  set(agent) {
    if (!agent) return;
    this.state = "manual";
    this.last_manual = agent;
    this.locked_until = Date.now() + MANUAL_LOCK_MS;
    this.app.apply_agent(agent);
  }

  /** 用户接受告警弹窗 */
  auto(agent) {
    if (!agent) return;
    this.state = "auto";
    this.app.apply_agent(agent);
  }

  /** 是否处于手动锁定窗口内 */
  get is_locked() {
    return Date.now() < this.locked_until;
  }

  /** 处置完成后回到上一个手动视角 */
  back() {
    this.state = "manual";
    if (this.last_manual && this.last_manual.scene === this.app.scene_id) {
      this.app.apply_agent(this.last_manual);
    }
  }

  /** 切换场景时重置锁定，因为上一个手动视角已经不在当前场景 */
  on_scene_changed() {
    this.locked_until = 0;
    this.last_manual = null;
  }
}
