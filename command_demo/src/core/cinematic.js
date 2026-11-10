import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

/* ══════════════════════════════════════════════════════════════════════════
   Cinematic — 画质优先的渲染核心

   与现有 engine.js 的区别：那份是「一秒能开、离线能跑」的工程向实现，
   这份是「展台大屏、单场景、允许吃满 5060」的观感向实现。

   六件事决定它像不像 3A：

   1. 真实环境光。用 Poly Haven 的 8K 全景图经 PMREM 预过滤，天空、云、
      地面反射都从这张图里来。程序化天空永远做不出云层的体积感。
   2. AgX 色调映射。ACES 高光容易发白、饱和度过冲；AgX 把高光压得更缓，
      这是 Blender 4 起的默认，也是现在的影视标准。
   3. GTAO。屏幕空间环境光遮蔽，墙角、栏杆根、树根会自然变暗。
      没有 AO 的场景怎么看都像塑料模型。
   4. 4096 分辨率的方向光阴影。场景 200 米见方，单张阴影图足够清晰；
      再大就要上 CSM，但 CSM 的材质改写会破坏玻璃与环境反射，得不偿失。
   5. Bloom + 抗锯齿。高光溢出少量就够，过强反而脏。SMAA 处理建筑边缘。
   6. 轻量调色：暗角、轻微色差、胶片颗粒。克制，只加质感不加滤镜。
   ══════════════════════════════════════════════════════════════════════════ */

/* 后期调色：暗角 + 边缘色差 + 颗粒 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    u_time: { value: 0 },
    u_vignette: { value: 0.35 },
    /* 颗粒默认关掉。原来这里是 0.022，噪声每帧都用 u_time 重算，
       整幅画面因此一直在 ±2% 的随机抖动里重画，看起来就是「沙沙地闪」，
       尤其在大屏上盯久了很明显。想要胶片颗粒的话把这里调回 0.02 左右，
       但记得把下面 fragmentShader 里的 u_time 换成固定值，
       否则又会变成逐帧噪声。 */
    u_grain: { value: 0 },
    u_chroma: { value: 0.0012 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float u_time, u_vignette, u_grain, u_chroma;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // 色差：越靠边缘偏移越大，中心不动
      vec2 off = c * u_chroma * (0.25 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // 暗角：平滑衰减，不要压成黑洞
      float vig = smoothstep(0.95, 0.25, r2 * 2.4);
      col *= mix(1.0 - u_vignette, 1.0, vig);

      // 颗粒：三角分布伪随机，比白噪声自然
      float n = fract(sin(dot(uv * 1000.0 + u_time, vec2(12.9898, 78.233))) * 43758.5453);
      float n2 = fract(sin(dot(uv * 1000.0 + u_time * 1.7, vec2(39.346, 11.135))) * 43758.5453);
      col += (n + n2 - 1.0) * u_grain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Cinematic {
  constructor(stage) {
    this.stage = stage;
    this.clock = new THREE.Clock();
    this.time = 0;
    /* 跟随相机：null 为自由轨道；{ entity, mode, eye_y } 为跟随设备 */
    this.follow = null;
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    /* 场景自带动画（列车、流水等）注册到这里，切场景时整体清空 */
    this.updaters = [];

    /* ── 渲染器 ──────────────────────────────────────────────────── */
    const r = new THREE.WebGLRenderer({
      antialias: false,           // 抗锯齿交给 SMAA，MSAA 与后期管线不兼容
      powerPreference: "high-performance",
      stencil: false,
    });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    /* AgX 把高光压得更缓，是目前最接近影视标准的曲线 */
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 0.88;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(r.domElement);
    this.renderer = r;

    /* 标签层：事件抓拍卡、设备铭牌这类 DOM 标签走 CSS2D，
       文字不参与 3D 采样，怎么推拉镜头都是屏幕尺寸的清晰度。 */
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(innerWidth, innerHeight);
    const lr = this.labelRenderer.domElement;
    lr.style.position = "absolute";
    lr.style.top = "0";
    lr.style.left = "0";
    lr.style.pointerEvents = "none";
    lr.className = "label-layer";
    stage.appendChild(lr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 4000);
    this.camera.position.set(0, 18, 60);

    /* ── 环境光：全景图 → PMREM ──────────────────────────────────── */
    this.pmrem = new THREE.PMREMGenerator(r);
    this.pmrem.compileEquirectangularShader();

    /* ── 主光与阴影 ──────────────────────────────────────────────
       不用 CSM：它的 setupMaterial 会重写材质 shader 片段，
       与 MeshPhysicalMaterial 的清漆/环境反射叠加后，实测会把窗玻璃
       洗成浅灰、阴影也一起消失。场景只有 200 米见方，
       一张 4096 的平行光阴影就够清晰。 */
    this.sun = new THREE.DirectionalLight(0xfff2dc, 3.4);
    this.sun.position.set(-90, 130, 70);
    this.sun.castShadow = true;

    const sc = this.sun.shadow.camera;
    sc.left = -130;
    sc.right = 130;
    sc.top = 130;
    sc.bottom = -130;
    sc.near = 1;
    sc.far = 480;
    sc.updateProjectionMatrix();

    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.06;
    /* 阴影每帧重绘：隔帧方案会让走动的人影在大屏上跳，见 _loop 里的注释 */
    this.sun.shadow.autoUpdate = true;
    this.sun.shadow.needsUpdate = true;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    /* ── 补光：天空冷、地面暖，避免背光面死黑 ────────────────────── */
    this.hemi = new THREE.HemisphereLight(0xbcd6f5, 0x5a5142, 0.28);
    this.scene.add(this.hemi);

    /* ── 后期管线 ────────────────────────────────────────────────── */
    /* 场景先渲进一张 MSAA 的 HDR 目标，再交给后期链采样：
       SMAA 只能修「已经画出来的边」，修不了远景窗格、贴地线条这种
       亚像素几何——相机慢慢转的时候它们会爬行、发毛刺。MSAA 在光栅化
       阶段就把覆盖率的边缘算进去，正好补上这一段。
       4× 在 1600×900 下约多花 20% 帧时间（RTX 5060：78 → 62 fps）；
       四核以下的机器退到 2×，`?msaa=0/2/4` 可以现场覆盖。 */
    const params = new URLSearchParams(location.search);
    const cores = navigator.hardwareConcurrency || 4;
    const msaa = Number(params.get("msaa") ?? (cores <= 4 ? 2 : 4));
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    const hdr = new THREE.WebGLRenderTarget(buf.x, buf.y, {
      type: THREE.HalfFloatType,
      samples: Number.isFinite(msaa) ? Math.max(0, Math.min(4, msaa)) : 4,
    });
    this.composer = new EffectComposer(r, hdr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.6,
      thickness: 1.2,
      scale: 1.0,
      samples: 8,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.22,   // 强度：只让窗光与高光轻微溢出
      0.55,   // 半径
      0.92    // 阈值：低于这个亮度不参与
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.smaa = new SMAAPass(innerWidth, innerHeight);
    this.composer.addPass(this.smaa);

    addEventListener("resize", () => this.resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ── 环境贴图 ─────────────────────────────────────────────────────── */

  /**
   * 载入全景图作为**环境光**（只用于照明与反射），
   * 背景另用程序化天空，两者分开。
   *
   * 为什么背景不用这张照片：实拍全景自带另一套建筑、道路和地平线，
   * 与近处的 3D 场景尺度对不上，远看就像两张图拼在一起。
   * 程序化天空只有天顶到地平线的渐变，配合同色雾，
   * 地面一路淡出到天空，没有接缝。
   */
  load_sky(url, { intensity = 0.7, horizon = 0xb9c6d2, zenith = 0x6f9ac9 } = {}) {
    /* 先摆好程序化天空，图片晚到也不影响画面 */
    this.set_sky(horizon, zenith);

    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          /* PMREM 把全景预过滤成多级 mip，粗糙材质才拿得到正确的模糊反射 */
          const rt = this.pmrem.fromEquirectangular(tex);
          this.scene.environment = rt.texture;
          this.scene.environmentIntensity = intensity;
          this.sky_tex = tex;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }

  /**
   * 程序化天空：天顶到地平线的竖直渐变，贴在一个大球的内侧。
   * 半径 900 米，远裁剪面 4000，不会被切掉。
   */
  set_sky(horizon = 0xb9c6d2, zenith = 0x6f9ac9) {
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 256;
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 256);
    const h = new THREE.Color(horizon);
    const z = new THREE.Color(zenith);
    /* 地平线偏亮偏白，天顶饱和，中间过渡 */
    g.addColorStop(0.0, "#" + z.getHexString());
    g.addColorStop(0.52, "#" + z.clone().lerp(h, 0.55).getHexString());
    g.addColorStop(0.62, "#" + h.getHexString());
    g.addColorStop(1.0, "#" + h.clone().lerp(new THREE.Color(0xffffff), 0.25).getHexString());
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;

    if (this.skyMesh) {
      this.skyMesh.material.map = tex;
      this.skyMesh.material.needsUpdate = true;
    } else {
      const geo = new THREE.SphereGeometry(900, 32, 16);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
      this.skyMesh = new THREE.Mesh(geo, mat);
      this.skyMesh.name = "sky";
      this.skyMesh.renderOrder = -1;
      this.scene.add(this.skyMesh);
    }
    this.sky_horizon = horizon;
    return tex;
  }

  /**
   * 给整棵场景树打开投影与接收阴影。
   * 必须显式遍历：新建的 Mesh 默认 castShadow/receiveShadow 都是 false，
   * 忘了这一步，光打得再对也是一片死平。
   */
  register_csm(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }

  /**
   * 把主光与阴影相机挪到场景中心。
   * 平行光本身方向处处一致，但阴影相机有范围限制：
   * 场景不在原点时，阴影会整个丢失，画面上就是「有光没影」。
   */
  focus_sun(center, radius = 130, azimuth = 2.3, elevation = 0.7) {
    const c = new THREE.Vector3(center[0] || 0, 0, center[1] || center[2] || 0);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();

    /* 太阳方位跟着相机走：让朝向镜头的那两面墙受光。
       固定方位时，换一个机位就会整片背光，看着发闷。
       仰角也一起给：夜里把月亮压低，光擦着屋顶走，
       地面不会整片发白，立面和长影才是重点。 */
    const dist = 160;
    this.sun.position.set(
      c.x + Math.cos(azimuth) * dist,
      8 + Math.tan(elevation) * dist,
      c.z + Math.sin(azimuth) * dist
    );

    const sc = this.sun.shadow.camera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.near = 1;
    sc.far = 480;
    sc.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  /** 雾：线性雾按距离淡出，颜色跟着天空走，远处不会被切出一条硬边 */
  set_fog(color, near, far) {
    this.scene.fog = new THREE.Fog(color, near, far);
  }

  /* ── 夜景：数字孪生沙盘 ─────────────────────────────────────────────
     展台大屏看的是「城市在夜里醒来」：天是深的，楼是暗的，
     窗是亮的，路是暖的。低模在这种光线下会被读成数据孪生，
     而不是「没做完的白色方块」。
     所有参数都留了口子，四个场景各自调，不写死一套。 */
  set_night({
    exposure = 1.0,
    sun = 2.6,
    sunColor = 0x9fb9ff,
    hemi = 0.45,
    hemiSky = 0x2b4668,
    hemiGround = 0x070a0f,
    bloom = 0.8,
    threshold = 0.55,
    horizon = 0x2a3648,
    zenith = 0x03060d,
    fog = 0x0a1220,
    fogNear = 220,
    fogFar = 1100,
    stars = true,
    moon = true,
    env = 0.5,
  } = {}) {
    this.night = true;
    this.renderer.toneMappingExposure = exposure;

    /* 月光：冷、低、仍要投影。阴影在夜里是「楼与楼之间」的层次 */
    this.sun.color.set(sunColor);
    this.sun.intensity = sun;
    this.sun.castShadow = true;

    this.hemi.color.set(hemiSky);
    this.hemi.groundColor.set(hemiGround);
    this.hemi.intensity = hemi;

    this.bloom.strength = bloom;
    this.bloom.radius = 0.7;
    this.bloom.threshold = threshold;
    this.grade.uniforms.u_vignette.value = 0.62;
    this.grade.uniforms.u_chroma.value = 0.0016;

    this.set_sky(horizon, zenith);
    this.set_fog(fog, fogNear, fogFar);

    /* 夜景环境贴图：用同一套天光渐变做 PMREM，
       窗玻璃反射的是夜空而不是白天的蓝天，反光才不会穿帮。 */
    this._night_env(env);
    this._stars(stars);
    if (moon) this._moon();
  }

  /* ── 摄影棚：建筑沙盘 ───────────────────────────────────────────────
     把低模当成一件「建筑模型」来打光：米白的墙、鼠尾草绿的地、
     暖灰的路、柔而长的影子。低多边形在这种光下是风格，不是缺陷。 */
  set_studio({
    exposure = 1.02,
    sun = 3.2,
    sunColor = 0xfff4e2,
    hemi = 1.0,
    hemiSky = 0xe6eef6,
    hemiGround = 0xcfc5b0,
    bloom = 0.06,
    threshold = 0.95,
    horizon = 0xefe9da,
    zenith = 0xa9c6d8,
    fog = 0xe6e0d1,
    fogNear = 900,
    fogFar = 2800,
    env = 0.9,
  } = {}) {
    this.night = false;
    this.renderer.toneMappingExposure = exposure;
    this.sun.color.set(sunColor);
    this.sun.intensity = sun;
    this.sun.castShadow = true;
    /* 几百米的地面上，0.06 的法线偏移会出条纹状自阴影（shadow acne） */
    this.sun.shadow.normalBias = 3.0;
    this.sun.shadow.bias = -0.0001;
    this.hemi.color.set(hemiSky);
    this.hemi.groundColor.set(hemiGround);
    this.hemi.intensity = hemi;
    this.bloom.strength = bloom;
    this.bloom.radius = 0.5;
    this.bloom.threshold = threshold;
    this.grade.uniforms.u_vignette.value = 0.18;
    this.grade.uniforms.u_chroma.value = 0.0;

    this.set_sky(horizon, zenith);
    this.set_fog(fog, fogNear, fogFar);
    if (this.starMesh) this.starMesh.visible = false;
    if (this.moonMesh) this.moonMesh.visible = false;

    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.0, "#a9c6d8");
    g.addColorStop(0.5, "#efe9da");
    g.addColorStop(1.0, "#b9b3a4");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rt = this.pmrem.fromEquirectangular(tex);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = env;
  }

  _night_env(intensity = 0.35) {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.0, "#02040a");
    g.addColorStop(0.46, "#0a1524");
    g.addColorStop(0.52, "#28394f");
    g.addColorStop(0.56, "#1a2432");
    g.addColorStop(1.0, "#070a0e");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 128);

    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rt = this.pmrem.fromEquirectangular(tex);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = intensity;
  }

  _stars(on = true) {
    if (this.starMesh) this.starMesh.visible = on;
    if (!on || this.starMesh) return;

    const N = 1400;
    const pos = new Float32Array(N * 3);
    const seed = (i) => {
      const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < N; i++) {
      /* 只撒在地平线以上，仰角 4°~88° */
      const az = seed(i) * Math.PI * 2;
      const el = 0.07 + seed(i + 0.37) * 1.47;
      const r = 760 + seed(i + 0.71) * 90;
      pos[i * 3] = Math.cos(el) * Math.cos(az) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcfe0ff,
      size: 1.35,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.starMesh = new THREE.Points(geo, mat);
    this.starMesh.frustumCulled = false;
    this.starMesh.renderOrder = 1;
    this.scene.add(this.starMesh);
  }

  _moon() {
    if (this.moonMesh) {
      this.moonMesh.visible = true;
      return;
    }
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const c = cv.getContext("2d");
    const g = c.createRadialGradient(128, 128, 8, 128, 128, 128);
    g.addColorStop(0.0, "rgba(255,255,255,1)");
    g.addColorStop(0.16, "rgba(240,246,255,0.98)");
    g.addColorStop(0.22, "rgba(190,214,255,0.55)");
    g.addColorStop(0.55, "rgba(140,180,255,0.10)");
    g.addColorStop(1.0, "rgba(120,160,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      /* 月亮在八百米外，楼会挡住它——关掉深度测试就会浮在楼前面 */
      depthTest: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    /* 放在画面左侧的天空里，不和主光同一条轴线 */
    const az = 2.75;
    const el = 0.34;
    sp.position.set(Math.cos(el) * Math.cos(az) * 800, Math.sin(el) * 800, Math.cos(el) * Math.sin(az) * 800);
    sp.scale.setScalar(34);
    sp.renderOrder = 2;
    this.moonMesh = sp;
    this.scene.add(sp);
  }

  /* ── 相机动向 ─────────────────────────────────────────────────────── */

  /**
   * 跟随设备。entity 只需提供 position / heading，
   * 有 viewYaw()、viewPitch() 时用它们（云台角度），否则退回机头朝向。
   * mode: 'first' 第一人称，'third' 第三人称
   */
  set_follow(entity, { mode = "third", eye_y = 1.15 } = {}) {
    if (!entity) {
      if (this.follow) this.follow.entity.setFirstPerson?.(false);
      this.follow = null;
      return;
    }
    this.follow = { entity, mode, eye_y };
    /* 第一人称要藏起自己的机身，否则相机被自己挡住 */
    entity.setFirstPerson?.(mode === "first");
  }

  /** 简单的轨道相机，鼠标拖动环绕、滚轮推拉 */
  bind_orbit(target = new THREE.Vector3(0, 4, 0)) {
    const el = this.renderer.domElement;
    /* 触控设备上不加这个，拖动会同时触发页面滚动与缩放 */
    el.style.touchAction = "none";

    this.orbit_target = target.clone();

    /* 切场景先清掉上一个场景声明的相机包围盒，由新场景自己重新声明 */
    this.cam_clamp = null;

    /* theta / phi / distance 是「想要的位置」，_theta / _phi / _distance 是
       「当前显示的位置」。每帧朝目标插值，转动才跟手且不抖。 */
    if (this.theta == null) this.theta = 0.6;
    if (this.phi == null) this.phi = 0.95;
    if (this.distance == null) this.distance = 70;
    this._theta = this.theta;
    this._phi = this.phi;
    this._distance = this.distance;
    this._target_now = this.orbit_target.clone();

    let drag = null;

    /* 起手也挂在 window：页面任意位置都能起手转视角，
       只有真正的按钮（切换场景、画质、重置）才拦下来。 */
    window.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest?.("button")) return;
      drag = { x: e.clientX, y: e.clientY };
    });

    /* 监听挂在 window 上：指针拖到画布外（比如划过顶栏）时，
       挂在 canvas 上的监听会收不到事件，拖动就断了。 */
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;

      /* 必须用「本次事件 - 上次事件」的增量。
         早先用的是「本次 - 按下点」的累计值，又叠加到上一次的结果上，
         拖动越快转得越狠，转起来就是一冲一冲的。 */
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;

      this.theta -= dx * 0.005;
      this.phi = Math.max(0.12, Math.min(1.42, this.phi - dy * 0.004));

      /* 拖动期间直接同步当前值，避免插值带来延迟感 */
      this._theta = this.theta;
      this._phi = this.phi;
    });

    const end_drag = (e) => {
      if (!drag) return;
      drag = null;
      if (el.hasPointerCapture?.(e?.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    /* 只监听 up 与 cancel。加了 pointerleave 时，
       指针拖到画布外会立刻中断拖动，手感很差。 */
    window.addEventListener("pointerup", end_drag);
    window.addEventListener("pointercancel", end_drag);

    el.addEventListener("wheel", (e) => {
      /* 按当前距离比例缩放，远近手感一致 */
      this.distance = Math.max(18, Math.min(260, this.distance * (1 + e.deltaY * 0.0011)));
      e.preventDefault();
    }, { passive: false });
  }

  /**
   * 画质档位。
   *
   * 三处最贵：屏幕空间环境光遮蔽（每帧多渲深度+法线+AO 三张全屏图）、
   * 像素比（2 倍等于四倍像素）、阴影贴图。
   * 默认给 medium：展台大屏够看，普通笔记本也能跑。
   */
  set_quality(level = "medium") {
    const P = {
      low:    { pixelRatio: 1.0, gtao: false, bloom: true, smaa: false, shadow: 1024 },
      medium: { pixelRatio: 1.2, gtao: true,  bloom: true, smaa: true,  shadow: 2048 },
      high:   { pixelRatio: 1.5, gtao: true,  bloom: true, smaa: true,  shadow: 2048 },
    }[level] || null;
    if (!P) return;

    this.quality = level;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, P.pixelRatio));
    this.gtao.enabled = P.gtao && this.night !== false;
    /* 强度为 0 时（沙盘白天 0.06）整条 5 级 mip 链白跑，
       真正要开关的是强度，见 _loop。 */
    this._bloom_want = P.bloom;
    this.bloom.enabled = P.bloom && this.bloom.strength > 0.08;
    this.smaa.enabled = P.smaa;

    if (this.sun.shadow.mapSize.x !== P.shadow) {
      this.sun.shadow.mapSize.set(P.shadow, P.shadow);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.resize();
  }

  /** 注册每帧回调，返回该回调以便单独移除 */
  add_updater(fn) {
    this.updaters.push(fn);
    return fn;
  }

  /** 切场景时清空上一场景的动画 */
  clear_updaters() {
    this.updaters.length = 0;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
    this.smaa.setSize(w, h);
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    /* 跟随模式：相机挂在设备上，第一人称与第三人称共用同一段逻辑。
       与轨道相机互斥，进了跟随就不再算插值。 */
    if (this.follow) {
      const { entity, mode, eye_y } = this.follow;
      const p = entity.position;
      const yaw = entity.viewYaw ? entity.viewYaw() : entity.heading;
      const pitch = entity.viewPitch ? entity.viewPitch() : 0;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);

      if (mode === "first") {
        /* 相机前移一点，避免看到自己机身的切面 */
        this.camera.position.set(p.x + fx * 0.22, eye_y, p.z + fz * 0.22);
        /* 相机默认朝 -Z，设备机头是 +Z，所以偏航加 π */
        this._euler.set(-pitch, yaw + Math.PI, 0, "YXZ");
        this.camera.quaternion.setFromEuler(this._euler);
      } else {
        /* 第三人称：机位在设备后上方，看向机头前方一点 */
        const dist = 5.2;
        const lift = 2.2;
        this.camera.position.set(p.x - fx * dist, eye_y + lift, p.z - fz * dist);
        this.camera.lookAt(p.x + fx * 2.0, eye_y - 0.1, p.z + fz * 2.0);
      }
    } else if (this.orbit_target) {
      /* 角度与距离朝目标插值；阻尼系数按 60fps 校准，
         低帧率时用 1-(1-k)^(dt*60) 保证手感一致 */
      const k = 1 - Math.pow(1 - 0.22, Math.min(dt, 0.1) * 60);
      this._theta += (this.theta - this._theta) * k;
      this._phi += (this.phi - this._phi) * k;
      this._distance += (this.distance - this._distance) * k;
      this._target_now.lerp(this.orbit_target, k);

      const t = this._target_now;
      const d = this._distance;
      this.camera.position.set(
        t.x + Math.sin(this._theta) * Math.cos(this._phi) * d,
        t.y + Math.sin(this._phi) * d,
        t.z + Math.cos(this._theta) * Math.cos(this._phi) * d
      );

      /* 可选包围盒：封闭空间（比如地铁站厅）里相机退出去就会看到盒子外面。
         相机与目标点都要夹，只夹相机的话贴墙时画面全是墙。 */
      const cc = this.cam_clamp;
      if (cc) {
        const p = this.camera.position;
        p.x = Math.min(cc.x[1], Math.max(cc.x[0], p.x));
        p.y = Math.min(cc.y[1], Math.max(cc.y[0], p.y));
        p.z = Math.min(cc.z[1], Math.max(cc.z[0], p.z));
        t.x = Math.min(cc.x[1], Math.max(cc.x[0], t.x));
        t.y = Math.min(cc.y[1], Math.max(cc.y[0], t.y));
        t.z = Math.min(cc.z[1], Math.max(cc.z[0], t.z));
      }
      this.camera.lookAt(t);
    }

    this.grade.uniforms.u_time.value = this.time;
    for (const fn of this.updaters) fn(dt, this.time);
    if (this.onFrame) this.onFrame(dt, this.time);

    /* 强度决定 Bloom 是否值得跑：沙盘白天 0.06，整条 mip 链看不见却每帧都在算 */
    this.bloom.enabled = this._bloom_want !== false && this.bloom.strength > 0.08;

    /* 阴影每帧重绘。曾经为了省一半阴影 pass 改成隔帧 + needsUpdate，
       结果人和车的影子在 30 Hz 上跳，大屏上看着就是「地面在抖」；
       实测隔帧方案只省约 20% 帧时间，换来的观感损失不值得。 */

    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }
}
