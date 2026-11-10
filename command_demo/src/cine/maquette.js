/**
 * 「建筑沙盘」皮肤：把夜里的低模城改成一件摄影棚里的实体模型。
 *
 * 不做写实，只做材质与颜色的统一：
 *   米白的墙、鼠尾草绿的地、暖灰的路、深灰的屋顶、暗蓝的玻璃。
 * 贴图全部去掉——模型看的是体块、长影和比例，不是沥青的颗粒。
 *
 * 用法：?look=maquette，只改材质，不动几何、调度与所有交互。
 */
import * as THREE from "three";
import PACKAGE from "../map/data/map_package.json";

/* 合并后的材质名是 merged:<slug>，按材质原名给色最稳 */
const BY_SLUG = {
  grass: [0x6d855a, 1.0, 0.0],
  asphalt: [0x8d8a80, 1.0, 0.0],
  paving: [0xc9c2b0, 0.95, 0.0],
  concrete_floor: [0xcfc7b6, 0.95, 0.0],
  concrete_wall: [0xefe8d9, 0.92, 0.0],
  brick: [0xe7d8c4, 0.95, 0.0],
  facade: [0xeae3d4, 0.9, 0.0],
  glass: [0x5f7280, 0.12, 0.05],
  water: [0x6f9db4, 0.28, 0.02],
  metal: [0x9a9c9c, 0.55, 0.35],
  wood: [0x9e7c58, 0.9, 0.0],
  rock: [0xb3ada0, 1.0, 0.0],
  tiles: [0xc9c4b8, 0.9, 0.0],
  tactile: [0xc7a96b, 0.9, 0.0],
};

/* 没有材质名的纯色面：按夜里的颜色认 */
const BY_COLOR = {
  "101812": [0xd9d3c4, 1.0, 0.0],
  "14200f": [0x8ea36f, 1.0, 0.0],
  "16231a": [0x9cae7c, 1.0, 0.0],
  "2a3b22": [0x9cae7c, 1.0, 0.0],
  "0b100c": [0x8ea36f, 1.0, 0.0],
  "1a1e23": [0x8d8a80, 1.0, 0.0],
  "0a1a24": [0x6f9db4, 0.3, 0.02],
  "24262a": [0xc9c2b0, 0.95, 0.0],
  "1d1210": [0xc2a488, 1.0, 0.0],
  "8d8a80": [0xbdb6a8, 0.9, 0.0],
  "5e625f": [0xb8b2a6, 0.95, 0.0],
};

function paint(m, hex, rough, metal) {
  m.color.setHex(hex);
  m.roughness = rough;
  m.metalness = metal;
  m.envMapIntensity = 0.55;
  if (m.emissive) {
    m.emissive.setHex(0x000000);
    m.emissiveIntensity = 0;
  }
  /* 沙盘不要夜景贴图：干净体块 + 长影更像模型 */
  for (const k of ["map", "normalMap", "roughnessMap", "aoMap"]) {
    if (m[k]) m[k] = null;
  }
  m.needsUpdate = true;
}

/* 小区在地块外，夜里靠远处的草地兜底；沙盘上要给它一块自己的绿地 */
function site_plate(root, poly, color, y) {
  if (!poly || poly.length < 3) return;
  const W = PACKAGE.image.width;
  const H = PACKAGE.image.height;
  const MPP = PACKAGE.scale.meters_per_px;
  const shape = new THREE.Shape();
  poly.forEach(([px, py], i) => {
    const x = (px - W / 2) * MPP;
    const z = -(py - H / 2) * MPP;
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color, roughness: 1.0, envMapIntensity: 0.18, side: THREE.DoubleSide })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  root.add(mesh);
}

export function maquette_palette(root) {
  /* 远景城郊不属于这座模型，整组收掉 */
  root.getObjectByName("distant_town")?.removeFromParent();

  root.traverse((o) => {
    /* 火点是演示的主角，沙盘里保留它的橙光与脉冲环 */
    for (let p = o; p; p = p.parent) {
      if (p.name === "wildfire") return;
      if (p === root) break;
    }
    /* 夜里挂的灯晕、城市灯点、远景窗光，白天都不该出现 */
    if (o.isSprite && o.material?.blending === THREE.AdditiveBlending) {
      o.visible = false;
      return;
    }
    if (o.isPoints && o.name === "town_windows") {
      o.visible = false;
      return;
    }
    if (!o.isMesh || !o.material) return;

    /* 材质是全局缓存（pbr() 会复用），直接改会把夜里的材质也一起洗掉。
       每个网格克隆一份再改，切回夜景/地铁时原始材质还在。 */
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = src.map((m) =>
      m && !m.isSpriteMaterial && !m.isPointsMaterial && !m.isShaderMaterial ? m.clone() : m
    );
    o.material = Array.isArray(o.material) ? cloned : cloned[0];

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.isSpriteMaterial || m.isPointsMaterial || m.isShaderMaterial) continue;

      const slug = (m.name || "").replace(/^merged:/, "").split(":")[0];
      let p = BY_SLUG[slug];
      if (!p) p = BY_COLOR[m.color?.getHexString?.()];

      if (!p && m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.06) {
        /* 窗光、灯头：白天是暗玻璃 / 深色金属 */
        p = [0x5f7280, 0.2, 0.05];
      }
      if (!p && m.color) {
        const { r, g, b } = m.color;
        if (g > r * 1.15 && g > b * 1.08 && g > 0.08) p = [0x7f9a63, 0.95, 0.0]; /* 树冠 */
        else if (r > 0.5 && g > 0.45 && b > 0.35) p = [0xece5d7, 0.9, 0.0]; /* 米白 */
        else if (Math.max(r, g, b) < 0.22) p = [0x9a978f, 0.9, 0.0]; /* 深色金属 */
      }
      if (!p) {
        /* 校园底盘用的是整张地图贴图（带等高线/hatch），夜里看不出来，
           白天会变成一层脏条纹；没有对应材质的贴图面统一按草地处理。 */
        if (!m.map) continue;
        p = [0x93a179, 1.0, 0.0];
      }
      paint(m, p[0], p[1], p[2]);
    }
  });

  /* 合并后的网格可能又带回了贴图（UV 图集），统一再剥一遍；
     沙盘不需要任何贴图，干净体块 + 长影才是模型语言。 */
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (m && m.map) {
        m.map = null;
        m.needsUpdate = true;
      }
    }
  });

  /* 火点：加色火焰在浅色沙盘上几乎看不见，改成一块醒目的红色热区 */
  const fire = root.getObjectByName("wildfire");
  if (fire) {
    fire.traverse((o) => {
      if (o.isSprite) o.visible = false;
      if (o.isMesh && o.material?.color) {
        const hex = o.material.color.getHexString();
        if (hex === "120b08") o.material.color.setHex(0x3a1c12);
      }
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(42, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff5a2a, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.2;
    fire.add(disc);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(44, 48, 72),
      new THREE.MeshBasicMaterial({
        color: 0xff3b1f, transparent: true, opacity: 0.9,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.22;
    fire.add(rim);
  }

  /* 校界轮廓：白天做成一条细的测绘线 */
  root.traverse((o) => {
    if (!o.isLine) return;
    if (o.material?.color) o.material.color.setHex(0x2fa8bd);
    if (o.material) o.material.opacity = 0.72;
  });
}
