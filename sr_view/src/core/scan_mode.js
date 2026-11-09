import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════════════
   ScanMode — 扫描建图（雷达示意）

   做法：不新开面板，把「雷达建图」做成跟随镜头下的一段视觉状态。

   三层效果：
     1. 场景揭示：给场景里所有材质注入一段半径场 shader，
        扫描圈外的片元压暗去色，圈内保持原样 —— 看起来像地图正在被建出来。
     2. 扫描波：地面贴一层自定义 shader，画网格、光圈与旋转拖尾。
     3. HUD：顶部显示扫描半径与重建进度。

   为什么不逐栋处理建筑：merge_static 已经把三千多个网格按材质合并成
   二三十个大网格，楼不再是独立对象。改 shader 反而是唯一省事的做法。

   口径：**示意，不是真实 SLAM**。圈内圈外都是同一份仿真场景数据，
   只是把「已扫到的部分」显出来。
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_R = 46;        // 最大扫描半径（米）
const GROW_SPEED = 6.2;  // 半径扩张速度（米/秒），约 7.5 秒扫满
const FADE = 0.45;       // 进出扫描状态的淡入淡出（秒）

export class ScanMode {
  constructor(cine) {
    this.cine = cine;
    this.on = false;
    this.radius = 0;      // 当前实际半径
    this.fade = 0;        // 0~1，控制整体开关
    this.center = new THREE.Vector3();

    /* 所有注入过的材质共用同一组 uniform 对象：
       改一次 value，全部材质同时生效，不必逐个遍历 */
    this.uniforms = {
      u_scan_center: { value: new THREE.Vector3() },
      u_scan_r: { value: 0 },
      u_scan_on: { value: 0 },
      u_scan_time: { value: 0 },
    };

    this.injected = new WeakSet();
    this.build_overlay();
    this.build_hud();
  }

  /* ── 材质注入 ─────────────────────────────────────────────────────
     遍历整棵场景树，给每个 Mesh 的材质加扫描半径场。
     实例化网格（树）也要覆盖：它们的顶点位置在 instanceMatrix 里，
     所以 vertex shader 里要按 USE_INSTANCING 分支取世界坐标。 */
  attach(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) this.inject(m);
    });
    return this;
  }

  inject(mat) {
    if (!mat || this.injected.has(mat)) return;
    /* 只处理参与光照计算的实体材质。SpriteMaterial、Basic 材质
       没有这些 chunk，注入会直接报错 */
    if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) return;

    this.injected.add(mat);
    /* 留个标记，验收脚本要统计有多少材质真的注入了 */
    mat.userData.scan_injected = true;

    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vScanWorld;"
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vScanWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vScanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 u_scan_center;
          uniform float u_scan_r;
          uniform float u_scan_on;
          varying vec3 vScanWorld;`
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          if (u_scan_on > 0.001) {
            float d = distance(vScanWorld.xz, u_scan_center.xz);
            float k = smoothstep(u_scan_r - 1.2, u_scan_r + 1.2, d);

            /* 圈外高于地面半米的片元直接丢弃：楼、树、车、人整块消失。
               这里必须是 discard，不能只是压暗 —— 雷达没扫到的地方就是空的，
               留着暗色轮廓，一眼就看得出「场景本来就在那儿」。

               丢的阈值比扫描前沿提前一点五米，让建筑「长出来」的那一下
               正好被亮环盖住，不会看到楼凭空闪一下。 */
            float cut = smoothstep(u_scan_r - 3.0, u_scan_r - 1.5, d);
            if (cut > 0.5 && u_scan_on > 0.6 && vScanWorld.y > 0.5) discard;

            /* 地面留一层近乎全黑的底。整片纯黑会像渲染坏了，
               留一点点冷色，读起来是「未知区域」而不是「没渲染」。 */
            vec3 void_col = vec3(0.010, 0.016, 0.026);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, void_col, k * u_scan_on);

            /* 扫描边缘一条细亮带，像雷达波扫过时的轮廓 */
            float band = smoothstep(u_scan_r - 1.8, u_scan_r - 0.2, d)
                       * (1.0 - smoothstep(u_scan_r - 0.2, u_scan_r + 1.4, d));
            gl_FragColor.rgb += vec3(0.18, 0.72, 0.95) * band * 0.55 * u_scan_on;
          }`
        );
    };

    /* 材质可能已经编译过，改 onBeforeCompile 必须让它重新编译 */
    mat.needsUpdate = true;
  }

  /* ── 地面扫描层 ───────────────────────────────────────────────────
     一层贴地平面，画 2 米网格、外圈亮环与一圈旋转拖尾。
     用 NormalBlending 而不是加法混合：地面本身不暗的时候，
     加法会把浅色铺装冲成一片白。 */
  build_overlay() {
    const geo = new THREE.PlaneGeometry(900, 900);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      /* 展开同一组 uniform 对象，改一处全场生效 */
      uniforms: { ...this.uniforms },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 u_scan_center;
        uniform float u_scan_r;
        uniform float u_scan_on;
        uniform float u_scan_time;
        varying vec3 vWorld;

        void main() {
          if (u_scan_on <= 0.001) discard;

          vec2 p = vWorld.xz;
          float d = distance(p, u_scan_center.xz);

          /* 只有扫描圈内才画，圈外整个丢掉 */
          float inside = 1.0 - smoothstep(u_scan_r - 1.6, u_scan_r, d);
          if (inside <= 0.001) discard;

          /* 2 米网格：细线，只做轻提示，不抢建筑 */
          vec2 gp = abs(fract(p / 2.0) - 0.5);
          float grid = smoothstep(0.455, 0.5, max(gp.x, gp.y));

          /* 扫描前沿的亮环 */
          float ring = exp(-pow((d - u_scan_r) / 1.1, 2.0));

          /* 旋转拖尾：一圈从 0 扫到 2π，越靠后越淡 */
          float ang = atan(p.y - u_scan_center.y, p.x - u_scan_center.x);
          float sweep = fract((ang - u_scan_time * 0.55) / 6.2831853);
          float trail = pow(1.0 - sweep, 8.0);

          vec3 cyan = vec3(0.26, 0.84, 1.0);
          /* 底色压得很淡：格线是「已扫描」的提示，不该把地面整体染成一摊青雾 */
          float a = inside * (0.006 + 0.145 * grid) * u_scan_on
                  + ring * 0.42 * u_scan_on
                  + trail * inside * 0.022 * u_scan_on;

          vec3 col = mix(vec3(0.05, 0.26, 0.36), cyan, ring + trail * 0.5);
          gl_FragColor = vec4(col, min(0.8, a));
        }
      `,
    });

    this.overlay = new THREE.Mesh(geo, mat);
    this.overlay.rotation.x = -Math.PI / 2;
    this.overlay.position.y = 0.06;
    this.overlay.renderOrder = 5;
    this.overlay.visible = false;
    this.overlay.frustumCulled = false;
  }

  /* 扫描层要挂进当前场景根节点：切场景时整棵树会被卸载并 dispose 几何体，
     挂在外面会跟着旧场景一起消失或永远留在地上 */
  mount(root, floor_y = 0) {
    if (this.overlay.parent !== root) root.add(this.overlay);
    this.overlay.position.y = floor_y + 0.06;
  }

  /* 卸载场景前必须把扫描层摘出来：切场景会把根节点整棵遍历一遍
     并 dispose 所有几何体，挂在里面的扫描层下一场景就画不出来了 */
  unmount() {
    if (this.overlay.parent) this.overlay.parent.remove(this.overlay);
  }

  /* ── HUD ──────────────────────────────────────────────────────── */
  build_hud() {
    const el = document.createElement("div");
    el.id = "scanHud";
    el.innerHTML = `
      <div class="sh-row">
        <span class="sh-dot"></span>
        <b>雷达建图</b>
        <span class="sh-tag">示意</span>
      </div>
      <div class="sh-bar"><i></i></div>
      <div class="sh-meta"><span id="shR">0.0 m</span><span id="shP">0%</span></div>
    `;
    document.body.appendChild(el);
    this.hud = el;
    this.hudR = el.querySelector("#shR");
    this.hudP = el.querySelector("#shP");
    this.hudBar = el.querySelector(".sh-bar i");
  }

  /* ── 状态切换 ───────────────────────────────────────────────────── */
  begin(entity) {
    if (!entity) return;
    this.target = entity;
    this.on = true;
    this.radius = 0;
    this.center.set(entity.position.x, 0, entity.position.z);
    this.uniforms.u_scan_center.value.copy(this.center);
    this.uniforms.u_scan_r.value = 0;
    this.overlay.visible = true;
    this.hud.classList.add("on");
  }

  end() {
    this.on = false;
    this.target = null;
    this.hud.classList.remove("on");
  }

  update(dt, time) {
    /* 淡入淡出用一个 0~1 的系数，别硬切，
       否则进出跟随时整个场景会「啪」一下变亮变暗 */
    const want = this.on ? 1 : 0;
    this.fade += (want - this.fade) * Math.min(1, dt / FADE * 2.2);
    if (this.fade < 0.002 && !this.on) {
      this.fade = 0;
      this.overlay.visible = false;
      return;
    }

    if (this.target) {
      this.center.set(this.target.position.x, 0, this.target.position.z);
      this.uniforms.u_scan_center.value.copy(this.center);
    }

    if (this.on) this.radius = Math.min(MAX_R, this.radius + GROW_SPEED * dt);

    this.uniforms.u_scan_r.value = this.radius;
    this.uniforms.u_scan_on.value = this.fade;
    this.uniforms.u_scan_time.value = time;

    /* HUD 每帧写文字代价不小，按进度变化节流 */
    const pct = Math.round((this.radius / MAX_R) ** 2 * 100);
    if (pct !== this._pct) {
      this._pct = pct;
      this.hudR.textContent = `${this.radius.toFixed(1)} m`;
      this.hudP.textContent = `${pct}%`;
      this.hudBar.style.width = `${pct}%`;
    }
  }
}
