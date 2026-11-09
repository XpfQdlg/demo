import { cls } from "../data/classes.js";

/* ══════════════════════════════════════════════════════════════════════════
   场景模块公共件 — 让每个场景文件只写"摆什么"，文案/风险等级交给类别库
   ══════════════════════════════════════════════════════════════════════════ */

/** 组装检测点位；over 可覆盖任意字段 */
export function T(id, name, klass, pos, stand, over = {}) {
  const c = cls(klass);
  const t = {
    id,
    name,
    cls: klass,
    pos,
    stand,
    sev: c.sev,
    model: c.model,
    size: c.size,
    desc: c.desc,
    action: c.action,
    conf: 0.9,
  };
  return Object.assign(t, over);
}

/** 把道具组挂到 root 并登记为点位 */
export function attach(root, targets, t, g, opts = {}) {
  if (g) {
    g.position.x += t.pos[0];
    g.position.z += t.pos[2];
    if (opts.rotY) g.rotation.y = opts.rotY;
    root.add(g);
  }
  targets.push(t);
  return t;
}

/** 沿折线判断距离，用来给树/杂物留出通行带 */
export function polyDist(pts) {
  return (x, z) => {
    let m = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      m = Math.min(m, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
    return m;
  };
}

/** 由点位自动生成巡游折线：spawn → 各站点 → spawn */
export function routeOf(spawn, targets) {
  const pts = [[spawn.x, spawn.z]];
  for (const t of targets) pts.push([t.stand[0], t.stand[1]]);
  return pts;
}
