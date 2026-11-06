/* ══════════════════════════════════════════════════════════════════════════
   事件 → 现场视频的映射

   现有素材目录为空（assets/media/<scene>/ 下没有任何文件），因此这里的
   path 默认全部为 null。放入素材后，把相对路径填进来即可生效，不需要改代码。

   约定：
   - 素材放在 ../visual_inspection_demo/assets/media/<scene>/ 下
   - 文件名建议 <目标类别>_<序号>.mp4，例如 open_fire_01.mp4
   - 编码用 H.264 + AAC 的 mp4，1080p 即可；H.265 在浏览器里容易黑屏

   找不到 path 时按钮置灰，不弹空窗。
   ══════════════════════════════════════════════════════════════════════════ */

export const MEDIA_BASE = "../visual_inspection_demo/assets/media";

export const MEDIA_MAP = {
  "campus:s-smoke": { path: null, note: "校园明火检测片段" },
  "subway:m-density": { path: null, note: "地铁站厅客流片段" },
  "community:c-ebike-in": { path: null, note: "小区电动车入楼片段" },
};

/** 按「场景:点位」查视频地址，没有则返回 null */
export function media_for(scene_id, target_id) {
  const hit = MEDIA_MAP[`${scene_id}:${target_id}`];
  if (!hit || !hit.path) return null;
  return { url: `${MEDIA_BASE}/${scene_id}/${hit.path}`, note: hit.note };
}
