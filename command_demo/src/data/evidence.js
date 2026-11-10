/**
 * 现场抓拍样片。
 *
 * 「事件流 + 一张现场照片」比纯文字可信得多，但图必须和事件对得上：
 * 明火就出烟雾照、消防栓异常就出栓体照、出口堵塞就出安全出口照。
 * 所以这里按「场景 × 异常类型」挑图，而不是按场景轮播——
 * 轮播时 垃圾堆积 会抽到 白车，观众一眼就看出是摆设。
 *
 * 照片放在 public/photos（构建时原样拷进 dist）；
 * 单文件版由 bundle.mjs 内联进 window.__INLINE_ASSETS，file:// 也能出图。
 */

const BASE = import.meta.env.BASE_URL || "/";

function photo_src(name) {
  const key = `photos/${name}.jpg`;
  const inline = typeof window !== "undefined" ? window.__INLINE_ASSETS : null;
  return inline?.[key] || `${BASE}${key}`;
}

/* 每个场景只登记「手里真有照片」的类型，和 SCENE_MODELS.alert_kinds 一一对应。
   同类型给 2–3 张，按事发点做稳定哈希轮换，同一起报警刷新后还是同一张。 */
export const EVIDENCE_PHOTOS = {
  campus: {
    fire: [
      { src: photo_src("forest-smoke-3"), note: "绿化带 · 明火隐患" },
      { src: photo_src("forest-smoke-1"), note: "教学楼后 · 违规用火" },
    ],
    smoke: [
      { src: photo_src("forest-smoke-1"), note: "绿化带 · 违规吸烟" },
      { src: photo_src("forest-smoke-2"), note: "林荫道 · 违规吸烟" },
    ],
    crowd: [
      { src: photo_src("campus-road-3"), note: "校园道路 · 人流集中" },
      { src: photo_src("campus-road-4"), note: "人行横道 · 人流集中" },
    ],
    hydrant: [{ src: photo_src("campus-hydrant-1"), note: "消防栓 · 被植被遮挡" }],
    exit: [
      { src: photo_src("campus-exit-1"), note: "安全出口 · 通道堆放" },
      { src: photo_src("community-exit-1"), note: "安全出口 · 指示牌" },
    ],
    trash: [{ src: photo_src("campus-road-2"), note: "东门主路 · 堆积物" }],
  },
  community: {
    crowd: [
      { src: photo_src("community-corridor-2"), note: "楼道 · 出入口拥挤" },
      { src: photo_src("campus-road-4"), note: "单元门外 · 人流" },
    ],
    trash: [{ src: photo_src("community-corridor-3"), note: "楼道 · 垃圾桶满溢" }],
    ext: [
      { src: photo_src("community-ext-1"), note: "楼道 · 灭火器箱" },
      { src: photo_src("subway-ext-1"), note: "消防柜 · 器材状态" },
    ],
    exit: [
      { src: photo_src("community-exit-1"), note: "安全出口 · 通道堵塞" },
      { src: photo_src("campus-exit-1"), note: "疏散通道 · 堆放物" },
    ],
    hydrant: [{ src: photo_src("community-hydrant-1"), note: "楼前 · 消防栓被埋压" }],
  },
  subway: {
    crowd: [
      { src: photo_src("subway-platform-1"), note: "站台 · 候车区人员密度" },
      { src: photo_src("subway-platform-2"), note: "站台 · 屏蔽门人流" },
    ],
    ext: [{ src: photo_src("subway-ext-1"), note: "站厅 · 消防柜器材" }],
    exit: [
      { src: photo_src("subway-corridor-1"), note: "站厅通道 · 安全出口" },
      { src: photo_src("community-exit-1"), note: "疏散通道 · 指示牌" },
    ],
  },
  forest: {
    fire: [
      { src: photo_src("forest-fire-1"), note: "西山林区 · 烟柱" },
      { src: photo_src("forest-smoke-3"), note: "林缘 · 明火隐患" },
    ],
    smoke: [
      { src: photo_src("forest-smoke-1"), note: "林间空地 · 违规吸烟" },
      { src: photo_src("forest-smoke-2"), note: "林道 · 违规吸烟" },
    ],
    crowd: [
      { src: photo_src("forest-smoke-2"), note: "林间 · 人员聚集" },
      { src: photo_src("forest-smoke-3"), note: "林道口 · 人员停留" },
    ],
    hydrant: [{ src: photo_src("forest-hydrant-1"), note: "林区 · 消防栓被杂草埋压" }],
  },
};

/* 稳定哈希：同一起报警（场景+位置+类型）永远落同一张照片 */
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * 按场景 + 异常类型取一张样片。
 * @param scene 场景 id
 * @param kind  异常类型
 * @param key   可选的稳定键（事发点坐标 / 事件 id），同键同图
 */
export function evidence_for(scene, kind, key = "") {
  const by_kind = EVIDENCE_PHOTOS[scene] || EVIDENCE_PHOTOS.campus;
  const list = by_kind?.[kind];
  if (!list?.length) {
    /* 没登记的类型不硬凑，宁可不出卡，也不要张冠李戴 */
    const fallback = Object.values(by_kind || {}).find((v) => v?.length);
    return fallback ? fallback[0] : null;
  }
  return list[Math.floor(hash01(`${scene}|${kind}|${key}`) * list.length)] || list[0];
}
