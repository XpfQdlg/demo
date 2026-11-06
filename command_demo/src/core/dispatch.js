import * as THREE from "three";
import { route, route_length } from "../map/routes.js";
import { px_to_world, px_distance_to_m, eta_seconds } from "../map/coords.js";

/* ══════════════════════════════════════════════════════════════════════════
   调度 — 同场景最近空闲设备

   规则（docs/03 第 5.4 节）：
   - 限定同场景，跨场景调度物理上不成立
   - 只选 status === 'idle' 的设备
   - 按欧氏距离最近优先
   - 无空闲设备时返回 null，事件降级为待调度
   ══════════════════════════════════════════════════════════════════════════ */

export class Dispatcher {
  constructor(world) {
    this.world = world;
  }

  /** 该场景内的候选设备，按到目标点的距离升序 */
  candidates(scene_id, target) {
    const agents = this.world.agents_of(scene_id).filter((a) => a.status === "idle");
    return agents
      .map((a) => ({ agent: a, distance_px: Math.hypot(a.x - target.x, a.y - target.y) }))
      .sort((p, q) => p.distance_px - q.distance_px);
  }

  /**
   * 派最近的空闲设备去目标点。
   * @returns {{agent, distance_px, distance_m, eta_s, path}|null}
   */
  dispatch(scene_id, target) {
    const cand = this.candidates(scene_id, target);
    if (!cand.length) return null;

    const { agent, distance_px } = cand[0];
    const path = route(
      { x: agent.x, y: agent.y },
      { x: target.stand_x ?? target.x, y: target.stand_y ?? target.y },
      scene_id,
      agent.type
    );

    /* 没有可达路径就不要派。硬走会穿楼穿轨道 */
    if (!path || path.length < 2) return null;

    agent.status = "moving";
    agent.target = target.id;
    agent.route = path;
    agent.route_idx = 1;
    agent.stuck = 0;
    agent.patrol = false; // 事件调度优先，巡检让位
    agent.occupied_until = Date.now() + 20000;

    const len = route_length(path);
    return {
      agent,
      distance_px,
      distance_m: px_distance_to_m(len),
      eta_s: eta_seconds(len, agent.speed_mps),
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
