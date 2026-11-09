import { find_path_on } from "./pathfind.js";
import { nav_for } from "./nav_grid.js";

/* ══════════════════════════════════════════════════════════════════════════
   路网 — 执行体在地图上的可行走路径

   接口：route(from_px, to_px, scene_id, kind) -> [[x, y], ...]  像素折线

   kind 决定用哪张网格：
     dog       机器狗，走 all（建筑之外都行）
     humanoid  人形机器人，走 road（只走道路/站台面）

   所有场景都走 A*。早期小区、森林、地铁是程序生成的简单场地，
   走直线不会出错；现在小区有楼、地铁有铁轨，直线会穿墙、会掉轨道，
   所以统一改成 A*。拿不到路径时返回 null，不退回直线。
   ══════════════════════════════════════════════════════════════════════════ */

export function route(from, to, scene_id, kind = "dog") {
  const nav = nav_for(scene_id, kind === "humanoid" ? "road" : "all");
  if (nav) {
    const path = find_path_on(nav, from, to);
    /* 拿不到路径就返回 null，绝对不能退回直线：
       直线会穿楼、穿轨道、翻山，看起来就是「机器从楼里穿过去」。
       调用方拿到 null 应当原地不动并提示，而不是硬走。 */
    return path && path.length >= 2 ? path : null;
  }

  /* 只有完全没有网格的场景才允许直线（目前不存在，留作兜底） */
  return [
    [from.x, from.y],
    [to.x, to.y],
  ];
}

/** 折线的总长，像素 */
export function route_length(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return d;
}
