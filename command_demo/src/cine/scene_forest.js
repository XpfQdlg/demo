import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { tree } from "./props.js";
import { add_robots } from "./robots.js";
import { build_hill, height_at } from "../map/terrain.js";
import PACKAGE from "../map/data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   scene_forest — 林区（2026-11-06 换图后重写）

   新图里森林是三块实心色块，不可通行；数据包里另外给了一条林间道路
   （forest_path），巡检设备沿它进林。

   上一版读 scene_extra 的西山轮廓与山脊，那套坐标只对旧图成立。
   这里改成：森林地面铺深绿、树按轮廓撒、道路压在地面上。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;
const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];

const to_world = (poly) => poly.map(([x, y]) => PW(x, y));

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export async function build_forest(cine) {
  await preload(["grass", "wood", "rock"]);

  const root = new THREE.Group();
  root.name = "forest";

  const forests = PACKAGE.zones?.forest?.forests?.length
    ? PACKAGE.zones.forest.forests
    : [PACKAGE.zones?.forest?.polygon].filter(Boolean);

  /* 底盘：整幅地面，颜色接近林下阴影 */
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0x1a2614, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.04, emissive: 0x0a1207, emissiveIntensity: 0.55 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  root.add(lawn);

  /* 森林山体：森林长在一座南北向的小山上。
     旧图有西山（scene_extra），换新图后坐标对不上，这里用森林带自身的
     轮廓重新造山。山脊沿森林带纵向中线走，峰值 40 米；
     林间道路与火点空地压平，设备照常进林。 */
  const path_pts = PACKAGE.forest_path?.points || [];
  const path_poly = PACKAGE.forest_path?.polygon || [];

  const RIDGE_MAIN = [
    [160, 100], [220, 400], [280, 650], [260, 900], [170, 1040],
  ];
  const flatten = [];
  if (path_poly.length >= 3) flatten.push(path_poly);
  /* 火点空地：以林间道路中段为中心压平一块，别让火埋进山里 */
  const fire_px = path_pts.length >= 3 ? path_pts[Math.floor(path_pts.length * 0.42)] : [W / 2, H / 2];
  flatten.push([
    [fire_px[0] - 42, fire_px[1] - 42],
    [fire_px[0] + 42, fire_px[1] - 42],
    [fire_px[0] + 42, fire_px[1] + 42],
    [fire_px[0] - 42, fire_px[1] + 42],
  ]);

  /* 每块森林各造一座山。西侧主林带（第一块）用纵向山脊，
     东北与北侧的小块用质心钟形即可。 */
  const hills = [];
  forests.forEach((poly, i) => {
    if (poly.length < 3) return;
    const hill = {
      polygon: poly,
      ridge: i === 0 ? RIDGE_MAIN : null,
      peak_m: i === 0 ? 40 : 30,
      roughness: 0.42,
      id: `forest-hill-${i}`,
    };
    hills.push(hill);
    root.add(build_hill(hill, {
      seg: i === 0 ? 60 : 40,
      flatten: i === 0 ? flatten : [],
      flatten_smooth: 40,
    }));
  });
  if (path_pts.length >= 2) {
    const w = PACKAGE.forest_path.width_m || 6;
    const left = [];
    const right = [];
    for (let i = 0; i < path_pts.length; i++) {
      const p = path_pts[i];
      const q = path_pts[Math.min(i + 1, path_pts.length - 1)];
      const r = path_pts[Math.max(i - 1, 0)];
      const dx = q[0] - r[0];
      const dy = q[1] - r[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const half = w / 2 / MPP;
      left.push(PW(p[0] + nx * half, p[1] + ny * half));
      right.push(PW(p[0] - nx * half, p[1] - ny * half));
    }
    const ring = [...left, ...right.reverse()].map(([x, z]) => new THREE.Vector2(x, -z));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(ring));
    geo.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(
      geo,
      pbr("concrete_floor", { repeat: 1 / 3, tint: 0x9b927f, normalScale: 1.0 })
    );
    road.position.y = 0.09;
    road.receiveShadow = true;
    root.add(road);
  }

  /* 树：撒在森林轮廓内，避开道路走廊 */
  let seed = 99173;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const on_path = (px, py) => path_poly.length >= 3 && inside(path_poly, px, py);

  for (let fi = 0; fi < forests.length; fi++) {
    const poly = forests[fi];
    const hill = hills[fi];
    const fl = fi === 0 ? flatten : [];
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const area_ha = ((x1 - x0) * (y1 - y0) * MPP * MPP) / 10000;
    const n = Math.min(2600, Math.round(area_ha * 110));
    let placed = 0;
    for (let i = 0; i < n * 8 && placed < n; i++) {
      const px = x0 + rnd() * (x1 - x0);
      const py = y0 + rnd() * (y1 - y0);
      if (!inside(poly, px, py)) continue;
      if (on_path(px, py)) continue;
      const [x, z] = PW(px, py);
      const h = hill ? height_at(hill, px, py, fl, 40) : 0;
      const t = tree({ h: 8 + rnd() * 7, seed: 5200 + placed, tone: placed });
      t.position.set(x, h, z);
      t.rotation.y = rnd() * Math.PI * 2;
      root.add(t);
      placed++;
    }
  }

  /* 石头：林下裸露的基岩 */
  const rockMat = pbr("rock", { repeat: 2, normalScale: 1.6, tint: 0x8b877d });
  for (let i = 0; i < 30; i++) {
    const fi = (i * 7) % forests.length;
    const poly = forests[fi];
    if (!poly) break;
    const hill = hills[fi];
    const fl = fi === 0 ? flatten : [];
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const px = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs));
    const py = Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys));
    if (!inside(poly, px, py) || on_path(px, py)) continue;
    const [x, z] = PW(px, py);
    const h = hill ? height_at(hill, px, py, fl, 40) : 0;
    const s = 0.7 + rnd() * 1.6;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    rock.position.set(x, h + s * 0.3, z);
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    rock.scale.y = 0.55 + rnd() * 0.4;
    rock.castShadow = true;
    root.add(rock);
  }

  /* 火点：森林模型的主角。
     夜里的林海只有一片暗绿，领导看不出「火险」在哪儿；
     给一处林间空地压上烧焦的地面、一团会跳的火、一道上升的烟，
     再加一盏橙色点光把附近的树冠照亮，整个场景才读得懂。 */
  function add_wildfire() {
    if (!forests.length) return;
    const base = path_pts.length
      ? path_pts[Math.floor(path_pts.length * 0.42)]
      : [W / 2, H / 2];
    let [fx, fz] = PW(base[0], base[1]);
    /* 往路边林子里挪 34 米，别把火放在路正中间 */
    fx += 24;
    fz -= 24;

    const group = new THREE.Group();
    group.name = "wildfire";
    group.position.set(fx, 0, fz);
    group.userData.no_merge = true;

    /* 烧焦的地面 */
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(34, 48),
      new THREE.MeshStandardMaterial({ color: 0x120b08, roughness: 1.0, metalness: 0.0 })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.12;
    group.add(scorch);

    /* 热区脉冲环 */
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(32, 34, 72),
      new THREE.MeshBasicMaterial({
        color: 0xff5a2a, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.16;
    group.add(ring);

    /* 火：几片加色光斑叠在一起 */
    const fire_tex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(255,214,150,0.85)");
      grd.addColorStop(0.35, "rgba(255,150,60,0.5)");
      grd.addColorStop(0.7, "rgba(255,80,20,0.16)");
      grd.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const flames = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fire_tex, color: 0xffb066, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.55, toneMapped: false,
      }));
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 16;
      s.position.set(Math.cos(a) * r, 4 + rnd() * 10, Math.sin(a) * r);
      s.scale.setScalar(7 + rnd() * 13);
      flames.push(s);
      group.add(s);
    }

    /* 烟：慢速上升、逐渐散开 */
    const smoke_tex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, "rgba(190,185,180,0.55)");
      grd.addColorStop(0.5, "rgba(150,150,150,0.22)");
      grd.addColorStop(1, "rgba(120,120,120,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const puffs = [];
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smoke_tex, color: 0x8e8a84, transparent: true,
        depthWrite: false, opacity: 0.3, toneMapped: false, fog: false,
      }));
      s.position.set((rnd() - 0.5) * 40, 20 + rnd() * 110, (rnd() - 0.5) * 40);
      s.scale.setScalar(18 + rnd() * 30);
      s.userData.phase = rnd() * 46;
      s.userData.x0 = s.position.x;
      s.userData.z0 = s.position.z;
      puffs.push(s);
      group.add(s);
    }

    /* 橙色点光照亮树冠 */
    const glow = new THREE.PointLight(0xff7a3c, 40, 170, 1.5);
    glow.position.set(0, 6, 0);
    group.add(glow);

    root.add(group);

    cine.add_updater((dt, t) => {
      group.rotation.y = 0;
      flames.forEach((s, i) => {
        const f = 0.72 + 0.28 * Math.sin(t * (6 + i * 0.7) + i * 1.7);
        s.material.opacity = 0.3 + 0.3 * f;
        s.position.y = 5 + 3 * Math.sin(t * 2.2 + i) + i * 0.7;
      });
      ring.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4));
      ring.scale.setScalar(1 + 0.06 * Math.sin(t * 2.4));
      glow.intensity = 22 + 8 * Math.sin(t * 5.1);
      puffs.forEach((s, i) => {
        const life = (t * 0.055 + i / puffs.length) % 1;
        s.position.y = 16 + life * 150;
        s.position.x = s.userData.x0 + Math.sin(t * 0.4 + i) * 3 + life * 8;
        s.position.z = s.userData.z0 + life * 5;
        s.scale.setScalar(16 + life * 44);
        s.material.opacity = 0.3 * (1 - life) * Math.min(1, life * 5);
      });
    });
  }
  add_wildfire();

  /* 取景：聚焦西侧主林带（火点与巡检设备都在这里），
     东北与北侧的小片森林留给校园页签的全景看。 */
  const main_poly = forests[0] || [];
  if (main_poly.length) {
    const xs = to_world(main_poly).map((p) => p[0]);
    const zs = to_world(main_poly).map((p) => p[1]);
    root.userData.frame = {
      center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2],
      span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 40,
    };
  } else {
    root.userData.frame = { center: [0, 0], span: 300 };
  }

  /* 设备沿林间道路巡检 */
  const p0 = path_pts.length ? path_pts[Math.floor(path_pts.length / 2)] : null;
  const pc = forests.length
    ? forests[0].reduce((a, p) => [a[0] + p[0] / forests[0].length, a[1] + p[1] / forests[0].length], [0, 0])
    : [W / 2, H / 2];
  add_robots(root, {
    scene: "forest",
    cine,
    dogs: 2,
    humans: 1,
    seed: 3305,
    center_px: p0 || pc,
    radius_px: 260,
  });

  return root;
}
