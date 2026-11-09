import * as THREE from "three";
import { road_sdf } from "../map/road_sdf.js";

/* ══════════════════════════════════════════════════════════════════════════
   StyleMode — 车机 SR 风格化

   行业做法（Unity 座舱指南里拆理想量产案例的那一套）：
     低模 + 卡通着色 + 描边 + 统一光照。

   落到 three.js 上，这里做四件事：

   1. 材质注入：把 PBR 贴图压成「语义平色 + 三档明暗」。
   2. 边缘光 / 地面反光：平涂之后物体容易糊成一片，补一层菲涅尔边缘
      和地面高光，形体才立得住。这两项都是车机 SR 的常见手法。
   3. 背面外扩描边：复制合并后的静态几何，只画背面并沿法线外扩。
   4. 深色渐变背景：SR 的底子从来不是天空照片，是一块压暗的深色。

   为什么不做法线 + 深度的 Sobel 描边：现有 composer 已经挂了 GTAO、
   SMAA、调色三个 pass，再插一个法线预渲染要重排整条链，风险高于收益。
   ══════════════════════════════════════════════════════════════════════════ */

/* 每个语义类一套参数。四件事分开调，比一个颜色管所有地方可控得多。
   noise：原贴图亮度的保留权重，0 是纯平涂
   rim：菲涅尔边缘光强度，用来把物体从深色背景里勾出来
   sheen：地面反光强度，路面、站台这些水平面才需要 */
const CATS = {
  road: { color: 0x2b3441, noise: 0.0, rim: 0.0, sheen: 0.55 },
  ground: { color: 0x39434e, noise: 0.0, rim: 0.0, sheen: 0.1 },
  platform: { color: 0x9dabb7, noise: 0.02, rim: 0.06, sheen: 0.16 },
  building: { color: 0xd2dce5, noise: 0.045, rim: 0.14, sheen: 0.0 },
  glass: { color: 0x14323f, noise: 0.02, rim: 0.3, sheen: 0.28 },
  metal: { color: 0x8fa0ae, noise: 0.05, rim: 0.18, sheen: 0.18 },
  green: { color: 0x35694f, noise: 0.0, rim: 0.0, sheen: 0.0 },
  wood: { color: 0x8a6f52, noise: 0.06, rim: 0.06, sheen: 0.0 },
  rock: { color: 0x4d545c, noise: 0.08, rim: 0.0, sheen: 0.0 },
  accent: { color: 0xe6b53f, noise: 0.0, rim: 0.12, sheen: 0.0 },
  tree: { color: 0x1e4636, noise: 0.0, rim: 0.0, sheen: 0.0, bands: 0.0, solid: 1.0 },
  other: { color: 0x7c8a97, noise: 0.0, rim: 0.08, sheen: 0.0 },
};

/* 地面是一层层几乎共面的薄片（草坪底盘 y=0、林地 y=0.02、路面 y=0.05），
   远处深度精度只有十几厘米，两层之间必然打架，出来就是一道道斜纹。
   写实版颜色接近看不出来，平涂成一深一浅就全露了。
   不改高度（狗和人都站在 y=0，抬高地面会把它们埋进去），
   改用 polygonOffset 在深度值上固定先后。数字越大越靠前。 */
const DEPTH_RANK = { green: 1, ground: 2, platform: 2, road: 3 };

const SLUG_CATEGORY = {
  asphalt: "road",
  paving: "ground",
  concrete_floor: "ground",
  tiles: "platform",
  concrete_wall: "building",
  brick: "building",
  plaster: "building",
  wood: "wood",
  metal: "metal",
  rock: "rock",
  grass: "green",
  tactile: "accent",
};

export class StyleMode {
  constructor(cine) {
    this.cine = cine;
    this.done = new WeakSet();
    this.light = { value: new THREE.Vector3(-0.42, 0.86, 0.3).normalize() };
    /* 距离雾：平涂之后远处的地面会和背景切出一条硬边，
       在片元里补一段按距离混向背景色的雾，地平线才接得上。
       注意不能用 scene.fog —— 它作用在我们写颜色之前，会被盖掉。 */
    this.fog_color = { value: new THREE.Color(0x1a2531) };
    this.fog_range = { value: new THREE.Vector2(600, 1500) };
    /* 总开关。第一视角小窗要画成「摄像头画面」的样子，
       渲染那一遍的时候把它置 0，材质退回原始写实外观。 */
    this.on = { value: 1 };
    this.outline_mat = this.make_outline_material();
  }

  /* ── 材质注入 ─────────────────────────────────────────────────── */
  apply(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      /* 实例化网格是树。球冠在俯视下会被边缘光勾成一圈圈的甜甜圈，
         而且树影投在地上会织成斜向条纹。SR 里树就是一团暗绿，
         所以这类单独走「tree」参数：压暗、不要边缘光、不吃原色。 */
      for (const m of mats) this.inject(m, o.isInstancedMesh ? "tree" : null);
    });
    return this;
  }

  inject(mat, hint = null) {
    if (!mat || this.done.has(mat)) return;
    if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) return;

    /* 三类来源：
       1. 有 slug 的 PBR 材质（道路、墙、玻璃…）→ 查语义色板
       2. 没有 slug 的玻璃 → 靠 clearcoat 认
       3. 没有 slug 的普通构件（列车、长椅、导向牌）→ 用材质自己的颜色，
          只压饱和度。全塞进一个灰色会把整车都抹平 */
    let cat = null;
    let flat;
    if (hint === "tree" || mat.userData?.tree) {
      cat = "tree";
      flat = new THREE.Color(CATS.tree.color);
    } else if (mat.userData?.slug) {
      cat = SLUG_CATEGORY[mat.userData.slug] || "other";
      flat = new THREE.Color(CATS[cat].color);
    } else if (mat.isMeshPhysicalMaterial && mat.clearcoat > 0.5) {
      cat = "glass";
      flat = new THREE.Color(CATS.glass.color);
    } else {
      cat = "other";
      flat = mat.color ? mat.color.clone().offsetHSL(0, -0.35, 0.03) : new THREE.Color(CATS.other.color);
    }

    const p = CATS[cat];

    const rank = DEPTH_RANK[cat] || 0;
    if (rank > 0) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -rank;
      mat.polygonOffsetUnits = -rank * 2;
    }

    /* 路面多带一张距离场：数据包里没有车道线，靠「离路边多远」把中线推出来 */
    const sdf = cat === "road" ? road_sdf() : null;

    /* 保留上一段 onBeforeCompile：扫描建图也挂在同一个材质上，
       直接覆盖会让扫描的压暗整段丢失 */
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      prev?.call(mat, shader, renderer);

      shader.uniforms.u_flat_color = { value: flat };
      shader.uniforms.u_flat_noise = { value: p.noise };
      shader.uniforms.u_flat_rim = { value: p.rim };
      shader.uniforms.u_flat_sheen = { value: p.sheen };
      shader.uniforms.u_flat_bands = { value: p.bands ?? 1.0 };
      shader.uniforms.u_flat_solid = { value: p.solid ?? 0.0 };
      shader.uniforms.u_style_light = this.light;
      shader.uniforms.u_sdf = { value: sdf?.texture ?? null };
      shader.uniforms.u_sdf_rect = { value: sdf?.rect ?? new THREE.Vector4(0, 0, 1, 1) };
      shader.uniforms.u_sdf_max = { value: sdf?.max ?? 8 };
      shader.uniforms.u_sdf_on = { value: sdf ? 1 : 0 };
      shader.uniforms.u_style_on = this.on;
      shader.uniforms.u_fog_color = this.fog_color;
      shader.uniforms.u_fog_range = this.fog_range;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vFlatN;\nvarying vec3 vFlatW;"
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            mat4 mw = modelMatrix * instanceMatrix;
            vFlatN = normalize(mat3(mw) * normal);
          #else
            mat4 mw = modelMatrix;
            vFlatN = normalize(mat3(mw) * normal);
          #endif
          vFlatW = (mw * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 u_flat_color;
          uniform float u_flat_noise;
          uniform float u_flat_rim;
          uniform float u_flat_sheen;
          uniform float u_flat_bands;
          uniform float u_flat_solid;
          uniform vec3 u_style_light;
          uniform float u_style_on;
          uniform sampler2D u_sdf;
          uniform vec4 u_sdf_rect;
          uniform float u_sdf_max;
          uniform float u_sdf_on;
          uniform vec3 u_fog_color;
          uniform vec2 u_fog_range;
          varying vec3 vFlatN;
          varying vec3 vFlatW;`
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          if (u_style_on > 0.5) {
            /* 原始亮度只用来留一点窗和砖缝的痕迹，颜色已经被语义色顶掉 */
            float lum = clamp(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

            /* 卡通明暗：三档，不做连续过渡 */
            vec3 N = normalize(vFlatN);
            float ndl = dot(N, normalize(u_style_light));
            float band = ndl > 0.52 ? 1.0 : (ndl > 0.0 ? 0.86 : 0.74);
            /* 球冠（树冠）上跑三档明暗会出现同心圆，看着像甜甜圈。
               bands = 0 的类别直接用平色，不做分档。 */
            float tone = mix(1.0, band, u_flat_bands);

            vec3 c = u_flat_color * tone * mix(1.0 - u_flat_noise, 1.0 + u_flat_noise, lum);

            /* 菲涅尔：视线越掠射越亮，把物体从深色背景里勾出来 */
            vec3 V = normalize(cameraPosition - vFlatW);
            float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
            c += u_flat_color * fres * u_flat_rim;

            /* 地面反光：水平面上铺一层冷色高光，路面才有「湿沥青」的质感 */
            float sheen = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);
            c += vec3(0.30, 0.48, 0.62) * sheen * u_flat_sheen;

            /* 路面标线。距离场给出每个点离路边多远：
               道路宽 8 米，中线就在 4 米处。
               同时按距离给路面一点起拱感，中间亮、靠边暗。 */
            if (u_sdf_on > 0.5) {
              vec2 uv = (vFlatW.xz - u_sdf_rect.xy) / u_sdf_rect.zw;
              float dd = texture2D(u_sdf, uv).r * u_sdf_max;

              c *= 0.94 + 0.10 * smoothstep(0.0, 4.0, dd);

              float center = smoothstep(3.72, 3.92, dd) * (1.0 - smoothstep(4.08, 4.28, dd));
              /* 路口处距离会超过 5 米，那里不该有线 */
              center *= 1.0 - smoothstep(5.0, 5.6, dd);
              c = mix(c, vec3(0.90, 0.87, 0.76), center * 0.85);
            }

            /* 距离雾：越远越接近背景色，地平线自然淡出 */
            float fogam = smoothstep(u_fog_range.x, u_fog_range.y, distance(cameraPosition, vFlatW));
            c = mix(c, u_fog_color, fogam);

            /* 树叶贴图带镂空，留 alpha 会透出一圈圈空隙。
               solid = 1 的类别（树）强制不透明，成为实心团块。 */
            gl_FragColor = vec4(c, mix(gl_FragColor.a, 1.0, u_flat_solid));
          }`
        );
    };

    mat.needsUpdate = true;
    mat.userData.style_injected = true;
    this.done.add(mat);
  }

  /* ── 描边 ─────────────────────────────────────────────────────────
     背面外扩：只画背面，顶点沿法线外推。外推量按视距缩放，
     远处近处线宽在屏幕上一致。合并后的几何已经烘进世界坐标，
     法线也在世界空间，直接用即可。 */
  make_outline_material() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: true,
      uniforms: {
        u_color: { value: new THREE.Color(0x0d1620) },
        u_width: { value: 0.0034 },
      },
      vertexShader: `
        uniform float u_width;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          /* 外扩量按视距缩放保持屏幕线宽，但要封顶：
             不封顶的话远处细构件（栏杆、天线、屋檐）会甩出长长的尖刺 */
          float w = min(-mv.z * u_width, 0.45);
          mv.xyz += n * w;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 u_color;
        void main() { gl_FragColor = vec4(u_color, 1.0); }
      `,
    });
  }

  /** 给合并后的静态网格加描边壳。传 merge_static 的返回值 */
  add_outlines(root, merged) {
    let n = 0;
    for (const m of merged) {
      if (!m.geometry?.getAttribute("normal")) continue;
      /* 大而平的地面不需要描边：背面朝下，画了也看不见，
         白白多一次绘制 */
      /* 树不描边：树冠是球，外扩一圈会变成一个个甜甜圈 */
      if (m.material?.userData?.tree) continue;

      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      if (bb.max.y - bb.min.y < 0.6) continue;

      const shell = new THREE.Mesh(m.geometry, this.outline_mat);
      shell.name = `outline:${m.name}`;
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.frustumCulled = false;
      shell.renderOrder = -1;
      root.add(shell);
      n++;
    }
    return n;
  }

  /** 按场景给雾距。颜色固定为背景底部色，远处才能无缝接上 */
  set_fog(near, far) {
    this.fog_range.value.set(near, far);
  }

  /* ── 背景 ─────────────────────────────────────────────────────────
     SR 的底子是一块压暗的深色，不是天空照片。
     用一张两像素宽的竖直渐变贴图当背景，便宜且没有接缝。 */
  set_background() {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#101923");
    grad.addColorStop(0.55, "#1a2531");
    grad.addColorStop(1, "#24313d");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cine.scene.background = tex;

    /* 天空球的优先级高于 scene.background，不藏起来这块渐变根本看不见。
       主渲染器里还有一个 Environment，风格化不依赖它，留着也无妨。 */
    if (this.cine.skyMesh) this.cine.skyMesh.visible = false;
    this.cine.scene.fog = null;
  }
}
