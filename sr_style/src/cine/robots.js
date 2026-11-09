import * as THREE from "three";
import { Dog } from "../entities/dog.js";
import { Humanoid } from "../entities/humanoid.js";
import { route } from "../map/routes.js";
import { nav_for } from "../map/nav_grid.js";
import { spread_spots } from "../map/pathfind.js";
import { px_to_world, world_to_px } from "../map/coords.js";
import { advance_along_route } from "../core/dispatch.js";
import { inside_polygon } from "../map/terrain.js";

/* ══════════════════════════════════════════════════════════════════════════
   robots — 观感版场景里的机器狗与人形机器人

   全部复用联动演示的现成零件，不另写一套：
     实体        entities/dog.js、entities/humanoid.js
     寻路        map/routes.js 的 route()（A*，狗走 all 网格、人形走 road 网格）
     航点        pathfind.js 的 spread_spots()，按开阔度散开取点
     折线推进    core/dispatch.js 的 advance_along_route()

   行为与 patrol.js 一致：空闲时挑一个较远的航点走过去，到点歇 2~5 秒再挑下一个。
   区别只是这里没有 World / 事件层，状态放在局部数组里。

   机位是静态画面，所以实体不进 merge_static（合并会把腿部骨骼烘成静止几何），
   靠 userData.no_merge 跳过整棵子树。
   ══════════════════════════════════════════════════════════════════════════ */

const REST_MIN = 2.0;
const REST_MAX = 5.0;

function make_rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** 从可行走网格里取一组散开的航点（像素坐标） */
function waypoints(nav, count, min_sep_px = 40) {
  if (!nav) return [];
  return spread_spots(nav, count, min_sep_px).map((p) => [p[0], p[1]]);
}

/**
 * 往场景里放几台设备，并注册逐帧推进。
 *
 * @param root      场景根节点
 * @param scene     场景 id（campus / community / forest / subway），决定用哪张网格
 * @param cine      Cinematic 实例，用来注册 updater
 * @param dogs      机器狗数量
 * @param humans    人形机器人数量
 * @param floor_y   设备落地的 Y。地铁站台高 0.9 米，要抬上去
 */
export function add_robots(root, {
  scene,
  cine = null,
  dogs = 2,
  humans = 2,
  floor_y = 0,
  seed = 20261105,
  center_px = null,
  radius_px = 0,
  area_px = null,
  exclude_px = [],
} = {}) {
  const nav_dog = nav_for(scene, "all");
  const nav_man = nav_for(scene, "road");

  /* 可选活动范围，三种口径可以叠加：
       center_px / radius_px  圆形，小区这种规则地块够用
       area_px                多边形，校园按轮廓卡才贴合校界
       exclude_px             排除多边形，校园里要挖掉小区那块地
     航点被滤掉之后设备就出不了自己的场地；滤空了由下面退回全场兜底。 */
  const limit = (pts) => {
    let out = pts;
    if (area_px && area_px.length >= 3) {
      out = out.filter(([x, y]) => inside_polygon(area_px, x, y));
    }
    if (exclude_px && exclude_px.length) {
      out = out.filter(([x, y]) => exclude_px.every((poly) => !inside_polygon(poly, x, y)));
    }
    if (center_px && radius_px > 0) {
      out = out.filter(([x, y]) => Math.hypot(x - center_px[0], y - center_px[1]) <= radius_px);
    }
    return out;
  };

  let pt_dog = limit(waypoints(nav_dog, 12, 34));
  let pt_man = limit(waypoints(nav_man, 10, 34));
  /* 范围内一个航点都没有时退回全局撒点，宁可变宽也不能一台设备都不出 */
  if (!pt_dog.length) pt_dog = waypoints(nav_dog, 12, 34);
  if (!pt_man.length) pt_man = waypoints(nav_man, 10, 34);
  if (!pt_dog.length && !pt_man.length) return null;

  const rnd = make_rng(seed);
  const group = new THREE.Group();
  group.name = "robots";
  group.userData.no_merge = true;   // 有骨骼动画，不能并进静态几何

  const agents = [];

  /* 两台设备不能生在同一点上——航点表小的时候（地铁站台只有一条矩形），
     按下标取点很容易撞在一起，两台机器会互相穿模。 */
  const taken = [];
  const spawn = (kind, i, points) => {
    const pts = points.length ? points : pt_dog;
    if (!pts.length) return;
    let start = pts[(i * 3 + 1) % pts.length];
    for (const [x, y] of pts) {
      if (taken.every(([tx, ty]) => Math.hypot(tx - x, ty - y) > 24)) {
        start = [x, y];
        break;
      }
    }
    taken.push(start);
    const w = px_to_world(start[0], start[1]);

    const entity = kind === "dog" ? new Dog({ scale: 1 }) : new Humanoid({ scale: 1 });
    entity.root.position.set(w.x, floor_y, w.z);
    const heading = rnd() * Math.PI * 2;
    entity.heading = heading;
    entity.root.rotation.y = heading;
    group.add(entity.root);

    agents.push({
      entity,
      scene,
      type: kind === "dog" ? "dog" : "humanoid",
      points: pts,
      x: start[0],
      y: start[1],
      route: null,
      route_idx: 1,
      stuck: 0,
      wait: 0.6 + rnd() * 2.4,
      rnd,
      /* 监控调度用的两个字段，见 cine/monitor.js：
           status  idle 待命 / moving 出警途中 / on_site 到场 / busy 处置中
           task    出警任务，有任务时本模块不再自己挑航点 */
      status: "idle",
      task: null,
    });
  };

  for (let i = 0; i < dogs; i++) spawn("dog", i, pt_dog);
  for (let i = 0; i < humans; i++) spawn("humanoid", i, pt_man);

  /** 挑航点：距离加权，远的概率大，动线才不总在同一个角落 */
  function pick(agent) {
    const cands = [];
    for (const [x, y] of agent.points) {
      const d = Math.hypot(x - agent.x, y - agent.y);
      if (d < 14) continue;
      cands.push({ x, y, d });
    }
    if (!cands.length) return null;
    const total = cands.reduce((a, c) => a + c.d * c.d, 0);
    let r = agent.rnd() * total;
    for (const c of cands) {
      r -= c.d * c.d;
      if (r <= 0) return c;
    }
    return cands[cands.length - 1];
  }

  function step(agent, dt) {
    const e = agent.entity;

    if (agent.route && agent.route.length >= 2) {
      if (advance_along_route(agent, dt)) {
        agent.route = null;
        agent.route_idx = 1;
        const task = agent.task;
        if (task) {
          /* 出警任务走到了：交给监控层去扫描、处置，这里不再自己挑航点 */
          agent.task = null;
          task.on_arrive?.(agent);
        } else {
          agent.wait = REST_MIN + agent.rnd() * (REST_MAX - REST_MIN);
        }
      }
      const px = world_to_px(e.position.x, e.position.z);
      agent.x = px.x;
      agent.y = px.y;
      return;
    }

    /* 出警、扫描、处置期间不自主巡检，否则会和调度抢方向 */
    if (agent.status !== "idle") return;

    agent.wait -= dt;
    if (agent.wait > 0) return;

    const target = pick(agent);
    if (!target) {
      agent.wait = REST_MIN;
      return;
    }

    const path = route({ x: agent.x, y: agent.y }, { x: target.x, y: target.y }, scene, agent.type);
    if (!path || path.length < 2) {
      agent.wait = REST_MIN;
      return;
    }

    agent.route = path;
    agent.route_idx = 1;
    agent.stuck = 0;

    const w = px_to_world(path[1][0], path[1][1]);
    e.walkTo?.(new THREE.Vector3(w.x, floor_y, w.z));
    e.setStatus?.(0x43e0ff);
  }

  /* 供跟随相机取用：entity 的 position / viewYaw / viewPitch 都是现成的 */
  group.userData.agents = agents;

  root.add(group);

  if (cine) {
    cine.add_updater((dt, t) => {
      const step_dt = Math.min(dt, 0.05);
      for (const a of agents) {
        step(a, step_dt);
        a.entity.update(step_dt, t);
      }
    });
  }

  return group;
}
