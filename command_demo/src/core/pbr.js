import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════════════
   pbr — 真实 PBR 材质库

   素材来自 AmbientCG（CC0），经 extract_materials.py 转成 WebP：
     color      sRGB 漫反射
     normal     切线空间法线（OpenGL Y 向上）
     roughness  粗糙度
     ao         环境光遮蔽（部分材质没有，缺省不用）

   与现有 tex.js 的程序化贴图相比，区别不只是「更好看」：
   程序化贴图没有法线，光打上去是平的；真实法线贴图能让砖缝、沥青颗粒、
   混凝土气孔在斜射光下有真实的凹凸，这是廉价感消失的关键。

   载入方式是「先预载、后建景」：
     await preload(["asphalt", "brick", ...])
     const scene = build_xxx()
   必须在建景前完成预载，否则材质拿到的是空纹理，
   首次渲染就是一整片纯色，之后再补也来不及（着色器已经编译过）。
   例外是沙盘皮肤：它本来就会清掉全部贴图，见 set_textures_enabled。
   ══════════════════════════════════════════════════════════════════════════ */

/* 单文件交付时，打包脚本会在页面里先注入 window.__INLINE_ASSETS：
   键是 "cinematic/materials/<slug>/<channel>.webp"，值是 data URI。
   file:// 下直接读本地图片会被跨源限制挡住，WebGL 上传纹理会失败，
   所以有内联表就必须优先用它。 */
const INLINE = typeof window !== "undefined" ? window.__INLINE_ASSETS : null;

/** 把站点内的相对路径解析成可用 URL；单文件模式下返回内联的 data URI */
export function asset_url(rel) {
  return (INLINE && INLINE[rel]) || new URL(rel, document.baseURI).href;
}

/* 素材放在 public/cinematic/ 下：dev 与 build 都从站点根路径取，
   构建时原样拷到 dist；单文件模式由打包脚本转成 data URI。 */


/** 这些材质在 AmbientCG 上本身没有 AO 通道 */
const AO_MISSING = new Set(["wood", "metal", "facade", "tactile"]);

/* slug|channel → THREE.Texture（已解码完成）。
   repeat 不参与缓存：贴图重复次数是着色器 uniform，不是图像内容。
   按 repeat 缓存会导致「改了一个 repeat 值就取不到纹理、整片变白模」，
   这个坑在校园场景上真实发生过。 */
const cache = new Map();
const pending = new Map();

const loader = new THREE.TextureLoader();

/** 单个贴图，返回 Promise<Texture|null> */
function load_one(slug, channel, { srgb = false } = {}) {
  const key = `${slug}/${channel}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);

  const url = asset_url(`cinematic/materials/${slug}/${channel}.webp`);
  const p = new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1, 1);
        /* 拉满各向异性：远景路面/草地是大角度斜视贴图，
           8 倍在 1600 宽的屏幕上仍然会闪出摩尔纹，16 倍明显稳一些。
           超出硬件上限时 three 会自己截断，写大不吃亏。 */
        t.anisotropy = 16;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
        cache.set(key, t);
        resolve(t);
      },
      undefined,
      (e) => {
        /* 缺通道（如 AO）不算错误，记成 null 让材质跳过它 */
        if (fail_count < 3) console.warn("[pbr] 载入失败", url, e && (e.message || e.type));
        fail_count++;
        cache.set(key, null);
        resolve(null);
      }
    );
  });
  pending.set(key, p);
  return p;
}

/**
 * 是否载入真贴图。沙盘皮肤会清掉所有贴图，关掉可以省掉 5 MB 图的解码与
 * 首次上传；切到地铁（保留 PBR）前必须再打开。
 *
 * 关着的时候建出来的材质会进 mat_cache（贴图为空），所以重新打开时要清缓存，
 * 否则地铁会拿到校园阶段建的无图材质。
 */
let textures_enabled = true;

export function set_textures_enabled(on) {
  if (on === textures_enabled) return;
  textures_enabled = on;
  if (on) mat_cache.clear();
}

/**
 * 预载一批材质的所有贴图（每个 slug 的 color/normal/roughness/ao 各一张）。
 * 重复次数不在预载阶段决定，见 pbr()。
 *
 * 沙盘皮肤（maquette）会把贴图全部清掉，预载纯属白读 5 MB 图、白等解码。
 * 由 cinematic_main 在切场景前按 look/场景调用 set_textures_enabled 关掉。
 */
export async function preload(slugs, _repeats) {
  if (!textures_enabled) return 0;

  const tasks = [];
  for (const slug of slugs) {
    tasks.push(() => load_one(slug, "color", { srgb: true }));
    tasks.push(() => load_one(slug, "normal"));
    tasks.push(() => load_one(slug, "roughness"));
    if (!AO_MISSING.has(slug)) tasks.push(() => load_one(slug, "ao"));
  }

  /* 必须限流。442 张图同时发起时，浏览器连接池被打满，
     TextureLoader 的 onError 会被全部触发（实测 442/442 失败），
     而单张加载是成功的。分批 8 个一组，稳且不慢。 */
  const LIMIT = 8;
  let i = 0;
  const workers = Array.from({ length: Math.min(LIMIT, tasks.length) }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      await t();
    }
  });
  await Promise.all(workers);
  return cache.size;
}

/**
 * 构造一个真实 PBR 材质。**必须先 preload，否则拿到空纹理**。
 *
 * @param slug     材质名（materials 目录下的子目录）
 * @param repeat   贴图重复次数，可传数字或 [u, v]。
 *                 取值取决于几何的 UV 语义：
 *                   BoxGeometry / PlaneGeometry   UV 是 0~1  → repeat = 尺寸 / 贴图米数
 *                   ShapeGeometry / ExtrudeGeometry UV 是米  → repeat = 1 / 贴图米数
 * @param opts.tint        颜色调制，用来让同一张贴图出多种色调
 * @param opts.normalScale 法线强度
 * @param opts.roughness   基础粗糙度，贴图会与它相乘
 */
/* 材质缓存。
   同一个参数组合只造一个材质实例，这样几何合并时能把更多网格收进同一组。
   调用方要改材质（比如勒脚调暗）必须自己 clone，不要原地改。 */
const mat_cache = new Map();

export function pbr(slug, {
  repeat = 1,
  tint = 0xffffff,
  normalScale = 1.0,
  roughness = 1.0,
  metalness = 0.0,
  envIntensity = 1.0,
  aoIntensity = 1.0,
  transparent = false,
  opacity = 1.0,
  side = THREE.FrontSide,
} = {}) {
  const [ru, rv] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  const key = [slug, ru, rv, tint, normalScale, roughness, metalness, envIntensity,
    aoIntensity, transparent, opacity, side].join("|");
  if (mat_cache.has(key)) return mat_cache.get(key);

  /* clone 只是为了带一份自己的 repeat。
     three 的 WebGLTexture 按 texture.source 缓存，克隆共享同一张显存贴图，
     所以这里不会多占内存。 */
  const get = (ch) => {
    const src = cache.get(`${slug}/${ch}`);
    if (!src) return null;
    if (ru === 1 && rv === 1) return src;
    const t = src.clone();
    t.repeat.set(ru, rv);
    return t;
  };

  const mat = new THREE.MeshStandardMaterial({
    map: get("color"),
    normalMap: get("normal"),
    roughnessMap: get("roughness"),
    aoMap: get("ao"),
    color: tint,
    roughness,
    metalness,
    envMapIntensity: envIntensity,
    transparent,
    opacity,
    side,
  });

  if (mat.normalMap) mat.normalScale.set(normalScale, normalScale);
  if (mat.aoMap) mat.aoMapIntensity = aoIntensity;

  mat.userData.slug = slug;
  mat_cache.set(key, mat);
  return mat;
}

/** 调试：看某个键存的实际值 */
export function peek(key) {
  const v = cache.get(key);
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return v.isTexture ? "texture" : typeof v;
}

/** 调试：统计加载失败数 */
export let fail_count = 0;

/** 调试：列出缓存里已有的键 */
export function cache_keys() {
  return [...cache.keys()];
}

/** 贴图是否已经就绪，用于调试 */
export function ready(slug, channel = "color") {
  return !!cache.get(`${slug}/${channel}`);
}

/* ── 常用材质的预设 ─────────────────────────────────────────────────── */

/**
 * 按「一米对应多少纹理」给推荐重复次数。
 * 一张 512 的沥青纹理约覆盖 4 米，所以 repeat = 区域边长 / 4。
 */
export const PRESET = {
  asphalt: (w) => pbr("asphalt", { repeat: Math.max(1, Math.round(w / 4)), normalScale: 1.2, envIntensity: 0.6 }),
  paving: (w) => pbr("paving", { repeat: Math.max(1, Math.round(w / 3)), normalScale: 1.0 }),
  concrete_floor: (w) => pbr("concrete_floor", { repeat: Math.max(1, Math.round(w / 3)), normalScale: 0.8 }),
  concrete_wall: (w) => pbr("concrete_wall", { repeat: Math.max(1, Math.round(w / 4)), normalScale: 0.9 }),
  brick: (w) => pbr("brick", { repeat: Math.max(1, Math.round(w / 3)), normalScale: 1.4 }),
  plaster: (w) => pbr("plaster", { repeat: Math.max(1, Math.round(w / 3)), normalScale: 0.6 }),
  metal: (w) => pbr("metal", { repeat: Math.max(1, Math.round(w / 2)), normalScale: 0.5, metalness: 0.85, envIntensity: 1.4 }),
  wood: (w) => pbr("wood", { repeat: Math.max(1, Math.round(w / 2)), normalScale: 1.0 }),
  rock: (w) => pbr("rock", { repeat: Math.max(1, Math.round(w / 6)), normalScale: 1.6 }),
  grass: (w) => pbr("grass", { repeat: Math.max(1, Math.round(w / 5)), normalScale: 1.2 }),
  tiles: (w) => pbr("tiles", { repeat: Math.max(1, Math.round(w / 2)), normalScale: 0.7, envIntensity: 1.1 }),
  tactile: (w) => pbr("tactile", { repeat: Math.max(1, Math.round(w / 1)), normalScale: 1.5 }),
};

/**
 * 建筑玻璃。
 *
 * 不用 transmission：那需要渲染器把场景先渲到一张 RT 上再做折射，
 * 与后处理管线叠加时容易退化成一整片白。展台场景里窗玻璃靠
 * 「深色 + 高反射 + 低粗糙」已经足够像玻璃，而且便宜得多。
 *
 * 现实中的窗玻璃在白天看起来就是这样：反射天空的亮斑 + 内部偏暗。
 */
export function glass({ tint = 0x223038, reflect = 1.0 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0.15,
    roughness: 0.08,
    ior: 1.52,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.4 * reflect,
    /* 一点自发光模拟玻璃内部的漫射，避免背光面死黑 */
    emissive: new THREE.Color(0x0a1216),
    emissiveIntensity: 1.0,
  });
}

export function dispose_pbr() {
  for (const v of cache.values()) if (v) v.dispose();
  cache.clear();
  pending.clear();
  for (const m of mat_cache.values()) m.dispose();
  mat_cache.clear();
}
