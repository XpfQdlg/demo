import * as THREE from "three";
import { pbr } from "../core/pbr.js";
import PACKAGE from "../map/data/map_package.json";
import { px_to_world, px_distance_to_m, MAP } from "../map/coords.js";
import { shortest_route } from "../map/choose.js";
import { nav_for } from "../map/nav_grid.js";
import { spread_spots } from "../map/pathfind.js";

/* ══════════════════════════════════════════════════════════════════════════
   monitor — 监控点位、报警与就近调度（观感版）

   为什么单独写一层：主演示的事件层（core/events.js）绑在 World 上，
   观感版没有 World。这里只做三件事，保持轻量：
     1. 摆摄像头点位（立杆 + 云台 + 指示灯），在点位附近铺情景道具
     2. 定时让摄像头「看到」情景，冒报警
     3. 按**路径长度**从空闲设备里挑最近的一台派过去

   与 robots.js 的约定：设备上有 status 与 task 两个字段。
     status  idle 待命 / moving 出警途中 / on_site 到场 / busy 处置中
     task    { incident, on_arrive }，有 task 时 robots 不自己挑航点
   到场后续的扫描、处置、复位都由本模块用定时器推进，robots 只负责走路。

   道具建一次就不再销毁：明火与烟柱在 kit 里注册了逐帧 ticker，
   删掉网格并不会注销 ticker，循环报警每轮重建会越攒越多。
   处置完只把道具隐藏，下一轮再显示。
   ══════════════════════════════════════════════════════════════════════════ */

const KINDS = ["fire", "trash", "crowd"];
const KIND_NAME = {
  fire: "明火",
  trash: "垃圾堆积",
  crowd: "人员聚集",
  smoke: "违规吸烟",
  hydrant: "消防栓异常",
  ext: "灭火器异常",
  exit: "疏散通道堵塞",
  ebike: "非机动车载人",
  parking: "车辆违停占道",
  door: "屏蔽门状态异常",
};
const SCENE_NAME = { campus: "校园", community: "小区", forest: "西山林区", subway: "地铁站厅" };

const FIRST_ALARM = 5;    // 场景加载后首起报警，留出镜头安顿的时间
const ALARM_GAP = 9;     // 相邻两起报警的间隔：点位多、间隔短，事件流一直有东西进来
const RETRY_GAP = 5;      // 没有空闲设备、或没有可达路径时的重试间隔
const CYCLE_GAP = 30;    // 一轮全部处置完后隔多久重新开一轮（别让大屏冷场）
const COVERAGE_PX = 60;   // 摄像头覆盖半径，30 米
const SCAN_S = 1.8;       // 到场后的扫描时间
const HANDLE_S = 3.2;     // 扫描完到处置完成的时间

/* ── 区域名 ────────────────────────────────────────────────────────────
   报警文案要报「哪个区域」。校园数据包里有 18 个带名字的区域
   （1号教学楼、图书馆、北区学生公寓……），取最近的一个加方位。
   小区与森林没有建筑名可用，退回场景名。 */

/* 校园数据包里每栋楼都带名字，但那是校园的楼。
   森林与地铁是独立场景，站厅在图上落在校园南边界附近，照搬校园的楼名
   会报出「南部水体西侧发现明火」这种驴唇不对马嘴的文案，所以只有
   校园与小区两个页签用楼名。 */
const NAMED_SCENES = new Set(["campus", "community"]);

const BUILDINGS = (PACKAGE.buildings || [])
  .filter((b) => b.name && (b.polygon || []).length >= 3)
  .map((b) => ({ name: b.name, poly: b.polygon }));

/* 各场景地块的中心：没有楼名可用时，按「场地中心的东西南北」报方位 */
const ZONE_CENTERS = {};

function zone_center(scene) {
  if (ZONE_CENTERS[scene] !== undefined) return ZONE_CENTERS[scene];
  const poly = PACKAGE.zones?.[scene]?.polygon || [];
  let c = null;
  if (poly.length >= 3) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    c = { x: sx / poly.length, y: sy / poly.length };
  }
  ZONE_CENTERS[scene] = c;
  return c;
}

/** 点到线段的距离，用来量「离这栋楼有多远」 */
function seg_dist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function poly_dist(px, py, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    d = Math.min(d, seg_dist(px, py, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/* 方位按图幅像素坐标算：x 向东、y 向南。贴得太近就不加方位 */
function side_of(px, cx, cy) {
  const dx = px[0] - cx;
  const dy = px[1] - cy;
  if (Math.abs(dx) < 25 && Math.abs(dy) < 25) return "";
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "东" : "西") : (dy > 0 ? "南" : "北");
}

function area_of(px, scene) {
  if (NAMED_SCENES.has(scene)) {
    let best = null;
    let bd = Infinity;
    for (const b of BUILDINGS) {
      const d = poly_dist(px[0], px[1], b.poly);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    /* 离楼脚 15 米以内才算「这栋楼旁边」。
       原来按楼体中心算 47 米，大片空地也被算进楼名里了 */
    if (best && bd < 30) {
      let sx = 0;
      let sy = 0;
      for (const [x, y] of best.poly) {
        sx += x;
        sy += y;
      }
      const side = side_of(px, sx / best.poly.length, sy / best.poly.length);
      return `${best.name}${side ? side + "侧" : ""}`;
    }
  }

  /* 附近没有建筑（森林、站厅、校园空地）：用场内方位兜底 */
  const c = zone_center(scene) || { x: MAP.width_px / 2, y: MAP.height_px / 2 };
  const side = side_of(px, c.x, c.y);
  return `${SCENE_NAME[scene] || "场内"}${side ? side + "侧" : ""}`;
}

/* ── 摄像头道具 ────────────────────────────────────────────────────────
   立杆 + 悬臂 + 云台。灯是独立材质，报警时靠自发光强度闪烁。 */

function camera_pole(yaw, h, led) {
  const g = new THREE.Group();
  const metal = pbr("metal", { repeat: 1, metalness: 0.75, envIntensity: 1.35, tint: 0x6d747a });
  const shell = pbr("metal", { repeat: 1, metalness: 0.3, roughness: 0.55, envIntensity: 1.2, tint: 0xd6dbe0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x131b24, roughness: 0.18, metalness: 0.6 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, h, 10), metal);
  pole.position.y = h / 2;
  pole.castShadow = true;
  g.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.06), metal);
  arm.position.set(0.36, h - 0.08, 0);
  arm.castShadow = true;
  g.add(arm);

  /* 云台：镜头朝下压一点，像真的在俯拍地面 */
  const head = new THREE.Group();
  head.position.set(0.74, h - 0.16, 0);
  head.rotation.z = -0.34;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.2), shell);
  housing.castShadow = true;
  head.add(housing);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.07, 12), glass);
  lens.rotation.z = Math.PI / 2;
  lens.position.x = 0.24;
  head.add(lens);
  g.add(head);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), led);
  bulb.position.set(0.74, h - 0.02, 0);
  g.add(bulb);

  g.rotation.y = yaw;
  return g;
}

/* ── 主体 ────────────────────────────────────────────────────────────── */

export class Monitor {
  /**
   * @param root       场景根节点，摄像头与道具都挂进去
   * @param scene      场景 id
   * @param agents     robots.js 给出的设备数组，读写 status / task
   * @param floor_y    地面高度，地铁站台是 0.9 米
   * @param make_prop  (kind, px, seed) => Object3D，由 life.js 提供
   * @param kind_names 可选，异常类型在各场景的叫法（森林的 fire 叫「火险烟雾」等），
   *                   不给就用通用名。四个场景模型的口径在 mobile/contract.js
   * @param kinds      可选，本场景轮流报警的类型，默认 fire/trash/crowd；
   *                   各场景只给「有实拍照片能对上」的类型（见 SCENE_MODELS.alert_kinds）
   * @param hooks      回调：on_alarm / on_dispatched / on_arrive / on_handling / on_resolve
   */
  constructor({ root, scene, agents, floor_y = 0, make_prop, kind_names = null, kinds = null, hooks = {} }) {
    this.root = root;
    this.scene = scene;
    this.agents = agents || [];
    this.floor_y = floor_y;
    this.make_prop = make_prop;
    this.kind_names = kind_names;
    this.kinds = Array.isArray(kinds) && kinds.length ? kinds : KINDS;
    this.hooks = hooks;

    this.cameras = [];
    this.incidents = [];
    this.group = new THREE.Group();
    this.group.name = "monitor";
    this.group.userData.no_merge = true;   // 指示灯与光圈要逐帧改，不能烘进静态几何
    root.add(this.group);

    this.timer = FIRST_ALARM;
    this.time = 0;
    this.round = 0;
    this.timers = [];
    /* 观众上报用的道具按类型复用：make_prop 会给火焰/烟柱注册逐帧 ticker，
       每次上报都新建会越攒越多，复用一套、每轮只改位置与显隐 */
    this.visitor_props = new Map();
  }

  /* ── 建点位 ──────────────────────────────────────────────────────── */

  /**
   * @param count      监控点位数
   * @param center_px  可选，点位限制在这个像素圆内（小区页签复用校园场景时用）
   * @param radius_px  与 center_px 配套的半径
   */
  build({ count = 3, center_px = null, radius_px = 0 } = {}) {
    const nav_all = nav_for(this.scene, "all");
    if (!nav_all) return;

    /* 点位离最近的设备控制在 35 米上下：
       挨得太近，报警时机器就在旁边八米，「已呼叫最近的机器前往」没有说服力；
       离得太远，人形机器人一米三的速度要跑一分半，展台上等不起。
       小区只有一百米见方，照搬校园的目标距离会一个点位都挑不出来，
       所以按范围半径缩放。 */
    this.target_px = center_px ? Math.max(34, radius_px * 0.4) : 70;
    const TARGET_PX = this.target_px;
    const SEP_PX = this.target_px;

    /* 到「任何设备可能到达的位置」的最近距离。
       除了设备当前位置，还要算上它们的巡检航点：摄像头与巡检航点
       是同一套「开阔且分散」的取点规则挑出来的，点位撞在一起的话，
       报警时机器正好站在事发点上，文案就成了「已呼叫 4 米外的机器前往」。 */
    const dmin_of = (p) => {
      let d = Infinity;
      for (const a of this.agents) {
        d = Math.min(d, Math.hypot(p[0] - a.x, p[1] - a.y));
        for (const [x, y] of a.points || []) d = Math.min(d, Math.hypot(p[0] - x, p[1] - y));
      }
      return d;
    };

    /* 摄像头优先摆在路网附近：立杆在广场正中不像监控，像路灯被撞歪了。
       路网网格太窄、取不到开阔点时退回全体可行走网格。 */
    const nav_road = nav_for(this.scene, "road");
    const on_road = (p) => !!nav_road && nav_road.walkable_px(p[0], p[1]);

    let cand;
    if (center_px) {
      /* 限定范围的页签（小区）要自己在范围内扫格子：
         spread_spots 是全场撒点，撒完再筛，筛进小范围的通常只剩一两个 */
      cand = [];
      const step = 16;
      for (let y = center_px[1] - radius_px; y <= center_px[1] + radius_px; y += step) {
        for (let x = center_px[0] - radius_px; x <= center_px[0] + radius_px; x += step) {
          if (Math.hypot(x - center_px[0], y - center_px[1]) > radius_px) continue;
          if (nav_all.walkable_px(x, y)) cand.push([x, y]);
        }
      }
    } else {
      cand = nav_road ? spread_spots(nav_road, count * 6, 60) : [];
      if (cand.length < count) cand = spread_spots(nav_all, count * 6, 60);
    }
    if (!cand.length) cand = spread_spots(nav_all, count * 3, 90);

    /* 每台设备各配一个点位：只按「离设备近」排序会把三个摄像头
       全塞在同一片有设备的地方，地图另一头一场报警都没有。
       按设备轮着挑，点位自然铺开。 */
    const spots = [];
    const far_enough = (p) => spots.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= SEP_PX);

    for (let k = 0; k < count && this.agents.length; k++) {
      const a = this.agents[k % this.agents.length];
      let best = null;
      for (const p of cand) {
        if (!far_enough(p)) continue;
        /* 主项看「离最近的那台设备有多远」：只要有一台设备就在点位边上，
           报警就会变成「已呼叫 3 米外的机器前往」。次项才用来把点位绑到
           不同的设备上，让三个点位铺开。 */
        const d =
          Math.abs(dmin_of(p) - TARGET_PX) +
          0.35 * Math.abs(Math.hypot(p[0] - a.x, p[1] - a.y) - TARGET_PX) -
          (on_road(p) ? 10 : 0);   // 路边优先，差得不多的时候立杆站在路上更像监控
        if (!best || d < best.d) best = { p, d };
      }
      if (best) spots.push(best.p);
    }

    /* 设备比点位数少、或者场地太窄挑不开时按最近距离补齐 */
    if (spots.length < count) {
      const rest = cand
        .map((p) => ({ p, d: Math.abs(dmin_of(p) - TARGET_PX) }))
        .sort((a, b) => a.d - b.d);
      for (const { p } of rest) {
        if (spots.length >= count) break;
        if (spots.includes(p)) continue;
        spots.push(p);
      }
    }
    if (!spots.length) return;

    const pole_h = this.scene === "subway" ? 2.6 : 4.4;   // 站厅顶棚只有 6 米

    for (let i = 0; i < Math.min(count, spots.length); i++) {
      const cam_px = spots[i];
      const inc_px = this._near(nav_all, cam_px, 16 + (i % 3) * 6);
      const cam = this._add_camera(cam_px, inc_px, i, pole_h);
      this._add_incident(this.kinds[i % this.kinds.length], inc_px, cam, i);
    }
  }

  /**
   * 在点位附近找一个可行走的点当「事发点」，保证设备走得到。
   * 八个方向里挑离设备最远的那个：出事地点正好压在机器脚下，
   * 「已呼叫最近的机器前往」就成了一句笑话。
   */
  _near(nav, px, r) {
    let best = null;
    let best_d = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = px[0] + Math.cos(a) * r;
      const y = px[1] + Math.sin(a) * r;
      if (!nav.walkable_px(x, y)) continue;
      let d = Infinity;
      for (const ag of this.agents) {
        d = Math.min(d, Math.hypot(x - ag.x, y - ag.y));
        for (const [ox, oy] of ag.points || []) d = Math.min(d, Math.hypot(x - ox, y - oy));
      }
      if (d > best_d) {
        best_d = d;
        best = [x, y];
      }
    }
    if (best) return best;
    const p = nav.nearest(px[0], px[1], 30);
    return p || px;
  }

  _add_camera(cam_px, inc_px, i, pole_h) {
    const w = px_to_world(cam_px[0], cam_px[1]);
    const t = px_to_world(inc_px[0], inc_px[1]);
    /* 模型悬臂指向局部 +x，绕 y 转成朝事发点：局部 +x 对应世界 (cos, -sin) */
    const yaw = Math.atan2(-(t.z - w.z), t.x - w.x);

    const led = new THREE.MeshStandardMaterial({
      color: 0x3a1210,
      emissive: 0xff2a1e,
      emissiveIntensity: 0.18,
      roughness: 0.45,
    });
    const g = camera_pole(yaw, pole_h, led);
    g.position.set(w.x, this.floor_y, w.z);
    this.group.add(g);

    const cam = {
      id: `cam-${i + 1}`,
      px: cam_px,
      world: w,
      group: g,
      led,
      height: pole_h,
      alarm: false,
    };
    this.cameras.push(cam);
    return cam;
  }

  _add_incident(kind, inc_px, cam, i) {
    const inc = {
      idx: i,
      kind,
      /* 同一个 fire/crowd/trash，在森林叫「火险烟雾」、在地铁叫「通道遗留物」，
         大屏与手机看到的名称一致，讲解时不会串场 */
      name: this.kind_names?.[kind] || KIND_NAME[kind],
      area: area_of(inc_px, this.scene),
      px: inc_px,
      camera: cam,
      prop: null,
      ring: null,
      status: "wait",   // wait → alarm → dispatched → on_site → done
      fired: false,
      by: null,
      distance_m: 0,
      eta_s: 0,
    };

    /* 道具只建一次。种子按点位定，重开一轮时摆出来的是同一堆东西 */
    const prop = this.make_prop(kind, inc_px, 100 + i * 7);
    prop.position.y = this.floor_y;
    this.group.add(prop);
    inc.prop = prop;

    this.incidents.push(inc);
    return inc;
  }

  /* ── 每帧 ────────────────────────────────────────────────────────── */

  tick(dt) {
    this.time += dt;
    this._pulse();

    this.timer -= dt;
    if (this.timer <= 0) this._advance();
  }

  /** 报警灯闪烁 + 地面光圈呼吸 */
  _pulse() {
    for (const cam of this.cameras) {
      cam.led.emissiveIntensity = cam.alarm
        ? 1.6 + Math.sin(this.time * 9) * 0.9
        : 0.16;
    }
    for (const inc of this.incidents) {
      if (!inc.ring || !inc.ring.visible) continue;
      const k = Math.sin(this.time * 3.6);
      inc.ring.scale.setScalar(1 + k * 0.1);
      inc.ring.material.opacity = 0.42 + k * 0.2;
    }
  }

  /** 计时到点：先补派已经报过警但还没派出去的事故，再开新的一起 */
  _advance() {
    const pending = this.incidents.find((i) => i.status === "alarm");
    if (pending) {
      this._try_dispatch(pending);
      return;
    }

    const next = this._next_waiting();
    if (next) {
      this._alarm(next);
      return;
    }

    if (this.incidents.length && this.incidents.every((i) => i.status === "done")) {
      this._restart();
      return;
    }

    this.timer = RETRY_GAP;
  }

  /**
   * 这一轮先报哪一起。
   * 设备一直在巡检，建点位时的距离到报警时早就变了；按「此刻有没有一台
   * 空闲设备在 27 米上下」挑，派出去的路程才稳定在二三十米，
   * 展台上看得完「发现—前往—处置」的完整过程。
   */
  _next_waiting() {
    const waiting = this.incidents.filter((i) => i.status === "wait");
    if (!waiting.length) return null;

    const idle = this.agents.filter((a) => a.status === "idle");
    if (!idle.length) return waiting[0];

    let best = null;
    for (const inc of waiting) {
      let d = Infinity;
      for (const a of idle) d = Math.min(d, Math.hypot(a.x - inc.px[0], a.y - inc.px[1]));
      /* 建点位时的目标距离打个八折：报警时设备已经在巡检路上了，
         太近没有说服力，太远又要跑一分多钟 */
      const score = Math.abs(d - this.target_px * 0.8);
      if (!best || score < best.score) best = { inc, score };
    }
    return best.inc;
  }

  /* ── 报警 ────────────────────────────────────────────────────────── */

  _alarm(inc) {
    inc.fired = true;
    inc.status = "alarm";
    inc.camera.alarm = true;
    this._ring(inc, true);
    this.hooks.on_alarm?.({ inc });

    this._try_dispatch(inc);
  }

  /**
   * 从空闲设备里挑折线最短的一台，不派，只挑。
   * 距离按 A* 折线长度算，不是直线距离——算法与主演示共用 map/choose.js。
   */
  _nearest_idle(target_px) {
    const idle = this.agents.filter((a) => a.status === "idle" && !a.task);
    const goal = { x: target_px[0], y: target_px[1] };
    return shortest_route(idle, goal, this.scene);
  }

  /** 折线长度换算成米与秒 */
  _leg_len(best) {
    const len_m = px_distance_to_m(best.len_px);
    /* ETA 按演示速度算：上限 3.8 m/s，否则九十米要跑一分钟，大屏上像卡住了。
       真机约 1.2～1.6 m/s，对外讲的时候按 1.6 换算，别念屏幕上的秒数。 */
    const v = Math.min(best.agent.entity.maxSpeed ?? best.agent.entity.max_speed ?? 2.4, 3.8);
    return { len_m, eta_s: len_m / Math.max(0.3, v) };
  }

  /**
   * 手动派单：点地面任意位置，派一台过去，到了原地待命。
   * 与报警调度的差别只在到场之后——不回扫、不处置，也不占用事件。
   *
   * @param target_px 目标像素坐标
   * @param prefer    正在跟随的那台：它空闲就派它，讲解时点哪儿它就去哪儿
   */
  dispatch_to(target_px, prefer = null) {
    const goal = { x: target_px[0], y: target_px[1] };
    let best = null;

    if (prefer && prefer.status === "idle" && !prefer.task) {
      best = shortest_route([prefer], goal, this.scene);
    }

    if (!best) best = this._nearest_idle(target_px);
    if (!best) return null;

    const a = best.agent;
    const { len_m, eta_s } = this._leg_len(best);

    a.status = "moving";
    a.route = best.path;
    a.route_idx = 1;
    a.stuck = 0;
    a.task = { incident: null, on_arrive: (agent) => this._manual_arrive(agent) };
    a.entity.setStatus?.(0x8fd8ff);

    return { agent: a, distance_m: len_m, eta_s };
  }

  _manual_arrive(agent) {
    agent.status = "idle";
    agent.task = null;
    agent.target = null;
    agent.entity.setStatus?.(0x43e0ff);
    this.hooks.on_manual_arrive?.({ agent });
  }

  /**
   * 观众上报：在监控层里生成一起「观众上报」异常，立即报警并走就近派单。
   *
   * 与 3 个摄像头点位的自动报警共用同一套状态机与回调，所以大屏气泡、
   * 事件流、手机预警都能照常收到；区别只有 inc.visitor=true 和处置完成后
   * 从 incidents 里摘掉，不参与 45 秒一轮的循环重开。
   *
   * 3D 道具按类型复用（见 visitor_props）：火焰/烟柱不能反复创建。
   *
   * @param kind        异常类型 fire/crowd/trash
   * @param command_id  手机上报指令 id，会带进事件里用于去重
   * @returns {object|null} 成功返回 incident；现场没有可用监控点位时返回 null
   */
  trigger_visitor_report({ kind = "fire", command_id = null } = {}) {
    if (!this.cameras.length) return null;
    const safe_kind = this.kinds.includes(kind) ? kind : this.kinds[0];

    const nav = nav_for(this.scene, "all");
    /* 展台上观众上报后，机器狗最好十几二十米就赶到，不能派到场地另一头
       跑两分钟。做法：先选一个「正在摄像头覆盖区内巡检」的空闲执行体，
       在它身边 20 像素内找一个可行走点当上报点，再把最近的摄像头作为画面来源。
       没有空闲执行体时退回摄像头附近的上报点。 */
    const idle = this.agents.filter((a) => a.status === "idle" && !a.task);
    let px = null;
    if (idle.length) {
      let best_agent = idle[0];
      let best_cam_dist = Infinity;
      for (const agent of idle) {
        for (const cam of this.cameras) {
          const d = Math.hypot(agent.x - cam.px[0], agent.y - cam.px[1]);
          if (d < best_cam_dist) {
            best_cam_dist = d;
            best_agent = agent;
          }
        }
      }
      px = nav ? this._near(nav, [best_agent.x, best_agent.y], 20) : [best_agent.x, best_agent.y];
    }
    if (!px) {
      const anchor_px = this.cameras[0].px;
      px = nav ? this._near(nav, anchor_px, 20) : anchor_px;
    }
    const w = px_to_world(px[0], px[1]);

    /* 最近的摄像头作为这次上报的「画面来源」 */
    let camera = this.cameras[0];
    let best = Infinity;
    for (const cam of this.cameras) {
      const d = Math.hypot(cam.px[0] - px[0], cam.px[1] - px[1]);
      if (d < best) {
        best = d;
        camera = cam;
      }
    }

    let prop = this.visitor_props.get(safe_kind);
    if (!prop) {
      prop = this.make_prop(safe_kind, px, 900);
      prop.position.y = this.floor_y;
      this.group.add(prop);
      this.visitor_props.set(safe_kind, prop);
    }
    prop.position.set(w.x, this.floor_y, w.z);
    prop.visible = true;

    const inc = {
      idx: this.incidents.length + 900,
      kind: safe_kind,
      /* 与自动报警同一套场景本地化名：地铁的 trash 叫「通道遗留物」 */
      name: this.kind_names?.[safe_kind] || KIND_NAME[safe_kind],
      area: area_of(px, this.scene),
      px,
      camera,
      prop,
      ring: null,
      status: "wait",
      fired: false,
      by: null,
      distance_m: 0,
      eta_s: 0,
      visitor: true,
      /* 指挥流指令 id：总线用它判断「这条上报是否已经被大屏处理」，
         避免大屏响应超时后兜底与真出警各出一张卡 */
      command_id: command_id || null,
    };
    this.incidents.push(inc);
    this._ring(inc, true);
    this._alarm(inc);
    return inc;
  }

  _try_dispatch(inc) {
    const best = this._nearest_idle(inc.px);

    /* 没有空闲设备、或者一条可达路径都没有：留在待派，过几秒再试 */
    if (!best) {
      this.timer = RETRY_GAP;
      return;
    }

    const a = best.agent;
    const { len_m, eta_s } = this._leg_len(best);

    a.status = "moving";
    a.route = best.path;
    a.route_idx = 1;
    a.stuck = 0;
    a.task = {
      incident: inc,
      on_arrive: (agent) => this._arrive(inc, agent),
    };
    a.entity.setStatus?.(0xff8a3c);

    inc.status = "dispatched";
    inc.by = a;
    inc.distance_m = len_m;
    inc.eta_s = eta_s;

    this.timer = ALARM_GAP;
    this.hooks.on_dispatched?.({ inc, agent: a, distance_m: len_m, eta_s });
  }

  /* ── 到场 → 处置 → 关闭 ──────────────────────────────────────────── */

  _arrive(inc, agent) {
    inc.status = "on_site";
    agent.status = "busy";
    agent.entity.startScan?.(SCAN_S);
    this.hooks.on_arrive?.({ inc, agent });

    const t1 = setTimeout(() => {
      agent.entity.endScan?.();
      agent.entity.setStatus?.(inc.kind === "fire" ? 0xff5a6a : 0xffb454);
      this.hooks.on_handling?.({ inc, agent });

      const t2 = setTimeout(() => this._resolve(inc, agent), HANDLE_S * 1000);
      this.timers.push(t2);
    }, SCAN_S * 1000);
    this.timers.push(t1);
  }

  _resolve(inc, agent) {
    inc.status = "done";
    inc.camera.alarm = false;
    this._ring(inc, false);
    if (inc.prop) inc.prop.visible = false;

    agent.status = "idle";
    agent.task = null;
    agent.target = null;
    agent.entity.setStatus?.(0x43e0ff);

    this.hooks.on_resolve?.({ inc, agent });

    /* 观众上报是一次性事件：闭环后摘出列表，不参与后续循环重开。
       道具按类型留着复用，不能销毁（ticker 注销不了）。 */
    if (inc.visitor) {
      const index = this.incidents.indexOf(inc);
      if (index >= 0) this.incidents.splice(index, 1);
      if (inc.ring) inc.ring.visible = false;
    }
  }

  /** 一轮全部处置完，过一会儿重开：道具复位，但设备不动，接着巡检 */
  _restart() {
    this.round++;
    for (const inc of this.incidents) {
      inc.status = "wait";
      inc.fired = false;
      inc.by = null;
      inc.distance_m = 0;
      inc.eta_s = 0;
      inc.camera.alarm = false;
      this._ring(inc, false);
      if (inc.prop) inc.prop.visible = true;
    }
    this.timer = CYCLE_GAP;
  }

  /* ── 地面光圈：报警时把事发点圈出来，五百米俯视也能看见 ───────────── */

  _ring(inc, on) {
    if (!inc.ring) {
      /* 半径 3.2~4.6 米：全局俯视时全场约五百米压在 1600 像素里，
         两米的圈只有三四个像素，等于没有 */
      const geo = new THREE.RingGeometry(3.2, 4.6, 48);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff4a38,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      const w = px_to_world(inc.px[0], inc.px[1]);
      ring.position.set(w.x, this.floor_y + 0.06, w.z);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 5;
      this.group.add(ring);
      inc.ring = ring;
    }
    inc.ring.visible = !!on;
  }

  /* ── 收拾 ────────────────────────────────────────────────────────── */

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.hooks = {};
    this.root?.remove(this.group);
    this.cameras = [];
    this.incidents = [];
  }
}
