import * as THREE from "three";
import { px_to_world, MAP } from "../map/coords.js";
import { nav_for } from "../map/nav_grid.js";
import { person, addTick } from "./kit.js";

/* ══════════════════════════════════════════════════════════════════════════
   Crowd — 场景里的行人

   两个用途：
     1. 场景氛围：各处有人在走，路线上有人，画面才不是空城
     2. 事件支撑：人员密度异常的点位必须真的有人聚集，否则「检测到拥挤」
        画面上却空无一人，讲解时说不通

   走位规则：
     - 只在可行走网格上活动，人形走 road 网格，不会进楼、不会下轨道
     - 目标点选 40 米内、直线可达（沿途逐米检查网格）的点，走不过去就换
     - 步速 1.0~1.5 米/秒，接近真人

   性能：
     每个人是 K.person 生成的低模，约 7 个网格。每个场景十几个，
     全部用一条 ticker 推进位置；摆动由 person 自带的 ticker 负责。
   ══════════════════════════════════════════════════════════════════════════ */

const SHIRTS = [0x3b6ea5, 0x8d3b3b, 0x4a5b6b, 0x6b7a4a, 0x8a6a3b, 0x555b7a, 0x2f5050];

function rng_of(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 沿两点直线逐米检查，确认整条路都可走 */
function line_ok(nav, x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.ceil(d / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!nav.walkable_px(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
  }
  return true;
}

/** 在网格上随机取一个可走点，尽量靠近 (cx, cy) */
function random_point_near(nav, cx, cy, radius_px, rnd, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius_px;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (nav.walkable_px(x, y)) return [x, y];
  }
  return null;
}

export class Crowd {
  /**
   * @param scene_id  场景 id
   * @param nav_kind  'road' 只走道路 / 'all' 建筑外都行
   * @param count     人数
   * @param seed      确定性随机种子
   * @param center    生成范围中心（像素），缺省用整张图
   */
  constructor({ scene_id, nav_kind = "road", count = 12, seed = 1, center = null, radius_px = 110, floor_y = 0 } = {}) {
    this.scene_id = scene_id;
    this.nav = nav_for(scene_id, nav_kind);
    this.count = count;
    this.seed = seed;
    this.center = center;
    this.radius_px = radius_px;
    /* 地面高度。地铁站台比地坪高 0.9 米，不抬起来人的下半身就埋进台面，
       画面上只剩上半身在飘 */
    this.floor_y = floor_y;
    this.people = [];
  }

  /** 生成人群，返回可直接加入场景根节点的 Group */
  build() {
    const g = new THREE.Group();
    g.name = "crowd";
    const nav = this.nav;
    if (!nav) return g;

    const rnd = rng_of(this.seed);

    /* 起点：没给中心就在全域里找可走点。
       小区的道路网格只有 6~7 米宽，必须先在整条路上找落脚点，
       再以它为圆心撒人；否则一开始就在某个小半径里找不到可走格。 */
    let cx = this.center ? this.center[0] : null;
    let cy = this.center ? this.center[1] : null;
    if (cx == null) {
      const nav_w = nav.w * nav.div;
      const nav_h = nav.h * nav.div;
      for (let i = 0; i < 600 && cx == null; i++) {
        const p = random_point_near(nav, nav_w / 2, nav_h / 2, Math.max(nav_w, nav_h), rnd);
        if (p) [cx, cy] = p;
      }
      if (cx == null) return g;
    } else if (!nav.walkable_px(cx, cy)) {
      /* 给的中心点落在不可走处时，先吸附到最近的可走点 */
      const near = nav.nearest(cx, cy);
      if (near) [cx, cy] = near;
    }

    for (let i = 0; i < this.count; i++) {
      /* 先按半径找，找不到就退到全网格随机取，保证人数够 */
      let start = random_point_near(nav, cx, cy, this.radius_px, rnd);
      if (!start) start = this._any_walkable(rnd);
      if (!start) continue;

      const height = 0.94 + rnd() * 0.12;
      const p = person({
        shirt: SHIRTS[(rnd() * SHIRTS.length) | 0],
        /* 裤子要压深：铺装地面是浅灰的，浅色裤腿在远处直接融进地面，
           只剩上半身飘着 */
        pants: rnd() > 0.5 ? 0x39414b : 0x4a4048,
        hat: rnd() > 0.82 ? (rnd() > 0.5 ? "cap" : "helmet") : null,
        tall: height,
        walk: true,
      });

      const w = px_to_world(start[0], start[1]);
      p.position.set(w.x, this.floor_y, w.z);
      const heading = rnd() * Math.PI * 2;
      p.rotation.y = heading;
      g.add(p);

      this.people.push({
        g: p,
        x: start[0],
        y: start[1],
        heading,
        speed: 1.0 + rnd() * 0.5,
        target: null,
        wait: rnd() * 2,
        rnd,
      });
    }

    /* 一条 ticker 推进所有人，避免每人一个回调。
       addTick 在场景构建期间调用，engine 会把它归到本场景，切走即停。 */
    addTick((t, dt) => this.update(dt));

    return g;
  }

  /** 在全网格里随机取一个可走点，作为半径内取不到时的兜底 */
  _any_walkable(rnd) {
    const nav = this.nav;
    if (!nav) return null;
    const w = nav.w * nav.div;
    const h = nav.h * nav.div;
    for (let i = 0; i < 400; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      if (nav.walkable_px(x, y)) return [x, y];
    }
    return null;
  }

  update(dt) {
    const nav = this.nav;
    if (!nav) return;
    const step = Math.min(dt, 0.05);

    for (const it of this.people) {
      if (!it.target) {
        it.wait -= step;
        if (it.wait > 0) continue;

        const t = random_point_near(nav, it.x, it.y, this.radius_px * 0.6, it.rnd);
        if (!t || !line_ok(nav, it.x, it.y, t[0], t[1])) {
          it.wait = 0.6;
          continue;
        }        it.target = t;
      }

      const [tx, ty] = it.target;
      const dx = tx - it.x;
      const dy = ty - it.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.2) {
        it.target = null;
        it.wait = 0.8 + it.rnd() * 2.4;
        continue;
      }

      const want = Math.atan2(dx, dy);
      let diff = want - it.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      it.heading += Math.max(-2.4 * step, Math.min(2.4 * step, diff));

      const mv = it.speed * step;
      it.x += Math.sin(it.heading) * mv;
      it.y += Math.cos(it.heading) * mv;

      const w = px_to_world(it.x, it.y);
      it.g.position.x = w.x;
      it.g.position.z = w.z;
      it.g.rotation.y = it.heading;
    }
  }
}

/**
 * 静止人群：用在「人员密度异常」的点位。
 * 围成一圈站着，带轻微晃动，看起来是在排队或围观。
 */
export function crowd_cluster({ center_px, count = 9, seed = 5, radius_px = 14 }) {
  const g = new THREE.Group();
  g.name = "crowd_cluster";
  const rnd = rng_of(seed);
  const [cx, cy] = center_px;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.5;
    const r = radius_px * (0.35 + rnd() * 0.65);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;

    const p = person({
      shirt: SHIRTS[(rnd() * SHIRTS.length) | 0],
      tall: 0.93 + rnd() * 0.14,
      walk: false,
    });
    const w = px_to_world(px, py);
    p.position.set(w.x, 0, w.z);
    p.rotation.y = Math.atan2(cx - px, cy - py) + (rnd() - 0.5) * 0.6;
    g.add(p);
  }
  return g;
}
