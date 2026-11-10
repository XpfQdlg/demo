/**
 * 现场抓拍样片。
 *
 * 展台演示只有四类情景，但「事件流 + 一张现场照片」比纯文字可信得多。
 * 照片放在 public/photos（构建时原样拷进 dist），按场景与异常类型挑一张：
 * 同一场景里不同 kind 用不同画面，避免连着两条报警出现同一张图。
 *
 * 单文件版（file://）取不到这些图，由调用方自行跳过。
 */

const BASE = import.meta.env.BASE_URL || "/";

/* 单文件版把这些图内联进了 window.__INLINE_ASSETS（键是 photos/xxx.jpg），
   先查表，查不到才按站点根路径取，file:// 与 dev 两种环境都能出图。 */
function photo_src(name) {
  const key = `photos/${name}.jpg`;
  const inline = typeof window !== "undefined" ? window.__INLINE_ASSETS : null;
  return inline?.[key] || `${BASE}${key}`;
}

export const EVIDENCE_PHOTOS = {
  /* 校园没有真的起火照，用的是校区道路实拍：报警点多在路侧，
     这几张的视角、光线、季节都对得上，看着像同一台摄像头拍的。 */
  campus: [
    { src: photo_src("campus-road-1"), note: "校园道路 · 林荫路段" },
    { src: photo_src("campus-road-3"), note: "校园道路 · 非机动车" },
    { src: photo_src("campus-road-4"), note: "校园道路 · 人行横道" },
    { src: photo_src("campus-road-2"), note: "校园道路 · 车辆滞留" },
  ],
  community: [
    { src: photo_src("community-corridor-1"), note: "楼道 · 消防柜" },
    { src: photo_src("community-corridor-2"), note: "楼道 · 安全出口" },
    { src: photo_src("community-corridor-3"), note: "楼道 · 垃圾桶" },
  ],
  subway: [
    { src: photo_src("subway-corridor-1"), note: "站厅通道 · 消防柜" },
    { src: photo_src("subway-platform-2"), note: "站台 · 屏蔽门" },
    { src: photo_src("subway-platform-1"), note: "站台 · 候车区" },
  ],
  forest: [
    { src: photo_src("forest-smoke-1"), note: "林区 · 人员活动" },
    { src: photo_src("forest-smoke-2"), note: "林区 · 人员活动" },
    { src: photo_src("forest-smoke-3"), note: "林区 · 人员活动" },
  ],
};

const KIND_SLOT = { fire: 0, crowd: 1, trash: 2 };

/** 按场景 + 异常类型取一张样片，取不到就退回该场景第一张 */
export function evidence_for(scene, kind) {
  const list = EVIDENCE_PHOTOS[scene] || EVIDENCE_PHOTOS.campus;
  if (!list?.length) return null;
  const slot = KIND_SLOT[kind] ?? 0;
  return list[slot % list.length];
}

