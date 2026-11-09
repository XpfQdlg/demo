import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { tickers, skyDome } from "./kit.js";

/* ══════════════════════════════════════════════════════════════════════════
   Engine — 渲染器、相机、灯光、标签层、帧循环、场景缓存

   与参考实现相比的三处改动：
   1. 场景缓存：四个场景各自构建一次后常驻，切换时只换根节点，不重建
   2. ticker 归属：每个场景构建时新注册的动画回调归该场景所有，
      只有当前场景的 ticker 才在帧循环里执行，非活动场景不耗 CPU
   3. 相机 rig：支持外部接管（第一人称），接管时停用 OrbitControls
   ══════════════════════════════════════════════════════════════════════════ */

/* 环境光预设：一个微缩的摄影棚渲染进 PMREM 立方体，
   金属、玻璃、瓷砖才有可信的反射，而不是一片灰 */
const ENV_PRESETS = {
  forest: { top: 0x9fc6ea, bottom: 0x33481f, sun: 0xfff2d6, sunI: 9, ground: 0x3f5a28, intensity: 0.62 },
  city: { top: 0xa9c9ea, bottom: 0x6a675d, sun: 0xffffff, sunI: 11, ground: 0x7a7768, intensity: 0.72 },
  indoor: { top: 0xc9d2da, bottom: 0x3c4248, sun: 0xfff0d2, sunI: 7, ground: 0x555b62, shell: 0x11161b, intensity: 0.85 },
};

export class Engine {
  constructor(stage) {
    this.stage = stage;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = false;

    this.frameCbs = [];
    this.scenes = new Map(); // scene_id -> { id, root, own_tickers, raw }
    this.activeSceneId = null;
    this.rig = null; // 外部相机接管（第一人称）

    this.flight = null;
    this.tmpV = new THREE.Vector3();

    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.02;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(r.domElement);
    this.renderer = r;

    this.pmrem = new THREE.PMREMGenerator(r);
    this.envCache = new Map();

    /* 标签层：CSS2D 渲染器，用于点位与设备名称 */
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(innerWidth, innerHeight);
    this.labelRenderer.domElement.style.position = "absolute";
    this.labelRenderer.domElement.style.top = "0";
    this.labelRenderer.domElement.style.left = "0";
    this.labelRenderer.domElement.style.pointerEvents = "none";
    this.labelRenderer.domElement.className = "label-layer";
    stage.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    /* 真实校园图幅约 540 × 777 米，远裁剪面必须给到千米级 */
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2600);
    this.camera.position.set(8, 7, 12);

    /* 俯瞰模式用的轨道控制，第一人称时停用 */
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.target.set(0, 0.6, 0);
    this.controls.addEventListener("start", () => {
      this.flight = null;
    });

    /* 全局灯光，按场景重新着色 */
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3b3a33, 0.85);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.position.set(12, 20, 8);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.022;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.fill = new THREE.DirectionalLight(0x8fb6ff, 0.35);
    this.fill.position.set(-9, 6, -8);
    this.scene.add(this.fill);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    addEventListener("resize", () => this.resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  onFrame(fn) {
    this.frameCbs.push(fn);
    return () => (this.frameCbs = this.frameCbs.filter((f) => f !== fn));
  }

  /* ── 环境贴图 ─────────────────────────────────────────────────────── */
  envTexture(kind = "city") {
    if (this.envCache.has(kind)) return this.envCache.get(kind);
    const P = ENV_PRESETS[kind] || ENV_PRESETS.city;

    const sc = new THREE.Scene();
    sc.add(skyDome(P.top, P.bottom, 60));

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(58, 32),
      new THREE.MeshBasicMaterial({ color: P.ground, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -6;
    sc.add(disc);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(5.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(P.sun).multiplyScalar(P.sunI) })
    );
    sun.position.set(14, 22, 10);
    sc.add(sun);

    const bounce = new THREE.Mesh(
      new THREE.SphereGeometry(7, 12, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(P.top).multiplyScalar(1.4) })
    );
    bounce.position.set(-20, 6, -14);
    sc.add(bounce);

    const rt = this.pmrem.fromScene(sc, 0.02, 1, 200);
    this.envCache.set(kind, rt.texture);
    disc.geometry.dispose();
    sun.geometry.dispose();
    bounce.geometry.dispose();
    return rt.texture;
  }

  setEnv({
    sky = 0x101821,
    fogNear = 18,
    fogFar = 70,
    sunColor = 0xfff0d8,
    sunInt = 2.4,
    hemiSky = 0xbfd8ff,
    hemiGround = 0x3b3a33,
    hemiInt = 0.85,
    sunPos = [12, 20, 8],
    exposure = 1.02,
    env = "city",
    shadows = true,
  }) {
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, fogNear, fogFar);
    /* 大场地关阴影：阴影贴图覆盖几百米会糊成一片，代价也不值 */
    this.sun.castShadow = shadows;
    this.sun.color.setHex(sunColor);
    this.sun.intensity = sunInt;
    this.sun.position.set(...sunPos);
    this.hemi.color.setHex(hemiSky);
    this.hemi.groundColor.setHex(hemiGround);
    this.hemi.intensity = hemiInt;
    this.renderer.toneMappingExposure = exposure;

    const tex = this.envTexture(env);
    this.scene.environment = tex;
    const P = ENV_PRESETS[env] || ENV_PRESETS.city;
    this.scene.environmentIntensity = P.intensity;
  }

  /* ── 场景缓存 ─────────────────────────────────────────────────────── */

  /**
   * 构建并缓存一个场景。build_fn 返回 { root, targets, spawns, extent }。
   * 构建过程中新注册到 kit 的 ticker 归本场景所有，切走后不再执行。
   */
  ensureScene(scene_id, build_fn) {
    const hit = this.scenes.get(scene_id);
    if (hit) return hit;

    const before = new Set(tickers);
    const built = build_fn();
    const own_tickers = [...tickers].filter((fn) => !before.has(fn));

    const rec = { id: scene_id, root: built.root, own_tickers, raw: built };
    this.scenes.set(scene_id, rec);
    return rec;
  }

  hasScene(scene_id) {
    return this.scenes.has(scene_id);
  }

  setActiveScene(scene_id) {
    const rec = this.scenes.get(scene_id);
    if (!rec) return null;
    for (const r of this.scenes.values()) {
      if (r.root.parent === this.scene) this.scene.remove(r.root);
    }
    this.scene.add(rec.root);
    this.activeSceneId = scene_id;
    return rec;
  }

  activeScene() {
    return this.scenes.get(this.activeSceneId) || null;
  }

  /* ── 相机 ─────────────────────────────────────────────────────────── */

  /** 由外部模块接管相机（第一人称）；传 null 交还给轨道控制 */
  setRig(rig) {
    this.rig = rig;
    this.controls.enabled = !rig;
    this.flight = null;
  }

  setFov(v) {
    if (this.camera.fov === v) return;
    this.camera.fov = v;
    this.camera.updateProjectionMatrix();
  }

  /** 俯瞰机位。maxDistance 必须随场地尺度放大，否则轨道控制会把相机夹回近处 */
  overview({ pos = [14, 16, 20], target = [0, 0, 0], maxDistance = 200 } = {}) {
    this.setRig(null);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
    this.controls.maxDistance = Math.max(maxDistance, 80);
    this.controls.update();
  }

  flyTo(pos, target, dur = 1.0) {
    this.flight = {
      from: this.camera.position.clone(),
      fromT: this.controls.target.clone(),
      to: pos.clone(),
      toT: target.clone(),
      t: 0,
      dur: Math.max(0.2, dur),
    };
  }

  /** 屏幕点 → 地面交点 */
  groundPoint(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.GROUND, hit) ? hit : null;
  }

  /* ── 俯视快照：2D 指挥图的底图来源 ───────────────────────────────── */

  snapshotTopDown({ root, env = {}, cx = 0, cz = 0, span = 64, px = 1024 }) {
    const tmp = new THREE.Scene();
    tmp.background = new THREE.Color(env.sky ?? 0x27313a);

    const hemi = new THREE.HemisphereLight(env.hemiSky ?? 0xbfd8ff, env.hemiGround ?? 0x3b3a33, env.hemiInt ?? 0.9);
    tmp.add(hemi);

    const sp = env.sunPos || [12, 20, 8];
    const sun = new THREE.DirectionalLight(env.sunColor ?? 0xfff0d8, env.sunInt ?? 2.4);
    sun.position.set(sp[0] * 1.6, sp[1] * 1.9, sp[2] * 1.6);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -span * 0.66;
    sc.right = span * 0.66;
    sc.top = span * 0.66;
    sc.bottom = -span * 0.66;
    sc.near = 1;
    sc.far = 220;
    sc.updateProjectionMatrix();
    tmp.add(sun, sun.target);

    const kind = env.env || "city";
    tmp.environment = this.envTexture(kind);
    tmp.environmentIntensity = (ENV_PRESETS[kind] || ENV_PRESETS.city).intensity;

    tmp.add(root);

    const rt = new THREE.WebGLRenderTarget(px, px, { type: THREE.UnsignedByteType });
    rt.texture.colorSpace = THREE.SRGBColorSpace;

    const cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.5, 420);
    cam.position.set(cx, 180, cz);
    cam.up.set(0, 0, -1); // 屏幕上方对应 -Z，读起来像总平面图
    cam.lookAt(cx, 0, cz);

    const prevRT = this.renderer.getRenderTarget();
    const prevExp = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = env.exposure ?? 1.0;

    const before = new Set(tickers);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(tmp, cam);
    const buf = new Uint8Array(px * px * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
    this.renderer.setRenderTarget(prevRT);
    this.renderer.toneMappingExposure = prevExp;

    /* 快照过程会创建只属于这次离屏渲染的动画回调，用完即弃 */
    for (const fn of [...tickers]) if (!before.has(fn)) tickers.delete(fn);

    rt.dispose();
    tmp.clear();
    hemi.dispose?.();
    sun.dispose?.();

    const cv = document.createElement("canvas");
    cv.width = px;
    cv.height = px;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(px, px);
    const stride = px * 4;
    for (let y = 0; y < px; y++) {
      const src = (px - 1 - y) * stride; // WebGL 自下而上
      img.data.set(buf.subarray(src, src + stride), y * stride);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.labelRenderer.setSize(innerWidth, innerHeight);
  }

  /* ── 帧循环 ───────────────────────────────────────────────────────── */

  _loop() {
    requestAnimationFrame(this._loop);
    const raw = Math.min(0.05, this.clock.getDelta());
    if (this.paused) return;

    this.time += raw;

    const rec = this.activeScene();
    if (rec) {
      for (const fn of rec.own_tickers) {
        try {
          fn(this.time, raw);
        } catch (e) {
          /* 单个道具出错不拖垮整个循环 */
        }
      }
    }

    for (const cb of this.frameCbs) cb(raw, this.time);

    if (this.flight) {
      const f = this.flight;
      f.t += raw / f.dur;
      const k = Math.min(1, f.t);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(f.from, f.to, e);
      this.controls.target.lerpVectors(f.fromT, f.toT, e);
      if (k >= 1) this.flight = null;
    }

    if (this.rig) this.rig.update(raw);
    else if (!this.flight) this.controls.update();

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
