import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* ══════════════════════════════════════════════════════════════════════════
   merge_static — 把静态网格按材质合并

   问题：观感版场景里有三千多个独立 Mesh——每一扇窗、每一条窗框、
   每一个屋顶机组都是单独的对象。三角形总数只有四万多，几何量很小，
   但三千次绘制调用把 CPU 压垮了，帧率掉到个位数。

   做法：按材质分组，把所有网格的顶点烘焙进世界坐标后合并成一个大几何。
   三千次调用降到二三十次，帧率提升一个数量级。

   代价：合并后整块几何不再按视锥剔除，远处也会被提交。
   但这个场景只有几十米到几百米，且合并后只有二三十个对象，
   这个代价远小于三千次调用的开销。
   ══════════════════════════════════════════════════════════════════════════ */

export function merge_static(root, { keep = [] } = {}) {
  root.updateMatrixWorld(true);

  /* 按材质分组。多材质网格（如 ExtrudeGeometry 的顶面/侧墙分组）不参与， */
  const groups = new Map();
  const pending = [];

  root.traverse((o) => {
    if (!o.isMesh) return;
    /* 实例化网格必须跳过。它的顶点只有一份，位置全在 instanceMatrix 里，
       合进来会丢掉每一个实例的位置——成百上千棵树会塌成原点的一棵。 */
    if (o.isInstancedMesh) return;
    /* 整棵子树都可以标记：机器狗、人形机器人有骨骼动画，
       合并会把腿烘成静止几何，走起来只剩整体平移。 */
    for (let p = o; p; p = p.parent) {
      if (p.userData?.no_merge) return;
      if (p === root) break;
    }
    if (keep.some((n) => o.name === n)) return;
    if (Array.isArray(o.material)) return;
    if (!o.material) return;

    /* 必须先 clone 再应用矩阵：几何体可能被多个网格共享 */
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);

    /* 合并要求属性集合一致。只保留三者，其余丢弃，
       否则有的几何有 uv2、有的没有，mergeGeometries 会返回 null */
    const cleaned = new THREE.BufferGeometry();
    cleaned.setAttribute("position", geo.getAttribute("position"));
    if (geo.getAttribute("normal")) cleaned.setAttribute("normal", geo.getAttribute("normal"));
    if (geo.getAttribute("uv")) cleaned.setAttribute("uv", geo.getAttribute("uv"));
    if (!cleaned.getAttribute("normal")) cleaned.computeVertexNormals();

    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: o.material, list: [] });
    groups.get(key).list.push(cleaned);
    pending.push(o);
  });

  /* 从父节点摘掉原来的网格 */
  for (const o of pending) {
    if (o.parent) o.parent.remove(o);
    o.geometry.dispose?.();
  }

  /* 逐个材质合并 */
  const merged = [];
  for (const { material, list } of groups.values()) {
    if (!list.length) continue;

    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!geo) {
      /* 合并失败就退回逐个添加，至少不丢东西 */
      for (const g of list) {
        const m = new THREE.Mesh(g, material);
        m.castShadow = true;
        m.receiveShadow = true;
        root.add(m);
      }
      continue;
    }
    if (list.length > 1) for (const g of list) g.dispose();

    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `merged:${material.userData?.slug || material.type}`;
    mesh.frustumCulled = false;   // 合并后是一整块，剔除没有意义
    root.add(mesh);
    merged.push(mesh);
  }

  return merged;
}
