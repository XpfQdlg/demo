import * as THREE from "three";
import { route, route_length } from "../map/routes.js";
import { px_to_world } from "../map/coords.js";
import { advance_along_route } from "./dispatch.js";

/* ══════════════════════════════════════════════════════════════════════════
   Patrol — 自动巡检

   空闲的设备自己沿巡检航点走，不是站着不动。
   规则：
   - 只在 status === 'idle' 且没有事件占用时启动
   - 到点后停 2~5 秒，再挑下一个航点；优先挑离当前较远的，避免原地打转
   - 一旦被告警调度（status 变 moving），巡检立刻中断，事件优先
   - 走的是各场景自己的航点表（build_scene 返回的 patrol_points）

   为什么单独一个模块：事件层只负责告警到关闭的链路，
   巡检是常驻行为，混进 events.js 会让状态机难读。
   ══════════════════════════════════════════════════════════════════════════ */

const IDLE_MIN = 1.0;
const IDLE_MAX = 3.0;
const REST_MIN = 2.0;
const REST_MAX = 5.0;

export class Patrol {
  constructor(world) {
    this.world = world;
    this.state = new Map(); // agent_id -> { wait, route }
    this.enabled = true;
  }

  /** 单个设备的状态，懒初始化 */
  _state(agent) {
    let s = this.state.get(agent.agent_id);
    if (!s) {
      s = { wait: IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN), point: -1 };
      this.state.set(agent.agent_id, s);
    }
    return s;
  }

  /** 挑下一个航点：跳过当前所在点，在剩下的里随机挑，偏向远一点的 */
  _pick_point(agent, points) {
    if (!points || !points.length) return null;
    const cands = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      const d = Math.hypot(x - agent.x, y - agent.y);
      if (d < 12) continue; // 3 米内的点不选，免得原地挪
      cands.push({ i, d, x, y });
    }
    if (!cands.length) return null;

    /* 按距离加权随机：远的概率大，但不总是同一个点，动线才自然 */
    const total = cands.reduce((a, c) => a + c.d * c.d, 0);
    let r = Math.random() * total;
    for (const c of cands) {
      r -= c.d * c.d;
      if (r <= 0) return c;
    }
    return cands[cands.length - 1];
  }

  tick(dt) {
    if (!this.enabled) return;

    for (const scene of this.world.scenes.values()) {
      const points = scene.built.patrol_points;
      if (!points || !points.length) continue;

      for (const a of scene.agents) {
        /* 事件与手动导航优先：非 idle 一律不碰 */
        if (a.status !== "idle" || a.manual) continue;

        const st = this._state(a);

        /* 正在巡检路上：推进折线 */
        if (a.route && a.route.length >= 2) {
          const arrived = advance_along_route(a, dt);
          if (arrived) {
            a.route = null;
            a.route_idx = 0;
            a.entity.stop();
            st.wait = REST_MIN + Math.random() * (REST_MAX - REST_MIN);
          }
          continue;
        }

        /* 到达后歇一会儿再出发 */
        st.wait -= dt;
        if (st.wait > 0) continue;

        const target = this._pick_point(a, points);
        if (!target) {
          st.wait = REST_MIN;
          continue;
        }

        /* 人形走道路网格，狗走全体网格 */
        const path = route({ x: a.x, y: a.y }, { x: target.x, y: target.y }, a.scene, a.type);
        if (!path || path.length < 2) {
          st.wait = REST_MIN;
          continue;
        }
        /* 太近就不用走了，直接换一个 */
        if (route_length(path) < 15) {
          st.wait = REST_MIN;
          continue;
        }

        a.route = path;
        a.route_idx = 1;
        a.stuck = 0;
        a.patrol = true;

        /* 让实体进入行走姿态。真正的 dest 由 advance_along_route 每帧写，
           这里先给一个初值，避免第一帧原地不动 */
        const w = px_to_world(path[1][0], path[1][1]);
        a.entity.walkTo?.(new THREE.Vector3(w.x, 0, w.z));

        /* 保持 idle：巡检不是任务，随时可以被告警调度打断 */
        a.status = "idle";
      }
    }
  }

  /** 该设备是否正在巡检路上，供 UI 显示用 */
  is_patrolling(agent) {
    return !!(agent.patrol && agent.route && agent.status === "idle");
  }
}
