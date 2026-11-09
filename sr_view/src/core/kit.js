import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import {
  grassTex,
  dirtTex,
  asphaltTex,
  concreteTex,
  tileTex,
  facadeTex,
  foliageTex,
  barkTex,
  metalTex,
  stripeTex,
  glowTex,
  flameTex,
  smokeTex,
  waterTex,
  signTex,
  gaugeTex,
  woodTex,
  tiled,
  mulberry32,
  normalFrom,
  roughFrom,
} from "./tex.js";

/* ══════════════════════════════════════════════════════════════════════════
   Shared material library — created once, reused by every scene.
   ══════════════════════════════════════════════════════════════════════════ */
const M = {};
const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);

/**
 * Physical surface: colour map + derived normal map (matching repeat) +
 * optional derived roughness map. `bump` is the normal strength (1 = subtle,
 * 4 = heavily textured), `env` scales image-based reflections.
 */
function surf(map, { bump = 1.6, rough = 0.9, metal = 0.02, env = 0.75, roughMap = null, ...rest } = {}) {
  const m = std({ map, roughness: rough, metalness: metal, ...rest });
  if (bump > 0) {
    const nm = normalFrom(map, 2.6);
    if (nm) {
      const t = nm.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      t.repeat.copy(map.repeat);
      m.normalMap = t;
      m.normalScale = new THREE.Vector2(bump, bump);
    }
  }
  if (roughMap) {
    const rm = roughFrom(map, roughMap[0], roughMap[1]);
    if (rm) {
      const t = rm.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      t.repeat.copy(map.repeat);
      m.roughnessMap = t;
      m.roughness = 1;
    }
  }
  m.envMapIntensity = env;
  return m;
}

M.concrete = surf(tiled(concreteTex("#9a9ea3", "#7c8085"), 2, 2), { bump: 1.1, rough: 0.86, metal: 0.03, env: 0.7, roughMap: [0.7, 1.0] });
M.asphalt = surf(tiled(asphaltTex(), 6, 6), { bump: 1.5, rough: 0.93, metal: 0.02, env: 0.55, roughMap: [0.75, 1.0] });
M.grass = surf(tiled(grassTex(), 4, 4), { bump: 1.8, rough: 1, metal: 0, env: 0.45 });
M.dirt = surf(tiled(dirtTex(), 4, 4), { bump: 2.2, rough: 1, metal: 0, env: 0.4 });
M.tile = surf(tiled(tileTex("#cdd2d7", "#9ba1a9", 2), 8, 8), {
  bump: 1.0,
  rough: 0.3,
  metal: 0.12,
  env: 1.15,
  roughMap: [0.18, 0.55],
});
M.tileDark = surf(tiled(tileTex("#8f959c", "#6b7178", 4), 6, 6), {
  bump: 1.0,
  rough: 0.34,
  metal: 0.12,
  env: 1.05,
  roughMap: [0.22, 0.6],
});
M.bark = surf(tiled(barkTex(), 1, 2), { bump: 2.6, rough: 0.95, env: 0.5 });
M.wood = surf(woodTex(), { bump: 1.6, rough: 0.82, env: 0.6, roughMap: [0.55, 0.9] });
M.metal = surf(tiled(metalTex("#6a727c"), 1, 1), { bump: 0.55, rough: 0.36, metal: 0.86, env: 1.25 });
M.darkMetal = surf(tiled(metalTex("#3b4149"), 1, 1), { bump: 0.55, rough: 0.42, metal: 0.9, env: 1.25 });
M.paintRed = phys({ color: 0xb3261e, roughness: 0.42, metalness: 0.2, clearcoat: 0.55, clearcoatRoughness: 0.3, envMapIntensity: 1 });
M.paintWhite = phys({ color: 0xe9ecef, roughness: 0.55, metalness: 0.08, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 0.9 });
M.paintYellow = phys({ color: 0xf2b32e, roughness: 0.5, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1 });
M.stripe = surf(tiled(stripeTex("#e9c33a", "#22252a"), 3, 1), { bump: 0.5, rough: 0.62, env: 0.7 });
M.rubber = std({ color: 0x1c1f23, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.35 });
M.glass = phys({
  color: 0xa8d8ea,
  roughness: 0.04,
  metalness: 0.1,
  transparent: true,
  opacity: 0.3,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 2.2,
  side: THREE.DoubleSide,
});
M.leaf = surf(tiled(foliageTex("#4d7a34", "#2c4a1d", "#7fae4e"), 2, 2), {
  bump: 2.6,
  rough: 0.86,
  metal: 0,
  env: 0.45,
  flatShading: true,
  color: 0xdfe8d4,
});
M.leafDeep = surf(tiled(foliageTex("#3a6127", "#22391a", "#5f8f42"), 2, 2), {
  bump: 2.6,
  rough: 0.9,
  metal: 0,
  env: 0.4,
  flatShading: true,
  color: 0xd3dcc8,
});
M.leafDry = surf(tiled(foliageTex("#8a7530", "#5b4a1c", "#b39a4a"), 2, 2), {
  bump: 2.4,
  rough: 0.92,
  metal: 0,
  env: 0.35,
  flatShading: true,
  color: 0xe4dcc4,
});
M.blue = phys({ color: 0x2b5fa8, roughness: 0.45, metalness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 1 });
M.green = std({ color: 0x2c7a4b, roughness: 0.55, envMapIntensity: 0.7 });
M.plastic = phys({ color: 0xdfe3e7, roughness: 0.5, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.9 });
M.water = phys({
  map: tiled(waterTex(), 2, 2),
  color: 0x9fd4e6,
  roughness: 0.03,
  metalness: 0.12,
  transparent: true,
  opacity: 0.82,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  envMapIntensity: 2.6,
});
M.fabricRed = std({ color: 0xa8342c, roughness: 0.92, envMapIntensity: 0.4 });
M.fabricBlue = std({ color: 0x2f4e7a, roughness: 0.92, envMapIntensity: 0.4 });
M.fabricGrey = std({ color: 0x4a5058, roughness: 0.92, envMapIntensity: 0.4 });
M.hazard = std({ color: 0xe8b81c, roughness: 0.5, emissive: 0x000000, envMapIntensity: 0.8 });

/* ══════════════════════════════════════════════════════════════════════════
   small geometry helpers
   ══════════════════════════════════════════════════════════════════════════ */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 20, 14),
  ballLow: new THREE.IcosahedronGeometry(1, 0),
  ballMid: new THREE.IcosahedronGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 20),
  plane: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.86, 1, 40),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 32),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 12),
};

export function mesh(geo, mat, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export const box = (w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) => mesh(G.box, mat, { x, y, z, sx: w, sy: h, sz: d, ry });
export const cyl = (r, h, mat, x = 0, y = 0, z = 0, seg = 20) =>
  new THREE.Mesh(seg === 8 ? G.cyl8 : G.cyl, mat) && mesh(seg === 8 ? G.cyl8 : G.cyl, mat, { x, y, z, sx: r, sy: h, sz: r });
export const ball = (r, mat, x = 0, y = 0, z = 0) => mesh(G.sphere, mat, { x, y, z, sx: r, sy: r, sz: r });

export function rounded(w, h, d, mat, r = 0.04) {
  const g = new RoundedBoxGeometry(w, h, d, 3, r);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function group(x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   tick registry — props animate themselves without a scene-wide traversal
   ══════════════════════════════════════════════════════════════════════════ */
export const tickers = new Set();
export const addTick = (fn) => (tickers.add(fn), fn);
export function clearTicks() {
  tickers.clear();
}

/* ══════════════════════════════════════════════════════════════════════════
   ground
   ══════════════════════════════════════════════════════════════════════════ */
export function ground(parent, mat, size = 60, tileSize = 3) {
  let m = mat;
  if (mat.map) {
    m = mat.clone();
    m.map = mat.map.clone();
    m.map.needsUpdate = true;
    m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
    m.map.repeat.set(size / tileSize, size / tileSize);
    if (mat.normalMap) {
      m.normalMap = mat.normalMap.clone();
      m.normalMap.needsUpdate = true;
      m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping;
      m.normalMap.repeat.copy(m.map.repeat);
    }
    if (mat.roughnessMap) {
      m.roughnessMap = mat.roughnessMap.clone();
      m.roughnessMap.needsUpdate = true;
      m.roughnessMap.wrapS = m.roughnessMap.wrapT = THREE.RepeatWrapping;
      m.roughnessMap.repeat.copy(m.map.repeat);
    }
  }
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  parent.add(g);
  return g;
}

/** flat decal patch (puddle, stain, crack) that hugs the ground */
export function decal(parent, tex, x, z, w, h, opacity = 1, color = 0xffffff) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    opacity,
    color,
    roughness: 0.25,
    metalness: 0.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const m = new THREE.Mesh(G.plane, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  m.scale.set(w, h, 1);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════
   sky dome — soft vertical gradient, unaffected by fog
   ══════════════════════════════════════════════════════════════════════════ */
export function skyDome(top = 0x5b83a6, bottom = 0xd6e2ea, radius = 150) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topC: { value: new THREE.Color(top) },
      botC: { value: new THREE.Color(bottom) },
      off: { value: 0.18 },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 topC; uniform vec3 botC; uniform float off; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        float k = clamp((h + off) / (1.0 + off), 0.0, 1.0);
        gl_FragColor = vec4(mix(botC, topC, pow(k, 0.8)), 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), mat);
  m.userData.sharedMat = true;
  return m;
}

/** dust / pollen motes drifting in the air */
export function motes({ n = 420, range = 22, height = 6, color = 0xffffff, size = 0.045 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * range;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * range;
    seed[i] = Math.random() * 6.28;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    map: glowTex(),
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  addTick((t) => {
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      a[i * 3 + 1] += 0.0035 + Math.sin(t + seed[i]) * 0.0012;
      a[i * 3] += Math.sin(t * 0.3 + seed[i]) * 0.0016;
      if (a[i * 3 + 1] > height) a[i * 3 + 1] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return pts;
}

/* ══════════════════════════════════════════════════════════════════════════
   nature
   ══════════════════════════════════════════════════════════════════════════ */
export function tree({ h = 6, r = 0.16, kind = "broad", dry = false } = {}) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(r * 0.62, r, h, 8), M.bark, { y: h / 2 });
  g.add(trunk);
  // a couple of branches
  for (let i = 0; i < 2; i++) {
    const b = mesh(G.cyl8, M.bark, {
      y: h * (0.62 + i * 0.14),
      sx: r * 0.34,
      sy: h * 0.3,
      sz: r * 0.34,
      rz: (i === 0 ? 1 : -1) * 0.55,
    });
    b.position.x = (i === 0 ? 1 : -1) * 0.18;
    g.add(b);
  }
  const leafMat = dry ? M.leafDry : Math.random() > 0.5 ? M.leaf : M.leafDeep;
  if (kind === "broad") {
    const blobs = 4;
    for (let i = 0; i < blobs; i++) {
      const rr = 0.9 + Math.random() * 0.7;
      const b = mesh(G.ballMid, leafMat, {
        x: (Math.random() - 0.5) * 1.5,
        y: h * 0.85 + (Math.random() - 0.3) * 1.1,
        z: (Math.random() - 0.5) * 1.5,
        sx: rr * 1.5,
        sy: rr,
        sz: rr * 1.5,
      });
      g.add(b);
    }
  } else {
    // conifer: stacked cones
    for (let i = 0; i < 4; i++) {
      const rr = 1.5 - i * 0.3;
      const c = mesh(G.cone, leafMat, { y: h * 0.5 + i * h * 0.14, sx: rr, sy: h * 0.28, sz: rr });
      g.add(c);
    }
  }
  g.userData.kind = "tree";
  return g;
}

export function bush(r = 0.7, mat = M.leaf) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    g.add(
      mesh(G.ballLow, mat, {
        x: (Math.random() - 0.5) * r * 1.4,
        y: r * (0.35 + Math.random() * 0.3),
        z: (Math.random() - 0.5) * r * 1.4,
        sx: r * (0.7 + Math.random() * 0.5),
        sy: r * (0.5 + Math.random() * 0.4),
        sz: r * (0.7 + Math.random() * 0.5),
      })
    );
  }
  return g;
}

export function grassTuft(n = 6) {
  const g = new THREE.Group();
  const mat = std({ color: 0x6f9c47, roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const b = mesh(G.plane, mat, {
      x: (Math.random() - 0.5) * 0.5,
      y: 0.12,
      z: (Math.random() - 0.5) * 0.5,
      sx: 0.12,
      sy: 0.26,
      rz: (Math.random() - 0.5) * 0.5,
      ry: Math.random() * 3,
      shadow: false,
    });
    g.add(b);
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   people
   ══════════════════════════════════════════════════════════════════════════ */
const SKIN = [0xe8b48c, 0xd9a273, 0xc98d63, 0xf0c6a0];
const SHIRT = [0x3b5b8c, 0x8c3b3b, 0x2f6b52, 0x63636b, 0xb0b4b9, 0x2b2f36, 0xcfa13c];

export function person({ shirt, pants = 0x2b3138, hat = null, tall = 1, walk = false } = {}) {
  const g = new THREE.Group();
  const sh = std({ color: shirt ?? SHIRT[(Math.random() * SHIRT.length) | 0], roughness: 0.85 });
  const pa = std({ color: pants, roughness: 0.9 });
  const sk = std({ color: SKIN[(Math.random() * SKIN.length) | 0], roughness: 0.75 });

  const legs = new THREE.Group();
  /* 腿比原来粗一圈，并且配深色鞋。
     原来 0.15 × 0.17 的细腿在铺装地面上几乎看不见，
     远看就像只有上半身在飘；加鞋之后脚底有落点，人也站得住了 */
  const l1 = mesh(new THREE.BoxGeometry(0.17, 0.78, 0.2), pa, { x: -0.105, y: 0.39 });
  const l2 = l1.clone();
  l2.position.x = 0.105;
  legs.add(l1, l2);

  const shoeMat = std({ color: 0x232529, roughness: 0.95 });
  for (const sx of [-0.105, 0.105]) {
    const s = mesh(new THREE.BoxGeometry(0.19, 0.09, 0.28), shoeMat, { x: sx, y: 0.045, z: 0.03 });
    legs.add(s);
  }
  g.add(legs);

  const torso = rounded(0.4, 0.62, 0.24, sh, 0.09);
  torso.position.y = 1.2;
  g.add(torso);

  const arms = new THREE.Group();
  const a1 = rounded(0.12, 0.58, 0.13, sh, 0.05);
  a1.position.set(-0.25, 1.15, 0);
  const a2 = a1.clone();
  a2.position.x = 0.25;
  arms.add(a1, a2);
  g.add(arms);

  const head = ball(0.115, sk, 0, 1.66, 0);
  g.add(head);
  const hair = mesh(G.sphere, std({ color: 0x1c1a19, roughness: 0.9 }), { y: 1.69, sx: 0.12, sy: 0.1, sz: 0.12 });
  g.add(hair);

  if (hat === "helmet") {
    const h = mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.paintYellow, { y: 1.72 });
    g.add(h);
    g.add(mesh(G.cyl, M.paintYellow, { y: 1.7, sx: 0.2, sy: 0.02, sz: 0.2 }));
  } else if (hat === "cap") {
    g.add(mesh(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x24354d, roughness: 0.9 }), { y: 1.72 }));
  }

  if (walk || Math.random() > 0.5) {
    const ph = Math.random() * 6.28;
    addTick((t) => {
      legs.children[0].rotation.x = Math.sin(t * 2.2 + ph) * 0.32;
      legs.children[1].rotation.x = -Math.sin(t * 2.2 + ph) * 0.32;
      arms.children[0].rotation.x = -Math.sin(t * 2.2 + ph) * 0.24;
      arms.children[1].rotation.x = Math.sin(t * 2.2 + ph) * 0.24;
    });
  } else {
    addTick((t) => {
      const b = Math.sin(t * 1.1 + g.id) * 0.008;
      g.position.y = b;
    });
  }
  g.scale.setScalar(tall);
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   architecture
   ══════════════════════════════════════════════════════════════════════════ */
export function building({ w = 12, h = 22, d = 10, wall = "#b8bec5", win = "#2f4152", cols = 5, rows = 7, lit = 0.14, roof = true } = {}) {
  const g = new THREE.Group();
  const tex = facadeTex(wall, win, cols, rows, lit);
  const sideMat = std({ map: tex, roughness: 0.8, metalness: 0.05 });
  const topMat = std({ color: new THREE.Color(wall).multiplyScalar(0.7), roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideMat, sideMat, topMat, topMat, sideMat, sideMat]);
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  if (roof) {
    g.add(box(w + 0.5, 0.35, d + 0.5, std({ color: 0x6e747c, roughness: 0.9 }), 0, h + 0.15, 0));
    // roof clutter
    g.add(box(w * 0.2, 0.9, d * 0.2, M.darkMetal, w * 0.22, h + 0.75, -d * 0.2));
  }
  g.userData.kind = "building";
  return g;
}

export function streetLamp({ h = 5, on = true } = {}) {
  const g = new THREE.Group();
  const poleMat = std({ color: 0x2f353d, roughness: 0.42, metalness: 0.8 });
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, h, 10), poleMat, { y: h / 2 }));
  const arm = mesh(G.cyl8, poleMat, { y: h - 0.1, sx: 0.05, sy: 1.1, sz: 0.05, rz: Math.PI / 2, x: 0.5 });
  g.add(arm);
  const headMat = std({ color: 0x2a2f35, roughness: 0.5, metalness: 0.6 });
  const head = mesh(G.box, headMat, { x: 1.02, y: h - 0.18, sx: 0.62, sy: 0.12, sz: 0.3 });
  g.add(head);
  const lampMat = std({
    color: 0xfff4d6,
    emissive: new THREE.Color(on ? 0xffd88a : 0x333026),
    emissiveIntensity: on ? 2.2 : 0.05,
  });
  g.add(mesh(G.box, lampMat, { x: 1.02, y: h - 0.26, sx: 0.5, sy: 0.05, sz: 0.22, shadow: false }));
  if (on) {
    const pl = new THREE.PointLight(0xffd9a0, 12, 14, 2);
    pl.position.set(1.02, h - 0.5, 0);
    g.add(pl);
  }
  g.userData.lampMat = lampMat;
  return g;
}

export function fence(len = 3, h = 1.1) {
  const g = new THREE.Group();
  const postMat = std({ color: 0x59606a, roughness: 0.5, metalness: 0.7 });
  const n = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    g.add(mesh(G.cyl8, postMat, { x: -len / 2 + (i * len) / n, y: h / 2, sx: 0.045, sy: h, sz: 0.045 }));
  }
  for (let i = 0; i < 2; i++) {
    g.add(box(len, 0.035, 0.035, postMat, 0, h * (0.35 + i * 0.45), 0));
  }
  return g;
}

export function wallRun(len, h, mat = std({ color: 0xb6b2a8, roughness: 0.95 }), thick = 0.2) {
  const g = new THREE.Group();
  g.add(box(len, h, thick, mat, 0, h / 2, 0));
  g.add(box(len, 0.1, thick + 0.12, std({ color: 0x8d8981, roughness: 0.9 }), 0, h + 0.05, 0));
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   vehicles / mobility
   ══════════════════════════════════════════════════════════════════════════ */
export function car({ color = 0xb9bec4, type = "sedan", ry = 0 } = {}) {
  const g = new THREE.Group();
  const bodyMat = std({ color, roughness: 0.35, metalness: 0.6, clearcoat: 1 });
  if (type === "van") {
    const b = rounded(4.6, 1.9, 1.9, bodyMat, 0.16);
    b.position.y = 1.15;
    g.add(b);
    g.add(box(2.2, 0.9, 1.92, M.glass, 0.6, 1.75, 0));
  } else {
    const b = rounded(4.3, 0.78, 1.85, bodyMat, 0.16);
    b.position.y = 0.72;
    g.add(b);
    const cabin = rounded(2.1, 0.72, 1.66, M.glass, 0.1);
    cabin.position.set(-0.1, 1.36, 0);
    g.add(cabin);
    g.add(box(2.0, 0.1, 1.6, bodyMat, -0.1, 1.7, 0));
  }
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  const wm = M.rubber;
  for (const [x, z] of [
    [1.35, 0.86],
    [1.35, -0.86],
    [-1.35, 0.86],
    [-1.35, -0.86],
  ]) {
    const w = new THREE.Mesh(wheel, wm);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.34, z);
    w.castShadow = true;
    g.add(w);
  }
  // lights
  g.add(mesh(G.box, std({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.7, roughness: 0.3 }), { x: 2.12, y: 0.85, z: 0.6, sx: 0.06, sy: 0.18, sz: 0.36 }));
  g.add(mesh(G.box, std({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.7, roughness: 0.3 }), { x: 2.12, y: 0.85, z: -0.6, sx: 0.06, sy: 0.18, sz: 0.36 }));
  g.add(mesh(G.box, std({ color: 0xd02c2c, emissive: 0x9b1414, emissiveIntensity: 0.6, roughness: 0.3 }), { x: -2.12, y: 0.85, z: 0.62, sx: 0.06, sy: 0.16, sz: 0.34 }));
  g.add(mesh(G.box, std({ color: 0xd02c2c, emissive: 0x9b1414, emissiveIntensity: 0.6, roughness: 0.3 }), { x: -2.12, y: 0.85, z: -0.62, sx: 0.06, sy: 0.16, sz: 0.34 }));
  g.rotation.y = ry;
  return g;
}

export function scooter({ color = 0x2f6f92 } = {}) {
  const g = new THREE.Group();
  const bodyMat = std({ color, roughness: 0.4, metalness: 0.35 });
  g.add(rounded(1.15, 0.34, 0.42, bodyMat, 0.1).translateY(0.62));
  const wheelG = new THREE.CylinderGeometry(0.24, 0.24, 0.09, 14);
  for (const x of [0.55, -0.55]) {
    const w = new THREE.Mesh(wheelG, M.rubber);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.24, 0);
    w.castShadow = true;
    g.add(w);
  }
  g.add(box(0.1, 0.5, 0.1, M.darkMetal, 0.5, 0.9, 0));
  g.add(box(0.42, 0.06, 0.06, M.darkMetal, 0.5, 1.12, 0));
  const seat = rounded(0.5, 0.12, 0.3, std({ color: 0x22262b, roughness: 0.9 }), 0.05);
  seat.position.set(-0.28, 0.86, 0);
  g.add(seat);
  return g;
}

export function ebike(color = 0x2f3a44) {
  const g = new THREE.Group();
  const body = std({ color, roughness: 0.45, metalness: 0.35 });
  const tyre = new THREE.TorusGeometry(0.25, 0.055, 8, 20);
  for (const x of [0.52, -0.52]) {
    const w = new THREE.Mesh(tyre, M.rubber);
    w.rotation.y = Math.PI / 2;
    w.position.set(x, 0.27, 0);
    w.castShadow = true;
    g.add(w);
    g.add(mesh(G.cyl, M.metal, { x, y: 0.27, sx: 0.05, sy: 0.05, sz: 0.05, rx: Math.PI / 2 }));
  }
  // 踏板 / 电池仓
  g.add(box(0.52, 0.1, 0.24, body, 0.03, 0.34, 0));
  g.add(rounded(0.5, 0.26, 0.24, body, 0.06).translateY(0.52));
  // 座垫
  g.add(mesh(G.sphere, std({ color: 0x191d22, roughness: 0.8 }), { x: -0.3, y: 0.72, sx: 0.17, sy: 0.055, sz: 0.1 }));
  // 车把立管 + 车把
  const stem = box(0.06, 0.62, 0.06, body, 0.44, 0.66, 0);
  stem.rotation.z = -0.16;
  g.add(stem);
  g.add(box(0.05, 0.05, 0.46, M.darkMetal, 0.5, 0.96, 0));
  // 前车筐
  g.add(box(0.3, 0.19, 0.26, std({ color: 0x252b31, roughness: 0.85 }), 0.46, 0.86, 0));
  // 前叉
  const fork = box(0.05, 0.4, 0.05, M.metal, 0.5, 0.44, 0);
  fork.rotation.z = -0.2;
  g.add(fork);
  // 支脚
  const stand = box(0.04, 0.34, 0.04, M.metal, -0.34, 0.17, 0.12);
  stand.rotation.x = 0.4;
  g.add(stand);
  g.userData.kind = "ebike";
  return g;
}

export function cone(h = 0.62) {
  const g = new THREE.Group();
  g.add(mesh(G.box, M.rubber, { y: 0.02, sx: 0.36, sy: 0.04, sz: 0.36 }));
  g.add(mesh(G.cone, std({ color: 0xe2622a, roughness: 0.7 }), { y: h / 2 + 0.04, sx: 0.17, sy: h, sz: 0.17 }));
  g.add(mesh(G.cone, std({ color: 0xf2f4f6, roughness: 0.6 }), { y: h * 0.62, sx: 0.115, sy: h * 0.22, sz: 0.115 }));
  return g;
}

export function barrier(w = 2.0, h = 1.0) {
  const g = new THREE.Group();
  g.add(box(w, 0.26, 0.08, std({ color: 0xe9c33a, roughness: 0.6 }), 0, h - 0.2, 0));
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) {
    g.add(box(0.08, h, 0.08, M.metal, x, h / 2, 0));
    g.add(box(0.5, 0.06, 0.5, M.metal, x, 0.03, 0));
  }
  g.add(mesh(G.plane, std({ map: stripeTex("#e9c33a", "#1e2126"), side: THREE.DoubleSide, roughness: 0.6 }), { y: h - 0.2, z: 0.045, sx: w, sy: 0.26 }));
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   street furniture
   ══════════════════════════════════════════════════════════════════════════ */
export function trashBin({ h = 0.95, full = false } = {}) {
  const g = new THREE.Group();
  const mat = std({ color: 0x3d6b4f, roughness: 0.7, metalness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.26, h, 14), mat, { y: h / 2 }));
  g.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 14), M.darkMetal, { y: h + 0.02 }));
  if (full) {
    for (let i = 0; i < 7; i++) {
      const junk = box(0.1 + Math.random() * 0.14, 0.09, 0.1 + Math.random() * 0.14, std({ color: [0xc9b48a, 0xa8b0b8, 0x6f8fb0][i % 3], roughness: 0.9 }), (Math.random() - 0.5) * 0.35, h + 0.1 + Math.random() * 0.14, (Math.random() - 0.5) * 0.35);
      junk.rotation.y = Math.random() * 3;
      g.add(junk);
    }
  }
  g.userData.kind = "bin";
  return g;
}

export function bench() {
  const g = new THREE.Group();
  const wood = std({ map: tiled(woodTex(), 2, 1), roughness: 0.8 });
  for (let i = 0; i < 3; i++) g.add(box(1.7, 0.06, 0.14, wood, 0, 0.45, -0.18 + i * 0.18));
  for (let i = 0; i < 2; i++) g.add(box(1.7, 0.12, 0.05, wood, 0, 0.62 + i * 0.16, 0.26));
  for (const x of [-0.72, 0.72]) {
    g.add(box(0.06, 0.45, 0.5, M.darkMetal, x, 0.22, 0));
    g.add(box(0.06, 0.5, 0.06, M.darkMetal, x, 0.65, 0.26));
  }
  return g;
}

export function hydrant() {
  const g = new THREE.Group();
  const mat = std({ color: 0xc0392b, roughness: 0.45, metalness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.62, 12), mat, { y: 0.31 }));
  g.add(mesh(G.sphere, mat, { y: 0.66, sx: 0.14, sy: 0.14, sz: 0.14 }));
  g.add(mesh(G.cyl8, mat, { y: 0.5, sx: 0.05, sy: 0.34, sz: 0.05, rz: Math.PI / 2 }));
  for (const s of [-1, 1]) g.add(mesh(G.cyl8, mat, { x: s * 0.17, y: 0.45, sx: 0.045, sy: 0.1, sz: 0.045, rz: Math.PI / 2 }));
  g.add(mesh(G.cyl, M.darkMetal, { y: 0.02, sx: 0.18, sy: 0.06, sz: 0.18 }));
  g.userData.kind = "hydrant";
  return g;
}

export function extinguisher() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 16), M.paintRed, { y: 0.27 }));
  g.add(mesh(G.sphere, M.paintRed, { y: 0.52, sx: 0.11, sy: 0.08, sz: 0.11 }));
  g.add(mesh(G.cyl8, M.darkMetal, { y: 0.6, sx: 0.03, sy: 0.09, sz: 0.03 }));
  g.add(box(0.12, 0.03, 0.05, std({ color: 0x1a1c1f, roughness: 0.8 }), 0.01, 0.66, 0.04));
  g.add(box(0.12, 0.16, 0.02, M.paintWhite, 0, 0.32, 0.108));
  g.userData.kind = "extinguisher";
  return g;
}

export function fireBox() {
  // wall-mounted hydrant / extinguisher cabinet
  const g = new THREE.Group();
  g.add(box(0.9, 1.0, 0.3, std({ color: 0xbf3a2e, roughness: 0.5 }), 0, 0.5, 0));
  g.add(box(0.82, 0.9, 0.02, M.glass, 0, 0.5, 0.16, 0));
  g.add(box(0.06, 1.0, 0.32, std({ color: 0x2a2f34, roughness: 0.6 }), 0.44, 0.5, 0));
  g.add(mesh(G.plane, std({ map: signTex("消火栓", { bg: "#bf3a2e", fg: "#fff", w: 256, h: 128, font: 'bold 84px "Microsoft YaHei", sans-serif' }), roughness: 0.7 }), { y: 1.14, z: 0.02, sx: 0.6, sy: 0.28 }));
  return g;
}

export function manhole({ open = false } = {}) {
  const g = new THREE.Group();
  const mat = std({ color: 0x4a4f55, roughness: 0.7, metalness: 0.6 });
  g.add(mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.05, 24), mat, { y: 0.02 }));
  const lid = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 24), mat, { y: 0.05 });
  g.add(lid);
  if (open) {
    lid.rotation.x = 0.5;
    lid.position.set(0.35, 0.22, 0);
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 24), std({ color: 0x14171a, roughness: 1 }), { y: 0.04 }));
  }
  // rim pattern
  g.add(mesh(G.torus, mat, { y: 0.06, sx: 0.42, sy: 0.42, sz: 0.42, rx: Math.PI / 2 }));
  g.userData.kind = "manhole";
  return g;
}

export function speedBump(w = 3.4) {
  const g = new THREE.Group();
  const mat = std({ map: tiled(stripeTex("#e9c33a", "#23262b"), 4, 1), roughness: 0.75 });
  const geo = new THREE.CylinderGeometry(0.12, 0.12, w, 12, 1, false, 0, Math.PI);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.z = Math.PI / 2;
  m.rotation.x = Math.PI;
  m.position.y = 0.02;
  m.scale.set(1.6, 1, 1);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return g;
}

export function bollard() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 12), M.paintYellow, { y: 0.42 }));
  g.add(mesh(G.sphere, M.paintYellow, { y: 0.86, sx: 0.075, sy: 0.075, sz: 0.075 }));
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), std({ color: 0x22262b, roughness: 0.9 }), { y: 0.62 }));
  return g;
}

export function signBoard(text, { w = 1.6, h = 0.5, bg = "#0f6b46", fg = "#fff", y = 1.9, pos = true } = {}) {
  const g = new THREE.Group();
  const mat = std({ map: signTex(text, { bg, fg, w: 512, h: Math.round((512 * h) / w) }), roughness: 0.6, metalness: 0.1 });
  g.add(mesh(G.plane, mat, { y, sx: w, sy: h }));
  g.add(box(w, h, 0.04, std({ color: 0x33383e, roughness: 0.7 }), 0, y, -0.03));
  if (pos) {
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, y, 8), M.darkMetal, { y: y / 2 }));
  }
  return g;
}

export function notice(text, { x = 0, y = 1.4, z = 0, w = 0.8, h = 0.5, bg = "#f4f6f8", fg = "#1b2430" } = {}) {
  const mat = std({ map: signTex(text, { bg, fg, w: 384, h: Math.round((384 * h) / w), font: 'bold 96px "Microsoft YaHei", sans-serif' }), roughness: 0.75 });
  const m = mesh(G.plane, mat, { x, y, z, sx: w, sy: h });
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════
   interior / subway kit
   ══════════════════════════════════════════════════════════════════════════ */
export function turnstile() {
  const g = new THREE.Group();
  g.add(box(0.5, 1.0, 1.4, std({ color: 0xd8dce1, roughness: 0.5, metalness: 0.3 }), 0, 0.5, 0));
  g.add(box(0.52, 0.06, 1.1, M.darkMetal, 0, 1.02, 0));
  g.add(mesh(G.cyl8, std({ color: 0xffffff, roughness: 0.5 }), { x: -0.3, y: 1.02, sx: 0.02, sy: 0.26, sz: 0.02, rz: Math.PI / 2 }));
  g.add(mesh(G.plane, std({ color: 0x2bd4a0, emissive: 0x18a97e, emissiveIntensity: 1.6, roughness: 0.4 }), { x: 0.26, y: 0.86, z: 0, sx: 0.16, sy: 0.1, ry: Math.PI / 2 }));
  return g;
}

export function ticketMachine() {
  const g = new THREE.Group();
  g.add(box(0.9, 1.9, 0.6, std({ color: 0xc8ccd2, roughness: 0.45, metalness: 0.35 }), 0, 0.95, 0));
  g.add(box(0.6, 0.5, 0.06, std({ color: 0x1b2b3a, emissive: 0x2c6d9b, emissiveIntensity: 0.5, roughness: 0.2 }), 0, 1.35, 0.32));
  g.add(box(0.44, 0.1, 0.08, M.darkMetal, 0, 1.0, 0.32));
  g.add(box(0.7, 0.06, 0.5, std({ color: 0x8a9099, roughness: 0.6 }), 0, 0.62, 0.22));
  g.add(mesh(G.plane, std({ map: signTex("自动售票", { bg: "#1b5fa8", fg: "#fff", w: 512, h: 160, font: 'bold 74px "Microsoft YaHei", sans-serif' }), roughness: 0.6 }), { y: 1.78, z: 0.31, sx: 0.72, sy: 0.22 }));
  return g;
}

export function luggage({ w = 0.52, h = 0.7, d = 0.32, color = 0x2b3a4a } = {}) {
  const g = new THREE.Group();
  const mat = std({ color, roughness: 0.6, metalness: 0.15 });
  g.add(rounded(w, h, d, mat, 0.05).translateY(h / 2));
  g.add(box(0.1, 0.3, 0.03, M.darkMetal, 0, h + 0.12, 0));
  for (const z of [-d / 2 - 0.01, d / 2 + 0.01]) {
    g.add(box(w * 0.7, 0.03, 0.02, std({ color: 0x8a9099, roughness: 0.5 }), 0, h * 0.66, z));
  }
  return g;
}

export function cardboard(x = 0, z = 0, s = 1) {
  const g = new THREE.Group();
  const mat = std({ color: 0xa8865a, roughness: 0.95 });
  const a = box(0.5 * s, 0.36 * s, 0.42 * s, mat, 0, 0.18 * s, 0);
  a.rotation.y = Math.random() * 0.4;
  g.add(a);
  if (s > 0.7) {
    const b = box(0.34 * s, 0.28 * s, 0.34 * s, mat, 0.06, 0.5 * s, -0.02);
    b.rotation.y = Math.random() * 0.6;
    g.add(b);
  }
  g.position.set(x, 0, z);
  return g;
}

export function fireDoor({ open = false, w = 1.0, h = 2.05 } = {}) {
  const g = new THREE.Group();
  const frame = std({ color: 0x5a4a3c, roughness: 0.8 });
  g.add(box(0.08, h, 0.12, frame, -w / 2, h / 2, 0));
  g.add(box(0.08, h, 0.12, frame, w / 2, h / 2, 0));
  g.add(box(w + 0.16, 0.1, 0.12, frame, 0, h, 0));
  const leaf = new THREE.Group();
  const panel = rounded(w - 0.06, h - 0.06, 0.05, std({ color: 0x6b4a33, roughness: 0.75 }), 0.02);
  panel.position.y = h / 2;
  leaf.add(panel);
  leaf.add(mesh(G.cyl8, M.metal, { y: 1.05, x: w * 0.32, sx: 0.03, sy: 0.1, sz: 0.03, rx: Math.PI / 2 }));
  leaf.position.x = -w / 2 + 0.03;
  leaf.rotation.y = open ? -1.15 : 0;
  g.add(leaf);
  g.userData.leaf = leaf;
  g.userData.kind = "firedoor";
  return g;
}

export function elevator({ w = 1.8, h = 2.2 } = {}) {
  const g = new THREE.Group();
  g.add(box(w + 0.3, h + 0.2, 0.16, std({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.8 }), 0, (h + 0.2) / 2, 0));
  g.add(box(w / 2 - 0.04, h, 0.06, std({ color: 0xc4cad1, roughness: 0.2, metalness: 0.9 }), -w / 4, h / 2, 0.08));
  g.add(box(w / 2 - 0.04, h, 0.06, std({ color: 0xc4cad1, roughness: 0.2, metalness: 0.9 }), w / 4, h / 2, 0.08));
  g.add(box(0.22, 0.34, 0.05, std({ color: 0x2a2f36, roughness: 0.4, emissive: 0x1e6f4e, emissiveIntensity: 0.9 }), w / 2 + 0.28, 1.2, 0.08));
  g.add(mesh(G.plane, std({ map: signTex("电梯", { bg: "#2b3138", fg: "#e6edf3", w: 256, h: 128 }), roughness: 0.5 }), { y: h + 0.55, z: 0.1, sx: 0.5, sy: 0.24 }));
  return g;
}

export function escalator({ len = 8, rise = 3.2 } = {}) {
  const g = new THREE.Group();
  const ang = Math.atan2(rise, len);
  const ramp = box(len, 0.12, 1.05, std({ color: 0x8b9199, roughness: 0.5, metalness: 0.6 }), len / 2, rise / 2, 0);
  ramp.rotation.z = ang;
  g.add(ramp);
  for (let i = 0; i < 3; i++) {
    const b = box(len, 0.02, 0.06, std({ color: 0xc9ced4, roughness: 0.5, metalness: 0.5 }), len / 2, rise / 2 + 0.08, -0.4 + i * 0.4);
    b.rotation.z = ang;
    g.add(b);
  }
  for (const z of [-0.56, 0.56]) {
    const rail = box(len, 0.05, 0.05, M.rubber, len / 2, rise / 2 + 1.0, z);
    rail.rotation.z = ang;
    g.add(rail);
    const glass = box(len, 0.9, 0.03, M.glass, len / 2, rise / 2 + 0.5, z);
    glass.rotation.z = ang;
    g.add(glass);
  }
  return g;
}

export function pipeRun(len = 6, r = 0.08, mat = M.metal, vertical = false) {
  const g = new THREE.Group();
  const p = mesh(new THREE.CylinderGeometry(r, r, len, 12), mat, vertical ? { y: len / 2 } : { rx: Math.PI / 2, z: -len / 2 });
  g.add(p);
  for (let i = 1; i < 3; i++) {
    const c = mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.07, 12), M.darkMetal, vertical ? { y: (i * len) / 3 } : { z: -len / 3 - (i - 1) * (len / 3), rx: Math.PI / 2 });
    g.add(c);
  }
  return g;
}

export function valve() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 12), M.metal, { rx: Math.PI / 2 }));
  g.add(mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 16), M.paintRed, { y: 0.14, rx: Math.PI / 2 }));
  g.add(mesh(G.cyl8, M.paintRed, { y: 0.2, sx: 0.012, sy: 0.14, sz: 0.012 }));
  return g;
}

export function gauge(kind = "pressure", r = 0.16) {
  const g = new THREE.Group();
  const face = mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ map: gaugeTex(kind), roughness: 0.4 }), { z: 0.02 });
  g.add(face);
  g.add(mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.06, 24), M.darkMetal, { rx: Math.PI / 2 }));
  const ngeo = new THREE.BoxGeometry(0.008, r * 0.72, 0.004);
  ngeo.translate(0, r * 0.36, 0);
  const needle = new THREE.Mesh(ngeo, std({ color: 0x1a1a1a, roughness: 0.5 }));
  needle.position.z = 0.035;
  g.add(needle);
  g.userData.needle = needle;
  return g;
}

export function switchPanel({ cols = 3, rows = 2 } = {}) {
  const g = new THREE.Group();
  g.add(box(cols * 0.18 + 0.16, rows * 0.18 + 0.16, 0.1, std({ color: 0xb9bec4, roughness: 0.5, metalness: 0.4 }), 0, 0, 0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isSwitch = Math.random() > 0.5;
      const x = -((cols - 1) * 0.09) + c * 0.18;
      const y = ((rows - 1) * 0.09) - r * 0.18;
      if (isSwitch) {
        g.add(box(0.05, 0.1, 0.05, std({ color: 0xe8ebee, roughness: 0.4 }), x, y, 0.06));
      } else {
        g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 14), std({ color: 0x2b2f34, roughness: 0.6 }), { x, y, z: 0.06, rx: Math.PI / 2 }));
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), std({ color: 0xe8ebee, roughness: 0.4 }), { x, y, z: 0.07, rx: Math.PI / 2 }));
      }
    }
  }
  return g;
}

export function seat() {
  const g = new THREE.Group();
  const mat = std({ color: 0x2f6f9b, roughness: 0.6 });
  g.add(rounded(1.2, 0.1, 0.42, mat, 0.04).translateY(0.46));
  g.add(rounded(1.2, 0.5, 0.1, mat, 0.04).translateY(0.72).translateZ(-0.2));
  for (const x of [-0.5, 0.5]) g.add(box(0.06, 0.46, 0.42, M.metal, x, 0.23, 0));
  return g;
}

export function vending() {
  const g = new THREE.Group();
  g.add(box(1.0, 1.9, 0.7, std({ color: 0xb0392e, roughness: 0.5, metalness: 0.2 }), 0, 0.95, 0));
  g.add(box(0.82, 1.2, 0.04, std({ color: 0x18324a, emissive: 0x2f7fb8, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.4 }), 0, 1.2, 0.36));
  for (let i = 0; i < 3; i++) g.add(box(0.7, 0.12, 0.05, std({ color: [0xe8c04a, 0x4aa3e8, 0xe86a4a][i], roughness: 0.6 }), 0, 0.45 + i * 0.16, 0.37));
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   vegetation damage / debris
   ══════════════════════════════════════════════════════════════════════════ */
export function fallenLog({ len = 3.2, r = 0.22, ry = 0 } = {}) {
  const g = new THREE.Group();
  const log = mesh(new THREE.CylinderGeometry(r * 0.85, r, len, 10), M.bark, { rz: Math.PI / 2, y: r });
  g.add(log);
  // cut face
  g.add(mesh(new THREE.CircleGeometry(r * 0.85, 12), std({ color: 0xc9a878, roughness: 0.9 }), { x: len / 2, y: r, rz: -Math.PI / 2 }));
  g.add(bush(0.4, M.leafDeep).translateX(-len * 0.42).translateY(0.02));
  g.rotation.y = ry;
  return g;
}

export function stump({ r = 0.24, h = 0.32 } = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 10), M.bark, { y: h / 2 }));
  g.add(mesh(new THREE.CircleGeometry(r * 0.9, 12), std({ color: 0xc9a878, roughness: 0.9 }), { y: h + 0.001, rx: -Math.PI / 2 }));
  return g;
}

export function leafLitter(n = 40, spread = 3) {
  const g = new THREE.Group();
  const mat = std({ color: 0x8f6b2f, roughness: 0.95, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const m = mesh(G.plane, mat, {
      x: (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * spread,
      y: 0.02 + Math.random() * 0.01,
      rx: -Math.PI / 2,
      rz: Math.random() * 6.28,
      sx: 0.1 + Math.random() * 0.08,
      sy: 0.06 + Math.random() * 0.05,
      shadow: false,
    });
    g.add(m);
  }
  return g;
}

export function rock(s = 0.4) {
  const g = mesh(G.ballLow, std({ color: 0x6d6a63, roughness: 0.95, flatShading: true }), { sx: s, sy: s * 0.7, sz: s * 0.85 });
  g.rotation.set(Math.random(), Math.random() * 3, Math.random());
  return g;
}

export function crackDecal(len = 2.2) {
  // thin dark crack built from a few quads
  const g = new THREE.Group();
  const mat = std({ color: 0x11141a, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false });
  let x = 0;
  let z = 0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(G.plane, mat, { x: x + 0.18, z, rx: -Math.PI / 2, sx: 0.36, sy: 0.035, rz: Math.random() * 0.6 - 0.3, shadow: false });
    g.add(seg);
    x += 0.3;
    z += (Math.random() - 0.5) * 0.22;
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   FX: smoke, fire, water, dust, sparks
   ══════════════════════════════════════════════════════════════════════════ */
export function smokePlume({ rate = 14, size = 0.5, color = 0xcfd3d8, rise = 1.4, spread = 0.16 } = {}) {
  const g = new THREE.Group();
  const tex = smokeTex();
  const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0.55, depthWrite: false });
  const parts = [];
  for (let i = 0; i < rate; i++) {
    const s = new THREE.Sprite(mat.clone());
    s.scale.setScalar(size);
    const life = Math.random();
    parts.push({ s, life, speed: 0.5 + Math.random() * 0.5, off: new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread) });
    g.add(s);
  }
  let t0 = 0;
  addTick((t) => {
    if (!t0) t0 = t;
    for (const p of parts) {
      p.life += 0.006 * p.speed;
      if (p.life > 1) p.life -= 1;
      const k = p.life;
      p.s.position.set(p.off.x + Math.sin(k * 6 + p.off.x * 10) * 0.2, k * rise * 2.4, p.off.z + Math.cos(k * 5) * 0.16);
      const sc = size * (0.6 + k * 2.2);
      p.s.scale.setScalar(sc);
      p.s.material.opacity = 0.5 * (1 - k) * Math.min(1, k * 6);
    }
  });
  return g;
}

export function fireFlame({ size = 0.5, intensity = 1 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xff8a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const inner = new THREE.Sprite(mat.clone());
  inner.material.color.set(0xffd070);
  inner.scale.setScalar(size * 0.8);
  g.add(inner);
  const outer = new THREE.Sprite(mat.clone());
  outer.material.color.set(0xff4a10);
  outer.scale.setScalar(size * 1.9);
  g.add(outer);

  /* 火舌：几个上细下粗的加色锥体，绕 y 轴轻微摇摆 */
  const tongues = [];
  const tongueMat = new THREE.MeshBasicMaterial({
    map: flameTex(),
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 5; i++) {
    const h = size * (1.5 + Math.random() * 1.1);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size * (0.3 + Math.random() * 0.16), h, 7, 1, true), tongueMat.clone());
    cone.position.set((Math.random() - 0.5) * size * 0.7, h * 0.45, (Math.random() - 0.5) * size * 0.7);
    cone.userData.ph = Math.random() * 6.28;
    g.add(cone);
    tongues.push(cone);
  }
  /* 余烬上飘 */
  const emberMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc060, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false });
  const embers = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(emberMat.clone());
    s.scale.setScalar(size * 0.11);
    s.userData.k = Math.random();
    embers.push(s);
    g.add(s);
  }

  const light = new THREE.PointLight(0xff7a20, 3 * intensity, 4.5, 2);
  light.position.y = 0.3;
  g.add(light);
  addTick((t) => {
    const f = 0.85 + Math.sin(t * 17.3) * 0.1 + Math.sin(t * 29.7) * 0.06;
    inner.scale.setScalar(size * 0.9 * f);
    outer.scale.setScalar(size * 2.1 * f);
    outer.material.opacity = 0.55 + Math.sin(t * 21) * 0.12;
    light.intensity = (2.6 + Math.sin(t * 23) * 0.8) * intensity;
    for (const c of tongues) {
      const k = 0.8 + Math.sin(t * 9.5 + c.userData.ph) * 0.22 + Math.sin(t * 21 + c.userData.ph) * 0.08;
      c.scale.set(1, k, 1);
      c.rotation.z = Math.sin(t * 5.2 + c.userData.ph) * 0.16;
      c.rotation.x = Math.cos(t * 4.4 + c.userData.ph) * 0.16;
      c.material.opacity = 0.22 + 0.16 * k;
    }
    for (const e of embers) {
      e.userData.k += 0.011;
      if (e.userData.k > 1) e.userData.k = 0;
      const k = e.userData.k;
      e.position.set(Math.sin(k * 9 + e.id) * size * 0.5, size * (0.5 + k * 3.4), Math.cos(k * 7 + e.id) * size * 0.5);
      e.material.opacity = 0.9 * (1 - k);
    }
  });
  return g;
}

export function puddle(x = 0, z = 0, w = 2.4, d = 1.6, rot = 0) {
  const mat = new THREE.MeshStandardMaterial({
    map: tiled(waterTex(), 1.5, 1.5),
    color: 0x9fc8d8,
    roughness: 0.06,
    metalness: 0.8,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = rot;
  m.position.set(x, 0.016, z);
  m.scale.set(w / 2, d / 2, 1);
  m.receiveShadow = false;
  return m;
}

export function drip({ height = 2.4 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xa9d8ea, transparent: true, opacity: 0.6, depthWrite: false });
  const drops = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(mat.clone());
    s.scale.setScalar(0.06);
    drops.push({ s, k: Math.random() });
    g.add(s);
  }
  addTick((t) => {
    for (const d of drops) {
      d.k += 0.02;
      if (d.k > 1) d.k = 0;
      d.s.position.set(Math.sin(d.k * 12) * 0.02, height * (1 - d.k), Math.cos(d.k * 9) * 0.02);
      d.s.material.opacity = 0.7 * (1 - d.k * 0.4);
    }
  });
  return g;
}

export function sparkBurst({ color = 0xffe9a8, n = 14, spread = 1.2 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const ps = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(mat.clone());
    s.scale.setScalar(0.05);
    ps.push({ s, k: Math.random(), vx: (Math.random() - 0.5) * spread, vy: 0.4 + Math.random(), vz: (Math.random() - 0.5) * spread });
    g.add(s);
  }
  addTick((t) => {
    for (const p of ps) {
      p.k += 0.016;
      if (p.k > 1) p.k = 0;
      p.s.position.set(p.vx * p.k * 2, p.vy * p.k * 1.6 - p.k * p.k * 1.4 + 0.2, p.vz * p.k * 2);
      p.s.material.opacity = 1 - p.k;
    }
  });
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   labels & markers
   ══════════════════════════════════════════════════════════════════════════ */
export function label3d(text, cls = "tag3d", y = 1.2, x = 0, z = 0) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(x, y, z);
  obj.userData.el = el;
  return obj;
}

/** pulsing ground ring used to point at a scanned target */
export function targetRing(color = 0x43e0ff, r = 0.9) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(G.ring, mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(r);
  m.position.y = 0.03;
  addTick((t) => {
    const k = (t * 0.7) % 1;
    m.scale.setScalar(r * (1 + k * 0.5));
    mat.opacity = 0.85 * (1 - k);
  });
  return m;
}

/** 3D corner-bracket box showing the detected bounding box */
export function bboxWire(w = 1, h = 1, d = 1, color = 0x43e0ff) {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const pts = [];
  const hx = w / 2;
  const hz = d / 2;
  const L = Math.min(w, h, d) * 0.28;
  const corners = [
    [-hx, 0, -hz],
    [hx, 0, -hz],
    [-hx, 0, hz],
    [hx, 0, hz],
  ];
  for (const [x, y, z] of corners) {
    // vertical
    pts.push(x, y, z, x, y + L, z);
    pts.push(x, y + h, z, x, y + h - L, z);
    // horizontal along x
    const sx = x < 0 ? 1 : -1;
    pts.push(x, y, z, x + sx * L, y, z);
    pts.push(x, y + h, z, x + sx * L, y + h, z);
    // horizontal along z
    const sz = z < 0 ? 1 : -1;
    pts.push(x, y, z, x, y, z + sz * L);
    pts.push(x, y + h, z, x, y + h, z + sz * L);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, mat);
  g.add(lines);
  g.userData.mat = mat;
  addTick((t) => {
    mat.opacity = 0.6 + Math.sin(t * 4) * 0.3;
  });
  return g;
}

/* ══════════════════════════════════════════════════════════════════════════
   misc
   ══════════════════════════════════════════════════════════════════════════ */
export function instanced(geo, mat, transforms, { colorFn = null, shadow = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, transforms.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  transforms.forEach((t, i) => {
    e.set(t.rx || 0, t.ry || 0, t.rz || 0);
    q.setFromEuler(e);
    v.set(t.x || 0, t.y || 0, t.z || 0);
    sc.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    m4.compose(v, q, sc);
    im.setMatrixAt(i, m4);
    if (colorFn) im.setColorAt(i, colorFn(i, t));
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = shadow;
  im.receiveShadow = shadow;
  return im;
}

export function rng(seed = 7) {
  return mulberry32(seed);
}

export { M, std, surf };
