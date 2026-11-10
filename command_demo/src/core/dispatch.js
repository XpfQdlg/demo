import * as THREE from "three";
import { shortest_route } from "../map/choose.js";
import { px_to_world, px_distance_to_m, eta_seconds } from "../map/coords.js";

/* ══════════════════════════════════════════════════════════════════════════
   调度 — 同场景最近空闲设备

   规则（docs/03 第 5.4 节）：
   - 限定同场景，跨场景调度物理上不成立
   - 只选 status === 'idle' 的设备
   - 按 A* 折线长度最近优先，不是直线距离：两点之间直线最近，
     但直线穿楼时那条路走不了，按直线派会把最近的设备派到楼的另一侧
   - 无空闲设备时返回 null，事件降级为待调度
   ══════════════════════════════════════════════════════════════════════════ */

export class Dispatcher {
  constructor(world) {
    this.world = world;
  }

  /**
   * 折线最短的可达设备（算法在 map/choose.js，与观感版共用一份）。
   * @returns {{agent, path, len_px}|null}
   */
  nearest(scene_id, target) {
    const idle = this.world.agents_of(scene_id).filter((a) => a.status === "idle");
    const goal = { x: target.stand_x ?? target.x, y: target.stand_y ?? target.y };
    return shortest_route(idle, goal, scene_id);
  }

  /**
   * 派折线最短的空闲设备去目标点。
   * @returns {{agent, distance_px, distance_m, eta_s, path}|null}
   */
  dispatch(scene_id, target) {
    const best = this.nearest(scene_id, target);

    /* 没有可达路径就不要派。硬走会穿楼穿轨道 */
    if (!best) return null;

    const { agent, path, len_px } = best;
    const distance_px = Math.hypot(agent.x - target.x, agent.y - target.y);

    agent.status = "moving";
    agent.target = target.id;
    agent.route = path;
    agent.route_idx = 1;
    agent.stuck = 0;
    agent.patrol = false; // 事件调度优先，巡检让位
    agent.occupied_until = Date.now() + 20000;

    return {
      agent,
      distance_px,
      distance_m: px_distance_to_m(len_px),
      eta_s: eta_seconds(len_px, agent.speed_mps),
      path,
    };
  }

  /** 设备任务结束后释放占用 */
  release(agent) {
    agent.status = "idle";
    agent.target = null;
    agent.route = null;
    agent.route_idx = 0;
    agent.occupied_until = 0;
  }
}

/**
 * 沿折线驱动一个设备。由 World 每帧调用。
 * 返回 true 表示已到达终点。
 */
export function advance_along_route(agent, dt) {
  const path = agent.route;
  if (!path || path.length < 2) return true;

  const entity = agent.entity;
  const last = path.length - 1;
  let idx = Math.min(agent.route_idx ?? 1, last);
  const w = px_to_world(path[idx][0], path[idx][1]);

  /* 每帧把当前航点写进 dest。走的是折线而不是直线 */
  if (!entity.dest) entity.dest = new THREE.Vector3(w.x, 0, w.z);
  else entity.dest.set(w.x, 0, w.z);

  if (entity.mode !== "walk") entity.mode = "walk";

  /* 到达判定：中间航点要求贴近，终点放宽。
     原来终点也按 0.4 米算，可实体自己的到达阈值是 0.28 米，
     会在「实体认为自己到了」和「这里认为没到」之间来回切换，
     表现就是到了一个点之后原地打转、一直不停。 */
  const dist = Math.hypot(entity.position.x - w.x, entity.position.z - w.z);
  const tol = idx >= last ? 1.2 : 0.5;

  if (dist < tol) {
    if (idx >= last) {
      entity.stop();
      return true;
    }
    agent.route_idx = idx + 1;
    return false;
  }

  /* 兜底：卡住超过 3 秒直接判到达，避免设备被一个小障碍磨到超时 */
  if (idx >= last) {
    agent.stuck = (agent.stuck || 0) + dt;
    if (agent.stuck > 3.0) {
      agent.stuck = 0;
      entity.stop();
      return true;
    }
  }

  return false;
}
