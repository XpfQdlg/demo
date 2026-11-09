import * as THREE from "three";

/* ══════════════════════════════════════════════════════════════════════════
   ThirdPersonRig — 第三人称跟随镜头

   镜头位于执行体身后上方，朝向执行体前方并略低于其头部，
   机器本体保持可见，可以同时看到它与前方场景。

   参数随设备类型区分：机器狗体型低，镜头贴得近一些；人形体型高，镜头拉远。
   位置用指数平滑追随，转向时镜头会晚一拍跟上，观感比硬跟更自然。
   ══════════════════════════════════════════════════════════════════════════ */

const FOLLOW = {
  dog: { dist: 6.2, height: 3.0, look_h: 0.4, fov: 64 },
  humanoid: { dist: 7.0, height: 3.4, look_h: 1.1, fov: 62 },
};

export class ThirdPersonRig {
  constructor(engine) {
    this.engine = engine;
    this.agent = null;
    this.cfg = FOLLOW.dog;
    this.look = new THREE.Vector3();
    this.want = new THREE.Vector3();
  }

  attach(agent) {
    if (this.agent && this.agent !== agent) {
      this.agent.entity.setFirstPerson?.(false);
    }
    this.agent = agent;
    if (!agent) return;

    agent.entity.setFirstPerson?.(false);
    /* 第三人称下头部锁正前方，避免头部偏航让镜头看到的是机器的正面 */
    agent.entity.lookAtPoint?.(null);
    this.cfg = FOLLOW[agent.type] || FOLLOW.dog;
    this.engine.setFov(this.cfg.fov);
    this.apply(true);
  }

  detach() {
    if (this.agent) this.agent.entity.setFirstPerson?.(false);
    this.agent = null;
  }

  /** 计算理想镜头位置与注视点 */
  target_pose() {
    const e = this.agent.entity;
    const h = e.heading;
    /* 实体前向为 +Z，移动时 x += sin(h)·v，z += cos(h)·v，所以身后方向是 (-sin h, -cos h) */
    const bx = -Math.sin(h);
    const bz = -Math.cos(h);
    const px = e.position.x;
    const pz = e.position.z;

    this.want.set(px + bx * this.cfg.dist, this.cfg.height, pz + bz * this.cfg.dist);

    /* 注视点落在机器前方一小段，让画面重心在机器与前路之间 */
    this.look.set(px + Math.sin(h) * 2.0, this.cfg.look_h, pz + Math.cos(h) * 2.0);
  }

  apply(snap = false) {
    if (!this.agent) return;
    this.target_pose();
    const cam = this.engine.camera;
    if (snap) cam.position.copy(this.want);
    else cam.position.lerp(this.want, 0.5);
    cam.lookAt(this.look);
    if (snap) cam.updateMatrixWorld();
  }

  update(dt) {
    if (!this.agent) return;
    this.target_pose();
    const k = 1 - Math.exp(-dt * 5.5);
    const cam = this.engine.camera;
    cam.position.lerp(this.want, k);
    cam.lookAt(this.look);
  }
}
