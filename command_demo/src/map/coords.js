import pkg from "./data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   坐标换算 — 像素坐标与世界坐标的唯一转换点

   约定：
   - 地图、点位、执行体位置，在数据层与接口层一律使用**像素坐标**
   - 只有 3D 渲染与寻路时才转换为世界坐标，转换只在本文件发生
   - 地图换版时只需替换 map_package.json，其余代码不动

   地图口径来自 map_package.json：
     图幅 1079 × 1554 像素，1 像素 = 0.5 米
     对应世界范围约 540 × 777 米，原点取图幅中心
   ══════════════════════════════════════════════════════════════════════════ */

export const MAP = {
  width_px: pkg.image.width,
  height_px: pkg.image.height,
  meters_per_px: pkg.scale.meters_per_px,
};

export const PACKAGE = pkg;

/** 像素 → 世界。返回 { x, z }，对应 three.js 的地面平面 */
export function px_to_world(px, py) {
  return {
    x: (px - MAP.width_px / 2) * MAP.meters_per_px,
    z: (py - MAP.height_px / 2) * MAP.meters_per_px,
  };
}

/** 世界 → 像素 */
export function world_to_px(wx, wz) {
  return {
    x: wx / MAP.meters_per_px + MAP.width_px / 2,
    y: wz / MAP.meters_per_px + MAP.height_px / 2,
  };
}

/** 像素距离 → 米 */
export function px_distance_to_m(d) {
  return d * MAP.meters_per_px;
}

/** 像素距离 → 预估秒数，v_mps 单位 m/s */
export function eta_seconds(d_px, v_mps) {
  return px_distance_to_m(d_px) / Math.max(0.1, v_mps);
}

/** 世界坐标下的整幅尺寸，供相机与雾设置使用 */
export const WORLD = {
  width: MAP.width_px * MAP.meters_per_px,
  depth: MAP.height_px * MAP.meters_per_px,
};
