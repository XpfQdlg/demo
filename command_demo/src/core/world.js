import * as THREE from "three";
import { Dog } from "../entities/dog.js";
import { Humanoid } from "../entities/humanoid.js";
import { build_scene } from "../map/build_scene.js";
import { px_to_world, world_to_px } from "../map/coords.js";
import agents_cfg from "../data/agents.json";

/* ══════════════════════════════════════════════════════════════════════════
   World — 执行体与场景的中央状态

   职责：
   - 按场景构建并缓存执行体实体（四场景各自一份，切走不销毁）
   - 每帧驱动执行体
   - 维护执行体的像素坐标，供 2D 指挥图读取

   不做的事：调度在 dispatch.js，事件在 events.js，视角在 director.js。
   ══════════════════════════════════════════════════════════════════════════ */

/* 场景的站立面高度（米）。地铁站台是抬高的，设备要站在台面上。
   在地图数据里由 build_scene 的 floor_y 字段给出，缺省为 0。 */
function built_floor_y(built) {
  return built && typeof built.floor_y === "number" ? built.floor_y : 0;
}

export class World {  constructor(engine) {
    this.engine = engine;
    this.scenes = new Map(); // scene_id -> { id, built, group, agents }
    this.active = null;
  }

  ensure_scene(scene_id) {
    if (this.scenes.has(scene_id)) return this.scenes.get(scene_id);

    /* engine.ensureScene 负责构建并捕获该场景注册的动画回调 */
    const rec = this.engine.ensureScene(scene_id, () => build_scene(scene_id));
    const built = rec.raw;

    const group = new THREE.Group();
    group.name = `agents:${scene_id}`;
    built.root.add(group);

    const cfg = agents_cfg.agents.filter((a) => a.scene === scene_id);
    /* 人形机器人只走道路，起点也从道路网格里取，否则一出生就站在草地或轨道上 */
    let dog_i = 0;
    let human_i = 0;
    const agents = cfg.map((a) => {
      const pool =
        a.type === "humanoid" && built.road_spawns?.length
          ? built.road_spawns
          : built.spawns;
      const idx = a.type === "humanoid" ? human_i++ : dog_i++;
      return this.make_agent(a, pool[idx % pool.length], built);
    });
    for (const a of agents) group.add(a.entity.root);

    const entry = { id: scene_id, built, group, agents };
    this.scenes.set(scene_id, entry);
    return entry;
  }

  make_agent(cfg, spawn, built) {
    const entity = cfg.type === "dog" ? new Dog({ scale: 1.2 }) : new Humanoid({ scale: 1 });

    /* 两类实体内部命名习惯不同，按类型赋值。
       机器狗用可写的 maxSpeed 字段，人形用 max_speed 字段加 maxSpeed 取值器 */
    if (cfg.type === "dog") entity.maxSpeed = cfg.speed_mps;
    else entity.max_speed = cfg.speed_mps;

    const w = px_to_world(spawn.x, spawn.y);
    /* 场景地面高度：地铁站台抬高 0.9 米，设备要站在台面上而不是埋进去。
       其余场景为 0，行为不变 */
    const floor_y = built_floor_y(built);
    entity.root.position.set(w.x, floor_y, w.z);
    entity.floor_y = floor_y;
    entity.heading = spawn.heading ?? Math.PI;
    entity.root.rotation.y = entity.heading;

    return {
      agent_id: cfg.agent_id,
      name: cfg.name,
      type: cfg.type,
      scene: cfg.scene,
      view_height: cfg.view_height,
      fov: cfg.fov,
      speed_mps: cfg.speed_mps,
      entity,
      x: spawn.x,
      y: spawn.y,
      heading: entity.heading,
      /* 调度状态：idle | moving | scanning | alert */
      status: "idle",
      target: null,
      route: null,
      route_idx: 0,
      event_id: null,
      occupied_until: 0,
    };
  }

  enter_scene(scene_id) {
    const entry = this.ensure_scene(scene_id);
    this.engine.setEnv(entry.built.env);
    this.engine.setActiveScene(scene_id);
    this.active = entry;
    return entry;
  }

  agents_of(scene_id) {
    const s = this.scenes.get(scene_id);
    return s ? s.agents : [];
  }

  agent_by_id(agent_id) {
    for (const s of this.scenes.values()) {
      const hit = s.agents.find((a) => a.agent_id === agent_id);
      if (hit) return hit;
    }
    return null;
  }

  targets_of(scene_id) {
    const s = this.scenes.get(scene_id);
    return s ? s.built.targets : [];
  }

  /* ── 每帧 ─────────────────────────────────────────────────────────── */

  update(dt, t) {
    /* 四个场景都跑实体动画：非活动场景虽然不渲染，但设备可能在移动中，
       切回去时位置要是对的。低模实体计算量很小，可以承受。 */
    for (const s of this.scenes.values()) {
      for (const a of s.agents) {
        a.entity.update(dt, t);
        a.heading = a.entity.heading;
        const p = world_to_px(a.entity.position.x, a.entity.position.z);
        a.x = p.x;
        a.y = p.y;
      }
    }
  }
}
