import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addTick } from "../core/kit.js";
import { glowTex } from "../core/tex.js";

/* ══════════════════════════════════════════════════════════════════════════
   四足机器人「巡检犬」— fully procedural, jointed, animated.
   Local forward axis = +Z, up = +Y.
   ══════════════════════════════════════════════════════════════════════════ */

const BODY = 0x3a434f; // graphite shell
const SHELL = 0xd8dde3; // light panels
const ACCENT = 0xf0b429; // safety yellow
const DARK = 0x15181c;

const matBody = new THREE.MeshPhysicalMaterial({
  color: BODY,
  roughness: 0.34,
  metalness: 0.62,
  clearcoat: 0.7,
  clearcoatRoughness: 0.22,
  envMapIntensity: 1.25,
});
const matShell = new THREE.MeshPhysicalMaterial({
  color: SHELL,
  roughness: 0.4,
  metalness: 0.15,
  clearcoat: 0.55,
  clearcoatRoughness: 0.3,
  envMapIntensity: 1.1,
});
const matAccent = new THREE.MeshPhysicalMaterial({
  color: ACCENT,
  roughness: 0.42,
  metalness: 0.2,
  clearcoat: 0.6,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.15,
});
const matDark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5, metalness: 0.78, envMapIntensity: 1.1 });
const matRubber = new THREE.MeshStandardMaterial({ color: 0x101215, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.5 });
const matLens = new THREE.MeshPhysicalMaterial({
  color: 0x08222b,
  roughness: 0.04,
  metalness: 0.55,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  envMapIntensity: 2.4,
  emissive: new THREE.Color(0x35e6ff),
  emissiveIntensity: 0.9,
});

function rbox(w, h, d, r, mat) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** one articulated leg: hip → upper → knee → lower → foot */
function buildLeg() {
  const hip = new THREE.Group();

  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.075, 14), matDark);
  shoulder.rotation.z = Math.PI / 2;
  shoulder.castShadow = true;
  hip.add(shoulder);
  hip.add(new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 18), matAccent).rotateY(Math.PI / 2));

  const upper = new THREE.Group();
  upper.position.y = -0.02;
  hip.add(upper);

  const thigh = rbox(0.088, 0.21, 0.098, 0.028, matBody);
  thigh.position.y = -0.1;
  upper.add(thigh);
  const thighPlate = rbox(0.055, 0.13, 0.02, 0.01, matShell);
  thighPlate.position.set(0, -0.1, 0.048);
  upper.add(thighPlate);

  const knee = new THREE.Group();
  knee.position.y = -0.2;
  upper.add(knee);
  const kneeJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.078, 12), matDark);
  kneeJoint.rotation.z = Math.PI / 2;
  kneeJoint.castShadow = true;
  knee.add(kneeJoint);

  const shin = rbox(0.062, 0.2, 0.068, 0.02, matBody);
  shin.position.y = -0.11;
  knee.add(shin);

  const ankle = new THREE.Group();
  ankle.position.y = -0.2;
  knee.add(ankle);
  ankle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.06, 10), matDark).rotateZ(Math.PI / 2));
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 8), matRubber);
  foot.scale.set(1, 0.62, 1.35);
  foot.position.y = -0.035;
  foot.castShadow = true;
  ankle.add(foot);

  return { hip, upper, knee, ankle, foot };
}

export class Dog {
  constructor({ scale = 1 } = {}) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    this.body = new THREE.Group();
    this.body.position.y = 0.46;
    this.root.add(this.body);

    /* ── torso ─────────────────────────────────────────────────────── */
    const torso = rbox(0.34, 0.22, 0.6, 0.075, matBody);
    this.body.add(torso);

    const backPlate = rbox(0.3, 0.05, 0.46, 0.022, matShell);
    backPlate.position.y = 0.11;
    this.body.add(backPlate);

    // top hatch / payload rails
    for (const z of [-0.1, 0.1]) {
      const rail = rbox(0.3, 0.028, 0.03, 0.012, matDark);
      rail.position.set(0, 0.14, z);
      this.body.add(rail);
    }
    const hatch = rbox(0.16, 0.05, 0.16, 0.02, matDark);
    hatch.position.set(0, 0.15, 0);
    this.body.add(hatch);

    // belly
    const belly = rbox(0.22, 0.05, 0.4, 0.02, matDark);
    belly.position.y = -0.1;
    this.body.add(belly);

    // side accent stripes + unit number
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.022), matAccent);
      strip.position.set(s * 0.151, 0.02, 0);
      strip.rotation.y = s * Math.PI * 0.5;
      this.body.add(strip);
    }
    // status light bar along each flank
    this.statusMat = new THREE.MeshStandardMaterial({
      color: 0x0d1c22,
      emissive: new THREE.Color(0x43e0ff),
      emissiveIntensity: 1.6,
      roughness: 0.3,
    });
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.014), this.statusMat);
      bar.position.set(s * 0.1515, -0.035, 0);
      bar.rotation.y = s * Math.PI * 0.5;
      this.body.add(bar);
    }

    /* ── head ──────────────────────────────────────────────────────── */
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 0.055, 0.3);
    this.body.add(this.headPivot);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 12), matDark);
    neck.rotation.x = Math.PI / 2;
    neck.position.z = -0.03;
    this.headPivot.add(neck);

    const head = rbox(0.2, 0.155, 0.185, 0.05, matBody);
    head.position.z = 0.09;
    this.headPivot.add(head);

    const visor = rbox(0.185, 0.1, 0.03, 0.012, matDark);
    visor.position.set(0, 0.008, 0.172);
    this.headPivot.add(visor);

    // main camera lens
    const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 20), matShell);
    lensRing.rotation.x = Math.PI / 2;
    lensRing.position.set(0, 0.012, 0.185);
    this.headPivot.add(lensRing);
    this.lens = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), matLens);
    this.lens.position.set(0, 0.012, 0.196);
    this.headPivot.add(this.lens);
    this.lensLight = new THREE.PointLight(0x35e6ff, 0.6, 2.2, 2);
    this.lensLight.position.set(0, 0.012, 0.3);
    this.headPivot.add(this.lensLight);

    // twin side sensors (eyes)
    this.eyeMats = [];
    for (const s of [-1, 1]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: new THREE.Color(0x35e6ff), emissiveIntensity: 1.4, roughness: 0.3 });
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), m);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(s * 0.055, 0.03, 0.176);
      this.headPivot.add(eye);
      this.eyeMats.push(m);
    }

    // ears / antenna
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.075, 4), matAccent);
      ear.position.set(s * 0.062, 0.088, 0.05);
      ear.rotation.z = s * 0.42;
      ear.rotation.x = -0.15;
      ear.castShadow = true;
      this.headPivot.add(ear);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.11, 6), matDark);
    ant.position.set(0, 0.1, -0.01);
    this.headPivot.add(ant);
    this.antTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: new THREE.Color(0x43e0ff),
      emissiveIntensity: 2,
    }));
    this.antTip.position.set(0, 0.158, -0.01);
    this.headPivot.add(this.antTip);

    // lidar puck on the back
    this.lidar = new THREE.Group();
    this.lidar.position.set(0, 0.2, -0.06);
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 18), matDark);
    puck.castShadow = true;
    this.lidar.add(puck);
    const spin = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.014, 0.02), matShell);
    spin.position.y = 0.022;
    this.lidar.add(spin);
    this.lidarSpin = spin;
    this.body.add(this.lidar);

    /* ── tail ──────────────────────────────────────────────────────── */
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.06, -0.29);
    const tailArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.2, 8), matDark);
    tailArm.rotation.x = -0.6;
    tailArm.position.set(0, 0.055, -0.06);
    this.tail.add(tailArm);
    this.tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshStandardMaterial({
      color: 0x101418,
      emissive: new THREE.Color(0x43e0ff),
      emissiveIntensity: 1.8,
    }));
    this.tailTip.position.set(0, 0.1, -0.13);
    this.tail.add(this.tailTip);
    this.body.add(this.tail);

    /* ── legs ──────────────────────────────────────────────────────── */
    this.legs = [];
    const spec = [
      { x: 0.145, z: 0.2, front: true, right: true },
      { x: -0.145, z: 0.2, front: true, right: false },
      { x: 0.145, z: -0.2, front: false, right: true },
      { x: -0.145, z: -0.2, front: false, right: false },
    ];
    for (const s of spec) {
      const leg = buildLeg();
      leg.hip.position.set(s.x, -0.02, s.z);
      leg.front = s.front;
      leg.right = s.right;
      leg.phase = (s.front && s.right) || (!s.front && !s.right) ? 0 : Math.PI;
      this.body.add(leg.hip);
      this.legs.push(leg);
    }

    /* ── contact shadow + scan beam ────────────────────────────────── */
    const shMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
    this.shadowBlob = new THREE.Sprite(shMat);
    this.shadowBlob.scale.set(0.62, 0.62, 1);
    this.shadowBlob.position.y = 0.02;
    this.root.add(this.shadowBlob);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x43e0ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beamGeo = new THREE.ConeGeometry(0.62, 2.6, 22, 1, true);
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.rotation.x = -Math.PI / 2;
    this.beam.position.set(0, 0.0, 1.35);
    this.beam.visible = false;
    this.headPivot.add(this.beam);
    this.beamMat = beamMat;

    /* ── state ─────────────────────────────────────────────────────── */
    this.gaitPhase = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.maxSpeed = 4.0;
    this.heading = 0;
    this.dest = null;
    this.arrived = false;
    this.mode = "idle"; // idle | walk | scan | alert
    this.scanT = 0;
    this.scanDur = 1.7;
    this.lookTarget = null;
    this.headYaw = 0;
    this.headPitch = 0;
    this.bob = 0;
    this.onArrive = null;
    this.turnLean = 0;
    this.enabled = true;
  }

  get position() {
    return this.root.position;
  }

  setStatus(hex) {
    this.statusMat.emissive.setHex(hex);
    this.antTip.material.emissive.setHex(hex);
    this.tailTip.material.emissive.setHex(hex);
    for (const m of this.eyeMats) m.emissive.setHex(hex);
  }

  /** 第一人称：隐藏自身模型，避免相机被自己的机身挡住 */
  setFirstPerson(on) {
    this.body.visible = !on;
    this.shadowBlob.visible = !on;
  }

  /** 生成第一人称相机姿态所需的朝向（机头方向 +Z，偏航以 heading 为基准） */
  viewYaw() {
    return this.heading + this.headYaw;
  }

  viewPitch() {
    return this.headPitch;
  }

  /** navigate to a world position; resolves via onArrive callback */
  walkTo(v) {
    this.dest = v.clone();
    this.dest.y = 0;
    this.arrived = false;
    this.mode = "walk";
    this.targetSpeed = this.maxSpeed;
    this.setStatus(0x43e0ff);
  }

  stop() {
    this.dest = null;
    this.targetSpeed = 0;
    this.mode = "idle";
  }

  lookAtPoint(v) {
    this.lookTarget = v ? v.clone() : null;
  }

  /** begin a detection scan — beam on, head sweeps */
  startScan(duration = 1.7) {
    this.mode = "scan";
    this.scanT = 0;
    this.scanDur = duration;
    this.targetSpeed = 0;
    this.beam.visible = true;
    this.setStatus(0xffb454);
  }

  endScan() {
    this.beam.visible = false;
    this.beamMat.opacity = 0;
    if (this.mode === "scan") this.mode = "idle";
  }

  alert(duration = 2.4) {
    this.mode = "alert";
    this.scanT = 0;
    this.scanDur = duration;
    this.endScan();
    this.mode = "alert";
    this.setStatus(0xff5a6a);
  }

  update(dt, t) {
    if (!this.enabled) dt = 0;

    /* ── navigation ──────────────────────────────────────────────── */
    let moved = 0;
    if (this.dest) {
      const dx = this.dest.x - this.root.position.x;
      const dz = this.dest.z - this.root.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) {
        this.dest = null;
        this.targetSpeed = 0;
        this.arrived = true;
        if (this.onArrive) {
          const cb = this.onArrive;
          this.onArrive = null;
          cb();
        }
      } else {
        const want = Math.atan2(dx, dz);
        let diff = want - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnRate = 1.8 * dt;
        const turn = Math.max(-turnRate, Math.min(turnRate, diff));
        this.heading += turn;
        this.turnLean += ((turn / Math.max(dt, 1e-4)) * 0.045 - this.turnLean) * Math.min(1, dt * 6);
        // slow down while turning sharply
        const slow = 1 - Math.min(0.55, Math.abs(diff) * 0.5);
        this.targetSpeed = this.maxSpeed * slow;
      }
    }

    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 3.6);
    if (this.dest) {
      moved = this.speed * dt;
      this.root.position.x += Math.sin(this.heading) * moved;
      this.root.position.z += Math.cos(this.heading) * moved;
    }
    this.root.rotation.y = this.heading;

    /* ── gait ────────────────────────────────────────────────────── */
    const stride = 1.8 + this.speed * 1.6;
    const prevPhase = this.gaitPhase;
    this.gaitPhase += dt * stride;
    const walkAmt = Math.min(1, this.speed / (this.maxSpeed * 0.55));
    const idleAmt = 1 - walkAmt;

    for (const leg of this.legs) {
      const p = this.gaitPhase + leg.phase;
      // hip swing: forward at p=π/2 … backward at 3π/2
      const swing = Math.cos(p) * 0.5 * walkAmt;
      const lift = Math.max(0, Math.sin(p)) * walkAmt * 0.85;
      // knee folds while the foot is airborne
      const kneeBend = (0.28 + lift * 0.75 + Math.abs(Math.cos(p)) * 0.1) * walkAmt;
      const idleBend = 0.3 * idleAmt;

      leg.hip.rotation.x = swing + Math.sin(t * 1.2 + leg.phase) * 0.012 * idleAmt;
      leg.upper.rotation.x = -0.12 * walkAmt - idleBend * 0.2;
      leg.knee.rotation.x = 0.32 + kneeBend + idleBend;
      leg.ankle.rotation.x = -0.22 - kneeBend * 0.55 - idleBend * 0.7;
      // slight outward splay for the front legs
      leg.hip.rotation.z = (leg.right ? -1 : 1) * (0.06 + lift * 0.05);
    }

    /* ── body bob / lean ─────────────────────────────────────────── */
    const bob = Math.sin(this.gaitPhase * 2) * 0.014 * walkAmt;
    const roll = Math.sin(this.gaitPhase) * 0.045 * walkAmt;
    this.body.position.y = 0.46 + bob - (this.mode === "scan" ? 0.02 : 0);
    this.body.rotation.z = roll - this.turnLean;
    this.body.rotation.x = Math.sin(this.gaitPhase * 2 + 0.6) * 0.02 * walkAmt + (this.mode === "alert" ? -0.09 : 0);

    /* ── head aim ────────────────────────────────────────────────── */
    let wantYaw = 0;
    let wantPitch = -0.05;
    if (this.mode === "scan") {
      this.scanT += dt;
      // sweep left-right across the target
      const k = Math.min(1, this.scanT / this.scanDur);
      wantYaw = Math.sin(k * Math.PI * 3.2) * 0.42;
      wantPitch = -0.16 + Math.sin(k * Math.PI * 2) * 0.05;
      this.beamMat.opacity = 0.1 + Math.abs(Math.sin(this.scanT * 6)) * 0.1;
    } else if (this.mode === "alert") {
      this.scanT += dt;
      wantPitch = -0.22;
      wantYaw = Math.sin(this.scanT * 12) * 0.06;
      if (this.scanT > this.scanDur) this.mode = "idle";
    } else if (this.lookTarget) {
      const wp = this.lookTarget.clone();
      // to local space of the dog
      const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
      wp.applyMatrix4(inv);
      const lz = wp.z - 0.3;
      const lx = wp.x;
      const ly = wp.y - 0.5;
      wantYaw = Math.max(-0.7, Math.min(0.7, Math.atan2(lx, Math.max(0.15, lz))));
      wantPitch = Math.max(-0.5, Math.min(0.35, -Math.atan2(ly, Math.max(0.2, Math.hypot(lx, lz)))));
    } else {
      wantYaw = Math.sin(t * 0.55) * 0.16;
      wantPitch = -0.04 + Math.sin(t * 0.9) * 0.03;
    }
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * 7);
    this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 7);
    this.headPivot.rotation.y = this.headYaw;
    this.headPivot.rotation.x = this.headPitch;

    /* ── idle micro-motion ───────────────────────────────────────── */
    this.tail.rotation.z = Math.sin(t * 6.5) * 0.34 * (0.35 + walkAmt * 0.7);
    this.tail.rotation.x = -0.2 + Math.sin(t * 3.1) * 0.1;
    this.lidarSpin.rotation.y = t * 7.5;
    this.lidar.rotation.y = Math.sin(t * 2) * 0.05;

    const pulse = 1.2 + Math.sin(t * 3.4) * 0.35;
    if (this.mode === "scan") this.statusMat.emissiveIntensity = 2.0 + Math.sin(t * 14) * 0.8;
    else if (this.mode === "alert") this.statusMat.emissiveIntensity = 1.2 + Math.sin(t * 18) * 1.0;
    else this.statusMat.emissiveIntensity = pulse;

    this.lensLight.intensity = 0.5 + Math.sin(t * 2.2) * 0.15 + (this.mode === "scan" ? 1.2 : 0);
    this.shadowBlob.position.set(0, 0.015, 0);

    if (this.mode === "alert" && this.scanT > this.scanDur) {
      this.mode = "idle";
      this.setStatus(0x43e0ff);
    }
  }
}
