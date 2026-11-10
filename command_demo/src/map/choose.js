import { route, route_length } from "./routes.js";

/* ══════════════════════════════════════════════════════════════════════════
   选设备 — 按 A* 折线长度挑最近的一台

   主演示（core/dispatch.js）与观感版（cine/monitor.js）各有一套数据模型，
   但「谁去最合适」的算法只有这一份，免得两边口径再次分叉。

   直线距离只是折线长度的下界：先把候选按直线距离升序，
   一旦某台的直线距离都超过当前最优折线长度，后面不可能更短，直接收手。
   通常只跑 1~3 次 A*，不会把全场景的设备都算一遍。
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Array<{x:number, y:number, type:string}>} candidates 已筛好的候选
 * @param {{x:number, y:number}} goal 目标像素坐标
 * @param {string} scene_id 场景，限定同场景调度
 * @returns {{agent, path, len_px}|null} 没有可达设备时返回 null
 */
export function shortest_route(candidates, goal, scene_id) {
  if (!candidates.length) return null;

  const sorted = candidates
    .map((a) => ({ agent: a, distance_px: Math.hypot(a.x - goal.x, a.y - goal.y) }))
    .sort((p, q) => p.distance_px - q.distance_px);

  let best = null;
  for (const c of sorted) {
    if (best && c.distance_px > best.len_px) break;
    const path = route({ x: c.agent.x, y: c.agent.y }, goal, scene_id, c.agent.type);
    if (!path || path.length < 2) continue;
    /* 起点会吸附到最近的可行走格心，这段吸附距离也要算进去：
       不算的话「人形机器人站在草地上」会被报成五米，其实还在二十米外 */
    const gap = Math.hypot(path[0][0] - c.agent.x, path[0][1] - c.agent.y);
    const len_px = route_length(path) + gap;
    if (!best || len_px < best.len_px) best = { agent: c.agent, path, len_px };
  }
  return best;
}
