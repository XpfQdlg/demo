import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════════════
   FirstPersonRig — 第一人称机器视角

   相机挂在执行体上，位置取该执行体的视高配置，朝向跟随机头偏航与云台俯仰。
   自身模型在进入第一人称时隐藏，否则相机会被自己的机身挡住。

   视高不取模型真实头部高度：机器狗头高只有约 0.6 m，直接使用是蚂蚁视角，
   地面目标会被极度压缩，大屏上看不清。方案定为狗 1.15 m、人形 1.62 m。
   ══════════════════════════════════════════════════════════════════════════ */

const FORWARD_OFFSET = 0.22; // 相机前移，避免看到机身切面

export class FirstPersonRig {
  constructor(engine) {
    this.engine = engine;
    this.agent = null;
    this.eyeY = 0;
    this.tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
  }

  attach(agent) {
    if (this.agent && this.agent !== agent) {
      this.agent.entity.setFirstPerson?.(false);
    }
    this.agent = agent;
    if (!agent) return;

    agent.entity.setFirstPerson?.(true);
    this.eyeY = agent.view_height;
    this.engine.setFov(agent.fov);
    this.apply(true);
  }

  detach() {
    if (this.agent) this.agent.entity.setFirstPerson?.(false);
    this.agent = null;
  }

  /** 切换执行体时立即贴到位，不做插值，避免镜头飞过去 */
  apply(snap = false) {
    const a = this.agent;
    if (!a) return;
    const e = a.entity;

    const yaw = e.viewYaw ? e.viewYaw() : e.heading;
    const pitch = e.viewPitch ? e.viewPitch() : 0;

    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    const cam = this.engine.camera;
    cam.position.set(e.position.x + fx * FORWARD_OFFSET, this.eyeY, e.position.z + fz * FORWARD_OFFSET);
    /* 相机默认朝 -Z，而执行体的机头是 +Z，因此偏航加 π。
       YXZ 顺序先偏航后俯仰，是标准第一人称写法。 */
    this.tmpEuler.set(-pitch, yaw + Math.PI, 0, "YXZ");
    cam.quaternion.setFromEuler(this.tmpEuler);

    if (snap) cam.updateMatrixWorld();
  }

  update(dt) {
    const a = this.agent;
    if (!a) return;
    const e = a.entity;

    /* 步态起伏只保留约两成，全量会给相机带来明显抖动 */
    const walkAmt = Math.min(1, Math.abs(e.speed || 0) / Math.max(0.001, e.maxSpeed || 1));
    const bob = Math.sin((e.gaitPhase || 0) * 2) * 0.014 * walkAmt * 0.2;

    const targetY = (a.entity.floor_y || 0) + a.view_height + bob;
    this.eyeY += (targetY - this.eyeY) * Math.min(1, dt * 6);

    this.apply(false);
  }
}
