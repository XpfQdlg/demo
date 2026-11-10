/**
 * 现场抓拍样片。
 *
 * 「事件流 + 一张现场照片」比纯文字可信得多，但图必须和事件对得上：
 * 违规吸烟就出吸烟照、消防栓异常就出栓体照、非机动车载人就出骑车人的照片。
 * 所以这里按「场景 × 异常类型」挑图，而不是按场景轮播——
 * 轮播时 非机动车载人 会抽到消防栓，观众一眼就看出是摆设。
 *
 * 照片放在 public/photos（构建时原样拷进 dist）；
 * 单文件版由 bundle.mjs 内联进 window.__INLINE_ASSETS，file:// 也能出图。
 *
 * 每张图的 note 写的是「照片里真的能看到的东西」，不是事件标题的复读：
 * 卡片上标题是事件、下面一行是画面内容，两者对得上才不露馅。
 */

const BASE = import.meta.env.BASE_URL || "/";

function photo_src(name) {
  const key = `photos/${name}.jpg`;
  const inline = typeof window !== "undefined" ? window.__INLINE_ASSETS : null;
  return inline?.[key] || `${BASE}${key}`;
}

/* 每个场景只登记「手里真有照片」的类型，和 SCENE_MODELS.alert_kinds 一一对应。
   同类型给 2–6 张，按事发点做稳定哈希轮换，同一起报警刷新后还是同一张。
   要多出事件就得让同一类型有更多张不同的图——重复三次全一样，观众就当摆设了。 */
export const EVIDENCE_PHOTOS = {
  campus: {
    smoke: [
      { src: photo_src("forest-smoke-1"), note: "绿化带边 · 有人点烟" },
      { src: photo_src("forest-smoke-2"), note: "林荫道旁 · 手持香烟" },
      { src: photo_src("forest-smoke-3"), note: "教学楼后 · 树下吸烟" },
      { src: photo_src("forest-smoke-5"), note: "停车带旁 · 吸烟停留" },
    ],
    ebike: [{ src: photo_src("campus-road-3"), note: "环湖路 · 一辆电动车载两人" }],
    parking: [{ src: photo_src("campus-road-2"), note: "东门主路 · 车轮压住黄格线" }],
    hydrant: [
      { src: photo_src("campus-hydrant-1"), note: "绿化带 · 消防栓被草叶遮住" },
      { src: photo_src("hydrant-2"), note: "楼前 · 栓体陷进灌木" },
      { src: photo_src("hydrant-3"), note: "路边 · 栓体被杂草围住" },
    ],
    exit: [
      { src: photo_src("campus-exit-1"), note: "楼道 · 绿色安全出口牌" },
      { src: photo_src("exit-2"), note: "东侧楼梯 · 出口指示牌" },
      { src: photo_src("exit-3"), note: "走廊尽头 · 疏散指示" },
      { src: photo_src("exit-5"), note: "楼梯间 · 应急指示牌" },
    ],
  },
  community: {
    ext: [
      { src: photo_src("community-ext-1"), note: "楼道 · 灭火器箱门敞开" },
      { src: photo_src("ext-2"), note: "一层门厅 · 红色器材箱" },
      { src: photo_src("ext-3"), note: "消防柜 · 器材状态" },
      { src: photo_src("ext-5"), note: "走廊 · 器材箱与记录卡" },
      { src: photo_src("ext-6"), note: "楼梯口 · 灭火器摆放" },
      { src: photo_src("community-corridor-3"), note: "楼梯口 · 挂墙灭火器" },
    ],
    exit: [
      { src: photo_src("community-exit-1"), note: "安全出口 · 门上方指示牌" },
      { src: photo_src("community-corridor-2"), note: "楼道 · 出口牌与应急灯" },
      { src: photo_src("exit-4"), note: "通道 · 疏散指示牌" },
      { src: photo_src("exit-6"), note: "走廊 · 应急灯与出口牌" },
    ],
    hydrant: [
      { src: photo_src("community-hydrant-1"), note: "楼前草地 · 消防栓被灌木围住" },
      { src: photo_src("hydrant-4"), note: "楼侧 · 栓体半埋在草丛" },
    ],
  },
  subway: {
    door: [
      { src: photo_src("subway-platform-2"), note: "站台 2 号口 · 屏蔽门与警示条" },
      { src: photo_src("subway-platform-1"), note: "站台 · 屏蔽门玻璃反光" },
    ],
    ext: [
      { src: photo_src("subway-ext-1"), note: "站厅 · 消防柜与灭火器" },
      { src: photo_src("ext-4"), note: "通道口 · 红色器材箱" },
      { src: photo_src("ext-5"), note: "设备间外 · 器材箱" },
    ],
    exit: [
      { src: photo_src("subway-corridor-1"), note: "站厅通道 · 安全出口牌" },
      { src: photo_src("exit-3"), note: "楼梯口 · 疏散指示" },
      { src: photo_src("exit-5"), note: "站台层 · 应急指示牌" },
    ],
  },
  forest: {
    fire: [{ src: photo_src("forest-fire-1"), note: "林缘 · 烟尘压低能见度" }],
    smoke: [
      { src: photo_src("forest-smoke-1"), note: "林间空地 · 有人吸烟" },
      { src: photo_src("forest-smoke-2"), note: "树干旁 · 手持香烟" },
      { src: photo_src("forest-smoke-3"), note: "林道口 · 树下吸烟" },
      { src: photo_src("forest-smoke-5"), note: "灌木边 · 吸烟停留" },
    ],
    hydrant: [
      { src: photo_src("forest-hydrant-1"), note: "林区 · 消防栓被杂草埋住" },
      { src: photo_src("hydrant-3"), note: "林缘 · 栓体被草叶覆盖" },
    ],
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
