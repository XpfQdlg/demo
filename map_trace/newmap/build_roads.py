# -*- coding: utf-8 -*-
"""
build_roads.py —— 用用户标注的黄线重建道路，并按道路裁边建筑

为什么要单独做一步：
    新图里的道路是**线稿**（约 4 像素宽，即 2 米），不是路面。
    旧版做法是把黄线稍微膨胀后直接画进 ground.png（1 像素 = 0.5 米）。
    这个分辨率下路面是糊的，白色边线更画不出来（0.3 米不到一个像素）。

现在的做法：
    1. 黄线当作**道路中心线**，膨胀成真实宽度的路面（默认 8 米）；
    2. 路面外扩 0.4 米得到白色边线；
    3. 两者都导出成矢量多边形（含内洞），交给前端用几何体绘制，
       这样第一人称贴地平视时边缘依然是清晰的；
    4. 建筑轮廓压到路面的部分裁掉，建筑让路，路面保持连续；
    5. 沿路两侧撒行道树与灌木点位。

输出：
    map_roads.json   道路多边形、白色边线多边形、行道树点位
    buildings_clipped.json  裁边后的建筑（供 build_map_package.py 合并）
    roads_check.png  核对图：道路黑、边线白、建筑灰、行道树点绿
"""

import json
import os

import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "..", "..", "source", "maps", "campus_zoning_outline_1079x1554.jpg")
ZONES = os.path.join(BASE, "map_zones.json")
PACKAGE = os.path.join(BASE, "map_package.json")

# ── 参数 ──────────────────────────────────────────────────────────────
METERS_PER_PX = 0.5   # 与 build_map_package.py 保持一致
SS = 2                # 超采样倍数：所有形态学运算在 2 倍图上做，边缘更干净

ROAD_WIDTH_M = 8.0    # 路面总宽（含两侧白色边线）
EDGE_M = 0.3          # 白色边线宽度：路线外扩这么多，渲染时被黑面盖住只留边缘一圈
BUILDING_GAP_M = 0.6  # 建筑退让，避免墙面糊到白线上

TREE_STEP_M = 15.0    # 行道树间距
TREE_OFFSET_M = (2.2, 4.2)  # 树点到路面外沿的距离区间
CANOPY_M = 1.8        # 树冠半径，用于与建筑保持距离
BUSH_EVERY = 3        # 每几棵树补一丛灌木

MIN_BUILDING_PART_M2 = 45.0  # 裁边后小于这个面积的小碎块直接丢掉


def load_yellow_mask():
    """读新图，取出用户标注的黄线（道路），返回超采样后的二值掩膜"""
    img = cv2.imread(SRC)
    if img is None:
        raise SystemExit(f"读不到源图：{SRC}")
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    raw = cv2.inRange(hsv, np.array([22, 60, 40]), np.array([33, 255, 255]))

    up = cv2.resize(raw, None, fx=SS, fy=SS, interpolation=cv2.INTER_LINEAR)
    up = (up > 128).astype(np.uint8) * 255
    # 线稿有细小断口，闭运算接上，否则路面会被截断
    up = cv2.morphologyEx(up, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return up


def stroke_halfwidth(mask):
    """线稿本身的半宽（超采样像素）"""
    dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    return float(np.median(dt[mask > 0]))


def disk(radius_px):
    r = max(1, int(round(radius_px)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def smooth_mask(mask, k=9):
    """膨胀/腐蚀的锯齿用高斯模糊 + 阈值抹平"""
    b = cv2.GaussianBlur(mask, (k, k), 0)
    return (b > 128).astype(np.uint8) * 255


def contours_with_holes(mask, eps_px):
    """
    二值掩膜 → 多边形列表 [{outer: [[x,y],...], holes: [[[...]]]}]
    坐标已换算回原图像素（除以 SS）。
    """
    cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return []
    hier = hier[0]

    def simplify(c):
        a = cv2.approxPolyDP(c, eps_px, True).reshape(-1, 2)
        return [[round(float(x) / SS, 2), round(float(y) / SS, 2)] for x, y in a]

    out = []
    for i, h in enumerate(hier):
        if h[3] != -1:          # 只处理外轮廓
            continue
        if cv2.contourArea(cnts[i]) < 30 * SS * SS:
            continue
        holes = []
        child = h[2]
        while child != -1:
            if cv2.contourArea(cnts[child]) > 20 * SS * SS:
                holes.append(simplify(cnts[child]))
            child = hier[child][0]
        outer = simplify(cnts[i])
        if len(outer) >= 3:
            out.append({"outer": outer, "holes": holes})
    return out


def mask_area_m2(mask):
    return int(mask.sum() / 255) / (SS * SS) * METERS_PER_PX ** 2


def clip_buildings(buildings, road_outer, water_mask, W, H):
    """
    建筑轮廓减去道路外沿，得到裁边后的多边形。
    一栋建筑可能被切成几块，全部保留（每块沿用原建筑的高度与用途）。
    """
    road_outer_small = cv2.resize(road_outer, (W, H), interpolation=cv2.INTER_AREA)
    results = []
    min_px = MIN_BUILDING_PART_M2 / (METERS_PER_PX ** 2) * SS * SS

    for b in buildings:
        poly = np.asarray(b["polygon"], np.float64)
        if len(poly) < 3:
            continue
        full = np.zeros((H * SS, W * SS), np.uint8)
        cv2.fillPoly(full, [(poly * SS).astype(np.int32)], 255)

        keep = cv2.bitwise_and(full, cv2.bitwise_not(road_outer))
        if water_mask is not None and b["kind"] != "water":
            keep = cv2.bitwise_and(keep, cv2.bitwise_not(water_mask))
        keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

        cnts, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        parts = [c for c in cnts if cv2.contourArea(c) >= min_px]
        parts.sort(key=cv2.contourArea, reverse=True)

        if not parts:
            # 整栋被道路吃掉的比例太高，保留原轮廓但记一笔
            results.append({**b, "clipped": False, "lost": 1.0})
            continue

        kept_area = sum(cv2.contourArea(c) for c in parts)
        total = cv2.contourArea(np.asarray(poly * SS, np.float32))
        for idx, c in enumerate(parts):
            approx = cv2.approxPolyDP(c, 1.6, True).reshape(-1, 2)
            if len(approx) < 3:
                continue
            pts = [[round(float(x) / SS, 2), round(float(y) / SS, 2)] for x, y in approx]
            results.append({
                **b,
                "id": b["id"] if idx == 0 else f"{b['id']}_p{idx + 1}",
                "polygon": pts,
                "clipped": True,
                "lost": round(1 - kept_area / max(total, 1), 3),
            })
    return results


def street_trees(road_outer, buildings_mask, water_mask, campus_poly, W, H):
    """
    行道树点位：在路面外沿 2.2~4.2 米的带状区里按 15 米间距取点。
    排除建筑（含一个树冠半径的余量）、水面、林地，避免树冠插进墙里。
    """
    inner = cv2.dilate(road_outer, disk(TREE_OFFSET_M[0] * SS / METERS_PER_PX))
    outer = cv2.dilate(road_outer, disk(TREE_OFFSET_M[1] * SS / METERS_PER_PX))
    band = cv2.bitwise_and(outer, cv2.bitwise_not(inner))

    # 树冠半径按 1.8 米算，建筑再外扩这么多，树才不会糊到墙上
    canopy = disk(CANOPY_M / METERS_PER_PX * SS)
    blocked = cv2.bitwise_or(cv2.dilate(buildings_mask, canopy), water_mask)
    band = cv2.bitwise_and(band, cv2.bitwise_not(blocked))

    campus = np.zeros((H * SS, W * SS), np.uint8)
    cv2.fillPoly(campus, [(np.asarray(campus_poly, np.float64) * SS).astype(np.int32)], 255)
    band = cv2.bitwise_and(band, campus)

    step_px = int(round(TREE_STEP_M / METERS_PER_PX * SS))
    trees = []
    rng = np.random.default_rng(20261104)
    for y in range(0, H * SS, step_px):
        for x in range(0, W * SS, step_px):
            x0, x1 = x, min(x + step_px, W * SS)
            y0, y1 = y, min(y + step_px, H * SS)
            cell = band[y0:y1, x0:x1]
            if cv2.countNonZero(cell) < step_px * step_px * 0.06:
                continue
            ys, xs = np.nonzero(cell)
            k = rng.integers(0, len(xs))
            px = (x0 + xs[k]) / SS
            py = (y0 + ys[k]) / SS
            trees.append([round(float(px), 1), round(float(py), 1)])
    return trees


def main():
    zones = json.load(open(ZONES, encoding="utf-8"))["zones"]
    pkg = json.load(open(PACKAGE, encoding="utf-8"))
    W = pkg["image"]["width"]
    H = pkg["image"]["height"]

    road_line = load_yellow_mask()
    half = stroke_halfwidth(road_line)
    print(f"线稿半宽 {half / SS * METERS_PER_PX:.2f} 米")

    # 路面：中心线膨胀到目标宽度
    r_px = (ROAD_WIDTH_M / METERS_PER_PX * SS) / 2 - half
    road = cv2.dilate(road_line, disk(r_px))
    road = smooth_mask(road, 11)
    print(f"路面 {mask_area_m2(road):.0f} 平方米（{ROAD_WIDTH_M} 米宽）")

    # 白色边线：路面再外扩 EDGE_M
    edge = cv2.dilate(road, disk(EDGE_M / METERS_PER_PX * SS))
    edge = smooth_mask(edge, 9)

    # 林地 / 水面不铺路、不种树
    water_mask = np.zeros((H * SS, W * SS), np.uint8)
    for b in pkg["buildings"]:
        if b.get("kind") == "water":
            cv2.fillPoly(water_mask, [(np.asarray(b["polygon"], np.float64) * SS).astype(np.int32)], 255)

    forest_mask = np.zeros((H * SS, W * SS), np.uint8)
    if "forest" in zones:
        cv2.fillPoly(forest_mask, [(np.asarray(zones["forest"]["polygon"], np.float64) * SS).astype(np.int32)], 255)

    buildings_mask = np.zeros((H * SS, W * SS), np.uint8)
    for b in pkg["buildings"]:
        if b["height_m"] > 0.01:
            cv2.fillPoly(buildings_mask, [(np.asarray(b["polygon"], np.float64) * SS).astype(np.int32)], 255)
    buildings_mask_original = buildings_mask

    # ── 建筑裁边 ──────────────────────────────────────────────────────
    gap = disk(BUILDING_GAP_M / METERS_PER_PX * SS)
    road_for_cut = cv2.dilate(edge, gap)
    clipped = clip_buildings(pkg["buildings"], road_for_cut, water_mask, W, H)
    lost = [b for b in clipped if b.get("lost", 0) > 0.35]
    print(f"建筑 {len(pkg['buildings'])} 栋 → 裁边后 {len(clipped)} 块，其中损失超 35% 的 {len(lost)} 块")

    # ── 行道树 ────────────────────────────────────────────────────────
    # 用裁边后的建筑做遮挡判断，否则树会被推进已经不存在的那半栋楼里
    buildings_mask_clipped = np.zeros((H * SS, W * SS), np.uint8)
    for b in clipped:
        if b.get("height_m", 0) > 0.01:
            cv2.fillPoly(buildings_mask_clipped,
                         [(np.asarray(b["polygon"], np.float64) * SS).astype(np.int32)], 255)

    campus_poly = zones["campus"]["polygon"]
    trees = street_trees(edge, buildings_mask_clipped,
                         cv2.bitwise_or(water_mask, forest_mask), campus_poly, W, H)
    print(f"行道树 {len(trees)} 棵")

    # 灌木：贴着白线外沿，比树更靠路，隔 3 棵树的距离补一丛
    bushes = []
    for i, (x, y) in enumerate(trees):
        if i % BUSH_EVERY != 0:
            continue
        bushes.append([round(x + 0.9, 1), round(y + 0.6, 1)])
    print(f"灌木 {len(bushes)} 丛")

    # ── 导出 ──────────────────────────────────────────────────────────
    roads = {
        "width_m": ROAD_WIDTH_M,
        "edge_m": EDGE_M,
        "surface": contours_with_holes(road, 2.0),
        "edge": contours_with_holes(edge, 2.0),
        "trees": trees,
        "bushes": bushes,
    }
    with open(os.path.join(BASE, "map_roads.json"), "w", encoding="utf-8") as f:
        json.dump(roads, f, ensure_ascii=False)
    with open(os.path.join(BASE, "buildings_clipped.json"), "w", encoding="utf-8") as f:
        json.dump(clipped, f, ensure_ascii=False)
    print(f"路面多边形 {len(roads['surface'])} 个，边线多边形 {len(roads['edge'])} 个")

    # ── 核对图 ────────────────────────────────────────────────────────
    check = np.full((H * SS, W * SS, 3), 255, np.uint8)
    for b in clipped:
        cv2.fillPoly(check, [(np.asarray(b["polygon"], np.float64) * SS).astype(np.int32)], (205, 200, 196))
    check[edge > 0] = (255, 255, 255)
    check[road > 0] = (0, 0, 0)
    for b in clipped:
        cv2.polylines(check, [(np.asarray(b["polygon"], np.float64) * SS).astype(np.int32)], True, (180, 120, 120), 2)
    for x, y in trees:
        cv2.circle(check, (int(x * SS), int(y * SS)), int(2.2 / METERS_PER_PX * SS), (40, 140, 60), -1)
    cv2.imwrite(os.path.join(BASE, "roads_check.png"),
                cv2.resize(check, None, fx=0.55, fy=0.55, interpolation=cv2.INTER_AREA))
    print("已输出 map_roads.json / buildings_clipped.json / roads_check.png")


if __name__ == "__main__":
    main()
