import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { tree } from "./props.js";
import { add_robots } from "./robots.js";
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
    new THREE.PlaneGeometry(W * MPP + 400, H * MPP + 400),
    pbr("grass", { repeat: 320, normalScale: 1.1, tint: 0x5c7440 })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  root.add(lawn);

  /* 森林地面：深绿贴片，压住底盘，边界一眼能认出来 */
  for (const poly of forests) {
    const pts = to_world(poly).map(([x, z]) => new THREE.Vector2(x, -z));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const patch = new THREE.Mesh(
      geo,
      pbr("grass", { repeat: 1 / 4, normalScale: 1.2, tint: 0x4b6338 })
    );
    patch.position.y = 0.04;
    patch.receiveShadow = true;
    root.add(patch);
  }

  /* 林间道路：数据包里给的折线，压在地面上 */
  const path_pts = PACKAGE.forest_path?.points || [];
  const path_poly = PACKAGE.forest_path?.polygon || [];
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

  for (const poly of forests) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const area_ha = ((x1 - x0) * (y1 - y0) * MPP * MPP) / 10000;
    const n = Math.min(900, Math.round(area_ha * 70));
    let placed = 0;
    for (let i = 0; i < n * 6 && placed < n; i++) {
      const px = x0 + rnd() * (x1 - x0);
      const py = y0 + rnd() * (y1 - y0);
      if (!inside(poly, px, py)) continue;
      if (on_path(px, py)) continue;
      const [x, z] = PW(px, py);
      const t = tree({ h: 7 + rnd() * 6, seed: 5200 + placed, tone: placed });
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI * 2;
      root.add(t);
      placed++;
    }
  }

  /* 石头：林下裸露的基岩 */
  const rockMat = pbr("rock", { repeat: 2, normalScale: 1.6, tint: 0x8b877d });
  for (let i = 0; i < 30; i++) {
    const poly = forests[(i * 7) % forests.length];
    if (!poly) break;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const px = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs));
    const py = Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys));
    if (!inside(poly, px, py) || on_path(px, py)) continue;
    const [x, z] = PW(px, py);
    const s = 0.7 + rnd() * 1.6;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    rock.position.set(x, s * 0.3, z);
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    rock.scale.y = 0.55 + rnd() * 0.4;
    rock.castShadow = true;
    root.add(rock);
  }

  /* 取景：围住整片林子 */
  if (forests.length) {
    const all = forests.flat();
    const xs = to_world(all).map((p) => p[0]);
    const zs = to_world(all).map((p) => p[1]);
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
