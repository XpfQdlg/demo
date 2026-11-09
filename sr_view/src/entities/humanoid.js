import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/* ══════════════════════════════════════════════════════════════════════════
   人形巡检机器人 — 白色圆润的 service robot 造型

   造型口径（docs/03 第 3.2 节）：乳白主体、圆角头壳、颈部青色发光环、
   胸前状态灯、关节深灰软护套。与人形服务机器人的大众印象接近，
   展台灯光下辨识度高。

   与机器狗保持同一套公开接口，两者在调度与视角逻辑中可互换：
     position / heading / speed / gaitPhase / headYaw / headPitch
     setFirstPerson / viewYaw / viewPitch
     walkTo / stop / lookAtPoint / startScan / endScan / setStatus / update

   局部坐标：前向 +Z，上 +Y，站立时脚底在 y = 0。
   ══════════════════════════════════════════════════════════════════════════ */

const SHELL = 0xf2f5f8; // 乳白外壳
const JOINT = 0xc8d1da; // 关节护套
const DARK = 0x1a2028; // 面罩与底盘
const GLOW = 0x38e1ff; // 状态光

const mat_shell = new THREE.MeshPhysicalMaterial({
  color: SHELL,
  roughness: 0.32,
  metalness: 0.05,
  clearcoat: 0.85,
  clearcoatRoughness: 0.18,
  envMapIntensity: 1.15,
});

const mat_joint = new THREE.MeshPhysicalMaterial({
  color: JOINT,
  roughness: 0.55,
  metalness: 0.15,
  clearcoat: 0.4,
  clearcoatRoughness: 0.35,
  envMapIntensity: 0.95,
});

const mat_dark = new THREE.MeshStandardMaterial({
  color: DARK,
  roughness: 0.42,
  metalness: 0.6,
  envMapIntensity: 1.0,
});

const mat_visor = new THREE.MeshPhysicalMaterial({
  color: 0x0a1016,
  roughness: 0.08,
  metalness: 0.55,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.8,
  emissive: new THREE.Color(0x0e5c72),
  emissiveIntensity: 0.32,
});

function rbox(w, h, d, r, mat) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** 一条手臂：肩 → 上臂 → 肘 → 前臂 → 手 */
function build_arm(side) {
  const shoulder = new THREE.Group();

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), mat_joint);
  cap.castShadow = true;
  shoulder.add(cap);

  const upper = new THREE.Group();
  shoulder.add(upper);
  const up_arm = rbox(0.078, 0.26, 0.078, 0.034, mat_shell);
  up_arm.position.y = -0.14;
  upper.add(up_arm);

  const elbow = new THREE.Group();
  elbow.position.y = -0.28;
  upper.add(elbow);
  const elbow_ball = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), mat_joint);
  elbow_ball.castShadow = true;
  elbow.add(elbow_ball);

  const fore_arm = rbox(0.066, 0.24, 0.07, 0.03, mat_shell);
  fore_arm.position.y = -0.13;
  elbow.add(fore_arm);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 9), mat_joint);
  hand.scale.set(1, 0.85, 0.8);
  hand.position.y = -0.28;
  hand.castShadow = true;
  elbow.add(hand);

  return { shoulder, upper, elbow, side };
}

/** 一条腿：髋 → 大腿 → 膝 → 小腿 → 脚 */
function build_leg(side) {
  const hip = new THREE.Group();

  const thigh = rbox(0.098, 0.4, 0.1, 0.04, mat_shell);
  thigh.position.y = -0.2;
  hip.add(thigh);

  const knee = new THREE.Group();
  knee.position.y = -0.42;
  hip.add(knee);
  const knee_joint = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 9), mat_joint);
  knee_joint.castShadow = true;
  knee.add(knee_joint);

  const shin = rbox(0.084, 0.4, 0.088, 0.036, mat_shell);
  shin.position.y = -0.22;
  knee.add(shin);

  const ankle = new THREE.Group();
  ankle.position.y = -0.42;
  knee.add(ankle);

  const foot = rbox(0.11, 0.07, 0.22, 0.028, mat_dark);
  foot.position.set(0, -0.035, 0.04);
  ankle.add(foot);

  return { hip, knee, ankle, side };
}

export class Humanoid {
  constructor({ scale = 1 } = {}) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    this.body = new THREE.Group();
    this.root.add(this.body);

    /* ── 躯干 ─────────────────────────────────────────────────────── */
    const torso = rbox(0.34, 0.5, 0.22, 0.1, mat_shell);
    torso.position.y = 1.18;
    this.body.add(torso);

    /* 腰部收窄，避免看起来像一个柱体 */
    const waist = rbox(0.24, 0.1, 0.18, 0.05, mat_joint);
    waist.position.y = 0.92;
    this.body.add(waist);

    /* 肩部横梁 */
    const yoke = rbox(0.4, 0.1, 0.18, 0.045, mat_joint);
    yoke.position.y = 1.42;
    this.body.add(yoke);

    /* 胸前状态灯 */
    this.status_mat = new THREE.MeshStandardMaterial({
      color: 0x0b1418,
      emissive: new THREE.Color(GLOW),
      emissiveIntensity: 1.8,
      roughness: 0.3,
    });
    const chest = new THREE.Mesh(new THREE.CircleGeometry(0.038, 24), this.status_mat);
    chest.position.set(0, 1.28, 0.113);
    this.body.add(chest);

    /* 背包，给背面一点体量 */
    const pack = rbox(0.26, 0.3, 0.09, 0.035, mat_joint);
    pack.position.set(0, 1.2, -0.15);
    this.body.add(pack);

    /* ── 颈部与头部 ───────────────────────────────────────────────── */
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.08, 14), mat_dark);
    neck.position.y = 1.47;
    this.body.add(neck);

    /* 颈部发光环：整机的识别特征 */
    this.neck_ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.062, 0.009, 8, 28),
      new THREE.MeshStandardMaterial({
        color: 0x08131a,
        emissive: new THREE.Color(GLOW),
        emissiveIntensity: 2.2,
        roughness: 0.35,
      })
    );
    this.neck_ring.rotation.x = Math.PI / 2;
    this.neck_ring.position.y = 1.5;
    this.body.add(this.neck_ring);

    this.head_pivot = new THREE.Group();
    this.head_pivot.position.set(0, 1.52, 0);
    this.body.add(this.head_pivot);

    const head = rbox(0.2, 0.21, 0.2, 0.075, mat_shell);
    head.position.y = 0.12;
    this.head_pivot.add(head);

    /* 面罩：一条横向深色带，比整块深色更收敛 */
    const visor = rbox(0.148, 0.05, 0.026, 0.022, mat_visor);
    visor.position.set(0, 0.135, 0.096);
    this.head_pivot.add(visor);

    /* 头顶传感器 */
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.028, 16), mat_dark);
    crown.position.y = 0.235;
    this.head_pivot.add(crown);

    const crown_glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 12, 9),
      new THREE.MeshStandardMaterial({
        color: 0x08131a,
        emissive: new THREE.Color(GLOW),
        emissiveIntensity: 2.4,
      })
    );
    crown_glow.position.y = 0.252;
    this.head_pivot.add(crown_glow);

    /* ── 四肢 ─────────────────────────────────────────────────────── */
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = build_arm(side);
      arm.shoulder.position.set(side * 0.225, 1.4, 0);
      this.body.add(arm.shoulder);
      this.arms.push(arm);
    }

    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = build_leg(side);
      leg.hip.position.set(side * 0.098, 0.9, 0);
      this.body.add(leg.hip);
      this.legs.push(leg);
    }

    /* ── 状态 ─────────────────────────────────────────────────────── */
    this.gait_phase = 0;
    this.speed = 0;
    this.target_speed = 0;
    this.max_speed = 1.3;
    this.heading = 0;
    this.dest = null;
    this.mode = "idle";
    this.scan_t = 0;
    this.scan_dur = 1.8;
    this.look_target = null;
    this.head_yaw = 0;
    this.head_pitch = 0;
    this.on_arrive = null;
  }

  get position() {
    return this.root.position;
  }

  /* 相机 rig 读取的接口，与机器狗同名 */
  get gaitPhase() {
    return this.gait_phase;
  }
  get maxSpeed() {
    return this.max_speed;
  }
  get headYaw() {
    return this.head_yaw;
  }
  get headPitch() {
    return this.head_pitch;
  }

  setStatus(hex) {
    this.status_mat.emissive.setHex(hex);
    this.neck_ring.material.emissive.setHex(hex);
  }

  setFirstPerson(on) {
    this.body.visible = !on;
  }

  viewYaw() {
    return this.heading + this.head_yaw;
  }

  viewPitch() {
    return this.head_pitch;
  }

  walkTo(v) {
    this.dest = v.clone();
    this.dest.y = 0;
    this.mode = "walk";
    this.target_speed = this.max_speed;
    this.setStatus(GLOW);
  }

  stop() {
    this.dest = null;
    this.target_speed = 0;
    this.mode = "idle";
  }

  lookAtPoint(v) {
    this.look_target = v ? v.clone() : null;
  }

  startScan(duration = 1.8) {
    this.mode = "scan";
    this.scan_t = 0;
    this.scan_dur = duration;
    this.target_speed = 0;
    this.setStatus(0xffb454);
  }

  endScan() {
    if (this.mode === "scan") this.mode = "idle";
  }

  alert(duration = 2.4) {
    this.mode = "alert";
    this.scan_t = 0;
    this.scan_dur = duration;
    this.setStatus(0xff5a6a);
  }

  update(dt, t) {
    /* ── 导航 ─────────────────────────────────────────────────────── */
    if (this.dest) {
      const dx = this.dest.x - this.root.position.x;
      const dz = this.dest.z - this.root.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.28) {
        this.dest = null;
        this.target_speed = 0;
        if (this.on_arrive) {
          const cb = this.on_arrive;
          this.on_arrive = null;
          cb();
        }
      } else {
        const want = Math.atan2(dx, dz);
        let diff = want - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnRate = 1.6 * dt;
        this.heading += Math.max(-turnRate, Math.min(turnRate, diff));
        this.target_speed = this.max_speed * (1 - Math.min(0.5, Math.abs(diff) * 0.45));
      }
    }

    this.speed += (this.target_speed - this.speed) * Math.min(1, dt * 3.2);
    if (this.dest) {
      const moved = this.speed * dt;
      this.root.position.x += Math.sin(this.heading) * moved;
      this.root.position.z += Math.cos(this.heading) * moved;
    }
    this.root.rotation.y = this.heading;

    /* ── 步态 ─────────────────────────────────────────────────────────
       原来的动作用两个正弦对角腿摆动，躯干完全不动，看起来像僵尸平移。
       这一版补了四件事，都是人走路时的真实特征：
         1. 骨盆绕竖轴轻微转动（前面那条腿一侧往前送）
         2. 肩部反向转动，与骨盆形成对扭
         3. 脚踝有脚跟落地与脚尖离地，脚不再平着拖
         4. 身体左右重心转移 + 上下起伏，重心落在支撑腿上
       ───────────────────────────────────────────────────────────────── */
    const stride = 1.9 + this.speed * 2.4;
    this.gait_phase += dt * stride;
    const walk_amt = Math.min(1, this.speed / (this.max_speed * 0.5));
    const idle_amt = 1 - walk_amt;
    const gp = this.gait_phase;

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      /* 两条腿相位差 π：一条在支撑，一条在摆动 */
      const p = gp + (i === 0 ? 0 : Math.PI);
      const swing = Math.cos(p) * 0.4 * walk_amt;
      /* 抬起只发生在摆动相，支撑相脚要踩实 */
      const lift = Math.max(0, Math.sin(p)) * walk_amt;
      /* -1 = 脚在最后方（蹬地），+1 = 脚在最前方（脚跟落地） */
      const fore = Math.cos(p);

      leg.hip.rotation.x = swing + Math.sin(t * 0.9 + i * 2) * 0.01 * idle_amt;
      /* 摆动相屈膝抬脚，支撑相膝盖伸直承重 */
      leg.knee.rotation.x = 0.12 + lift * 0.68 - Math.max(0, -fore) * 0.05 * walk_amt;
      /* 脚踝：落地时脚尖上翘（脚跟先着地），蹬地时脚尖下压 */
      leg.ankle.rotation.x =
        -0.08 - lift * 0.18 + Math.max(0, fore) * 0.13 * walk_amt - Math.max(0, -fore) * 0.08 * walk_amt;
      /* 摆动相略微外展，避免两条腿贴太近 */
      leg.hip.rotation.z = leg.side * (0.02 + lift * 0.04);
    }

    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i];
      /* 手臂与同侧腿反相 */
      const p = gp + (i === 0 ? 0 : Math.PI) + Math.PI;
      const swing = Math.cos(p) * 0.36 * walk_amt;
      arm.upper.rotation.x = swing;
      arm.upper.rotation.z = (i === 0 ? -1 : 1) * (0.07 + 0.03 * idle_amt + 0.02 * walk_amt);
      /* 前摆时肘部自然弯曲得多一些 */
      arm.elbow.rotation.x = -0.16 - Math.max(0, swing) * 0.55;
    }

    /* ── 躯干：骨盆与肩部对扭 ───────────────────────────────────────── */
    const twist = Math.cos(gp) * 0.055 * walk_amt;
    this.body.rotation.y = twist;

    /* ── 重心：左右前后都要有位移 ───────────────────────────────────── */
    const bob = Math.abs(Math.sin(gp)) * 0.022 * walk_amt;
    this.body.position.y = bob;
    /* 侧向摇晃，重心压在支撑腿上 */
    this.body.position.x = Math.sin(gp) * 0.018 * walk_amt;
    this.body.rotation.z = Math.sin(gp) * 0.028 * walk_amt;
    /* 走路时身体略微前倾，速度越快越明显 */
    this.body.rotation.x = this.speed / Math.max(0.001, this.max_speed) * 0.035;

    /* ── 头部朝向 ─────────────────────────────────────────────────── */
    let want_yaw = 0;
    let want_pitch = -0.02;

    if (this.mode === "scan") {
      this.scan_t += dt;
      const k = Math.min(1, this.scan_t / this.scan_dur);
      want_yaw = Math.sin(k * Math.PI * 2.4) * 0.4;
      want_pitch = -0.12 + Math.sin(k * Math.PI * 1.6) * 0.05;
    } else if (this.mode === "alert") {
      this.scan_t += dt;
      want_pitch = -0.16;
      want_yaw = Math.sin(this.scan_t * 9) * 0.05;
      if (this.scan_t > this.scan_dur) this.mode = "idle";
    } else if (this.look_target) {
      const wp = this.look_target.clone();
      const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
      wp.applyMatrix4(inv);
      const lz = wp.z;
      const lx = wp.x;
      const ly = wp.y - 1.55;
      want_yaw = Math.max(-0.75, Math.min(0.75, Math.atan2(lx, Math.max(0.15, lz))));
      want_pitch = Math.max(-0.45, Math.min(0.3, -Math.atan2(ly, Math.max(0.2, Math.hypot(lx, lz)))));
    } else {
      want_yaw = Math.sin(t * 0.42) * 0.18;
      want_pitch = -0.02 + Math.sin(t * 0.7) * 0.03;
    }

    this.head_yaw += (want_yaw - this.head_yaw) * Math.min(1, dt * 6);
    this.head_pitch += (want_pitch - this.head_pitch) * Math.min(1, dt * 6);
    this.head_pivot.rotation.y = this.head_yaw;
    this.head_pivot.rotation.x = this.head_pitch;

    /* ── 灯光呼吸 ─────────────────────────────────────────────────── */
    const pulse = 1.5 + Math.sin(t * 2.6) * 0.35;
    this.status_mat.emissiveIntensity = this.mode === "scan" ? 2.6 + Math.sin(t * 12) * 0.7 : pulse;
    this.neck_ring.material.emissiveIntensity = this.mode === "alert" ? 1.4 + Math.sin(t * 16) * 0.9 : pulse * 1.2;
  }
}
