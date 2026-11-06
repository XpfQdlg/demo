import * as THREE from "three";
import { pbr, preload } from "../core/pbr.js";
import { build_hill, scatter_hill_trees } from "../map/terrain.js";
import { tree } from "./props.js";
import { add_robots } from "./robots.js";
import EXTRA from "../map/data/scene_extra.json";
import PACKAGE from "../map/data/map_package.json";

/* ══════════════════════════════════════════════════════════════════════════
   scene_forest — 西山森林（观感版）

   地形来自 scene_extra 的西山轮廓与山脊，用 terrain.js 的高度场生成：
   山脚压平出巡检空地，坡面撒树。

   与联动演示的区别只在材质：那边用程序化草皮贴图，
   这边用 AmbientCG 的草地材质，配合 8 段法线，斜光下坡面有起伏感。
   ══════════════════════════════════════════════════════════════════════════ */

const MPP = PACKAGE.scale.meters_per_px;
const W = PACKAGE.image.width;
const H = PACKAGE.image.height;
const PW = (px, py) => [(px - W / 2) * MPP, (py - H / 2) * MPP];

export async function build_forest(cine) {
  await preload(["grass", "wood", "rock"]);

  const F = EXTRA.forest;
  const hill = EXTRA.hills.find((h) => h.id === F?.hill_id);

  const root = new THREE.Group();
  root.name = "forest";

  /* 底盘草地 */
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    /* 1600 / 400 = 4 米一张，与校园、小区同一尺度 */
    pbr("grass", { repeat: 400, normalScale: 1.1, tint: 0x6f8a4a })
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  root.add(lawn);

  if (!hill) {
    root.userData.frame = { center: [0, 0], span: 200 };
    return root;
  }

  /* 山体：高度场网格，材质换成 PBR 草皮 */
  /* terrain.js 把 UV 按全图归一化，一张贴图占 1079 × 0.5 / 135 ≈ 4 米 */
  const hillMat = pbr("grass", { repeat: 135, normalScale: 1.4, tint: 0x83a15c });
  const mesh = build_hill(hill, {
    seg: 72,
    flatten: F ? [F.clearing] : [],
    flatten_smooth: F ? F.flatten_smooth ?? 45 : 20,
    material: hillMat,
  });
  root.add(mesh);

  /* 坡面树：先按原有散点，再换成观感版的树 */
  const spots = scatter_hill_trees(hill, mesh, { count: 420, seed: 31 });
  if (spots) {
    /* scatter_hill_trees 返回的是实例化网格，这里直接沿用——
       它已经把树按三角形采样落在坡面上，位置是准的 */
    root.add(spots);
  }

  /* 山脚空地：一片较亮的草地，与坡面区分开 */
  if (F) {
    const pts = F.clearing.map(([px, py]) => {
      const [x, z] = PW(px, py);
      return new THREE.Vector2(x, -z);
    });
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const patch = new THREE.Mesh(
      geo,
      /* 空地是 ShapeGeometry，UV 单位是米 */
      pbr("grass", { repeat: 1 / 4, normalScale: 1.0, tint: 0x7f9a52 })
    );
    patch.position.y = 0.06;
    patch.receiveShadow = true;
    root.add(patch);

    /* 空地边缘补几棵大乔木 */
    const cx = F.clearing.reduce((a, p) => a + p[0], 0) / F.clearing.length;
    const cy = F.clearing.reduce((a, p) => a + p[1], 0) / F.clearing.length;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 26 + (i % 3) * 7;
      const [x, z] = PW(cx + Math.cos(a) * r / MPP, cy + Math.sin(a) * r / MPP);
      const t = tree({ h: 8 + (i % 4) * 0.9, seed: 700 + i, tone: i });
      t.position.set(x, 0, z);
      root.add(t);
    }

    const [fcx, fcz] = PW(cx, cy);
    root.userData.frame = { center: [fcx, fcz], span: 230 };

    /* 山脚空地上的设备：狗 2 台、人形 1 台，只在压平的空地里活动 */
    add_robots(root, { scene: "forest", cine, dogs: 2, humans: 1, seed: 3305 });

    /* 山脚林带：只在山上撒树，山就成了一块孤零零的绿馒头。
       真实的山是与周围林地连成一片的，山脚下再铺一圈树，
       边缘往平地上自然散开。位置用「到山心的距离」做筛选，
       剔掉落在山体网格与空地里的点，其余直接铺在 y = 0。 */
    const hxs = hill.polygon.map((p) => p[0]);
    const hys = hill.polygon.map((p) => p[1]);
    const hx0 = (Math.min(...hxs) - W / 2) * MPP;
    const hx1 = (Math.max(...hxs) - W / 2) * MPP;
    const hz0 = (Math.min(...hys) - H / 2) * MPP;
    const hz1 = (Math.max(...hys) - H / 2) * MPP;
    const hcx = (hx0 + hx1) / 2;
    const hcz = (hz0 + hz1) / 2;
    const hr = Math.max(hx1 - hx0, hz1 - hz0) * 0.62;

    let acc = 99173;
    const rnd = () => {
      acc = (acc * 1664525 + 1013904223) >>> 0;
      return acc / 4294967296;
    };
    const in_clearing = (x, z) =>
      x > fcx - 24 && x < fcx + 24 && z > fcz - 22 && z < fcz + 22;

    for (let i = 0; i < 520; i++) {
      const a = rnd() * Math.PI * 2;
      const r = hr * (0.55 + rnd() * 0.95);
      const x = hcx + Math.cos(a) * r;
      const z = hcz + Math.sin(a) * r;
      if (in_clearing(x, z)) continue;
      const t = tree({ h: 6 + rnd() * 5, seed: 5200 + i, tone: i });
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI * 2;
      root.add(t);
    }

    /* 几块石头：林地里裸露的基岩，能压住「纯草坪」的平铺感 */
    const rockMat = pbr("rock", { repeat: 2, normalScale: 1.6, tint: 0x8b877d });
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = hr * (0.3 + rnd() * 0.9);
      const s = 0.7 + rnd() * 1.9;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
      rock.position.set(hcx + Math.cos(a) * r, s * 0.35, hcz + Math.sin(a) * r);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.scale.y = 0.55 + rnd() * 0.4;
      rock.castShadow = true;
      rock.receiveShadow = true;
      root.add(rock);
    }
  } else {
    root.userData.frame = { center: [0, 0], span: 300 };
  }

  return root;
}
