"""
把用户新给的色块总平面图打成 3D 场景数据包。

图例（用户给定）：
    黑线      校园边界
    蓝绿      森林（山体，不可通行）
    黄绿      校园绿化
    红        教学楼、宿舍
    紫 + 浅绿 操场（紫色是跑道环，浅绿是内场）
    黄        道路
    浅蓝      水
    橙        小区楼房

输出：
    map_package.json   区域、建筑、道路、行道树、行走掩膜、比例尺
    ground.png         地面贴图（只有铺装、绿化、水、森林，不画道路）
    preview_classes.png 分类核对图
    preview_package.png 数据包核对图：建筑、道路、掩膜叠在一起

比例尺：MPP 实际取 1.0 米/像素。旧文档与输出里 note 字段仍写 0.5，两处口径不一致，
待拿到实测尺寸后统一（见 docs/06_3D技术架构.md 待优化项）。

用法：
    python build_package.py
"""

import base64
import json
import os

import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "..", "..", "source", "maps", "campus_zoning_1333x1079.jpg")
OUT_JSON = os.path.join(BASE, "map_package.json")
OUT_GROUND = os.path.join(BASE, "ground.png")

MPP = 1.0          # 米/像素；与 note 字段里的 0.5 不一致，待确认后统一
CELL_PX = 2        # 行走掩膜一格 2 像素 = 2 米
ROAD_W_M = 8.0     # 道路宽度，米

# 分类索引（由 k-means 得到，见 classify 注释）
C_RED, C_WHITE1, C_ROAD1, C_FOREST, C_BLACK, C_PURPLE = 0, 1, 2, 3, 4, 5
C_ORANGE, C_WHITE2, C_ROAD2, C_GRASS, C_WATER, C_PURPLE2 = 6, 7, 8, 9, 10, 11
C_ROAD3, C_BLACK2 = 12, 13


def classify(img):
    """按颜色聚类分类，再按规则补上聚类没分出来的类。"""
    h, w = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    rng = np.random.default_rng(7)
    sample = lab[rng.choice(lab.shape[0], 200000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.3)
    _, _, centers = cv2.kmeans(sample, 14, None, crit, 8, cv2.KMEANS_PP_CENTERS)

    labels = np.zeros(lab.shape[0], np.uint8)
    step = 400000
    for i in range(0, lab.shape[0], step):
        chunk = lab[i:i + step]
        d = ((chunk[:, None, :] - centers[None, :, :]) ** 2).sum(2)
        labels[i:i + step] = d.argmin(1)
    labels = labels.reshape(h, w)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    m = {
        # 建筑
        "red": labels == C_RED,
        "orange": labels == C_ORANGE,
        # 森林：整片蓝绿；深色边缘也算进来
        "forest": (labels == C_FOREST) | ((H > 70) & (H < 95) & (S > 45) & (V < 170)),
        # 道路：三种黄；浅黄 12 号要排除掉“空地”误判，靠后续形态学处理
        "road": np.isin(labels, [C_ROAD1, C_ROAD2, C_ROAD3]),
        # 校园绿化：黄绿；操场内场是更亮的绿，单独分出来
        "grass": labels == C_GRASS,
        "infield": (H >= 34) & (H <= 46) & (S >= 90) & (V >= 200),
        "water": labels == C_WATER,
        "purple": np.isin(labels, [C_PURPLE, C_PURPLE2]),
        "black": np.isin(labels, [C_BLACK, C_BLACK2]) | ((V < 90) & (S < 100)),
    }
    # 内场从道路里剔掉，否则田径场会被当成路
    m["road"] &= ~m["infield"]
    m["grass"] &= ~m["infield"]
    return m


def clean(mask, open_px=1, close_px=1, min_area=0):
    """开闭运算去毛刺，再按面积过滤"""
    k = np.ones((3, 3), np.uint8)
    out = mask.astype(np.uint8)
    if open_px:
        out = cv2.morphologyEx(out, cv2.MORPH_OPEN, k, iterations=open_px)
    if close_px:
        out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, k, iterations=close_px)
    if min_area:
        n, lab, stats, _ = cv2.connectedComponentsWithStats(out, 8)
        keep = np.zeros_like(out)
        for i in range(1, n):
            if stats[i, 4] >= min_area:
                keep[lab == i] = 1
        out = keep
    return out.astype(bool)


def outline(mask, eps=1.5, min_area=200.0):
    """掩膜 → 多边形列表（像素坐标，float）"""
    m = (mask.astype(np.uint8)) * 255
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for c in cnts:
        if cv2.contourArea(c) < min_area:
            continue
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        if len(ap) >= 3:
            polys.append(ap.astype(float).tolist())
    return polys


def campus_polygon(black):
    """黑线是细线，先闭合再泛洪，取内部为校园"""
    line = cv2.dilate(black.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=2)
    h, w = line.shape
    ff = line.copy()
    maskff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, maskff, (0, 0), 2)
    inside = (ff != 2) & (line == 0)
    # 填掉内部的小洞（图上留白处）
    inside = cv2.morphologyEx(inside.astype(np.uint8), cv2.MORPH_CLOSE,
                              np.ones((9, 9), np.uint8), iterations=2)
    inside = clean(inside.astype(bool), 0, 0, min_area=50000)
    polys = outline(inside, eps=2.0, min_area=50000)
    return inside.astype(bool), max(polys, key=lambda p: abs(cv2.contourArea(np.array(p, np.float32)))) if polys else None


def community_polygon(orange, road, campus):
    """小区没有画边界：橙色楼群 + 附近道路的凸包，再外扩一圈"""
    pts = np.argwhere(orange)
    if len(pts) < 100:
        return None
    # 只取东南方向那一片，避免把校园里的橙色误并进来
    keep = pts[(pts[:, 1] > 820) & (pts[:, 0] > 600)]
    if len(keep) < 100:
        keep = pts
    hull = cv2.convexHull(keep[:, ::-1].astype(np.int32))
    poly = np.zeros(orange.shape, np.uint8)
    cv2.fillPoly(poly, [hull], 1)
    # 外扩：给围墙留出位置
    poly = cv2.dilate(poly, np.ones((3, 3), np.uint8), iterations=14)
    # 道路伸出去的地方也算小区范围
    poly = cv2.morphologyEx(poly, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    poly = clean(poly.astype(bool), 0, 2, min_area=20000)
    # 小区与校园相接：把校园那块挖掉，否则围墙会横穿校园
    poly &= ~campus
    return poly


def build_buildings(red, orange):
    """红色是校园楼、橙色是小区楼。高度按占地面积估，图上没有高度信息。"""
    out = []
    idx = 0
    for mask, kind_default, prefix in ((red, "campus", "楼"), (orange, "residential", "号楼")):
        for poly in outline(mask, eps=1.2, min_area=120):
            pts = np.array(poly, np.float32)
            area_m2 = abs(cv2.contourArea(pts)) * MPP * MPP
            xs, ys = pts[:, 0], pts[:, 1]
            cx, cy = float(xs.mean()), float(ys.mean())
            idx += 1
            if kind_default == "campus":
                if area_m2 > 1200:
                    kind, h = "teaching", 21.0
                    name = f"教学区 {idx}"
                elif area_m2 > 500:
                    kind, h = "residential", 17.0
                    name = f"宿舍区 {idx}"
                else:
                    kind, h = "public", 9.0
                    name = f"配套用房 {idx}"
            else:
                kind, h = "residential", 26.0 + min(14.0, area_m2 / 40.0)
                name = f"小区 {idx} 号楼"
            out.append({
                "id": f"b{idx:03d}",
                "name": name,
                "kind": kind,
                "height_level": int(round(h / 3.6)),
                "height_m": round(h, 1),
                "polygon": [[round(x, 1), round(y, 1)] for x, y in poly],
                "area_m2": round(area_m2, 1),
            })
    return out


def build_roads(road, block, forest, campus):
    """黄色细线扩成 8 米宽的路面，再挖掉压在楼下的部分"""
    w_px = int(round(ROAD_W_M / MPP))          # 8 米 = 16 像素
    road_d = cv2.dilate(road.astype(np.uint8), np.ones((w_px, w_px), np.uint8))
    road_d = cv2.morphologyEx(road_d, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    road_d &= (~block).astype(np.uint8)        # 楼底下没有路
    road_d &= (~forest).astype(np.uint8)
    road_d &= (campus | True).astype(np.uint8)
    road = clean(road_d.astype(bool), 0, 1, min_area=400)

    m = (road.astype(np.uint8)) * 255
    cnts, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    surfaces = []
    if hier is not None:
        hier = hier[0]
        for i, c in enumerate(cnts):
            if hier[i][3] != -1:
                continue                      # 洞单独处理
            if cv2.contourArea(c) < 400:
                continue
            outer = cv2.approxPolyDP(c, 2.0, True).reshape(-1, 2).astype(float).tolist()
            holes = []
            j = hier[i][2]
            while j != -1:
                hc = cnts[j]
                if cv2.contourArea(hc) > 200:
                    holes.append(cv2.approxPolyDP(hc, 2.0, True)
                                 .reshape(-1, 2).astype(float).tolist())
                j = hier[j][0]
            surfaces.append({"outer": outer, "holes": holes})
    return road, surfaces


def forest_path(forest):
    """森林不可通行，补一条 14 米宽的林间土路，机器沿它进山。
    路面视觉 6 米，行走网格留宽一点，否则 spread_spots 取不到开阔点。"""
    h, w = forest.shape
    pts = None
    # 找西侧那片最大的森林
    n, lab, stats, _ = cv2.connectedComponentsWithStats(forest.astype(np.uint8), 8)
    if n <= 1:
        return None, None
    big = 1 + int(np.argmax(stats[1:, 4]))
    ys, xs = np.where(lab == big)
    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()

    # 从校园西边界向林子里画一条弧线，再向南拐
    ax = int(x0 + (x1 - x0) * 0.82)
    path = [
        [ax, int(y0 + (y1 - y0) * 0.30)],
        [int(x0 + (x1 - x0) * 0.62), int(y0 + (y1 - y0) * 0.38)],
        [int(x0 + (x1 - x0) * 0.45), int(y0 + (y1 - y0) * 0.52)],
        [int(x0 + (x1 - x0) * 0.36), int(y0 + (y1 - y0) * 0.70)],
        [int(x0 + (x1 - x0) * 0.40), int(y0 + (y1 - y0) * 0.86)],
    ]
    walk = np.zeros((h, w), np.uint8)
    cv2.polylines(walk, [np.array(path, np.int32)], False, 1, thickness=28)  # 14 米
    vis = np.zeros((h, w), np.uint8)
    cv2.polylines(vis, [np.array(path, np.int32)], False, 1, thickness=12)   # 6 米
    return path, (walk.astype(bool), vis.astype(bool))


def build_walk_mask(walkable, cell=CELL_PX):
    """降采样成 2 米一格：一格内一半以上可走就算可走"""
    h, w = walkable.shape
    gh, gw = -(-h // cell), -(-w // cell)   # 向上取整，和前端 Math.ceil 对齐
    pad = np.zeros((gh * cell, gw * cell), bool)
    pad[:h, :w] = walkable
    small = pad.reshape(gh, cell, gw, cell).mean(axis=(1, 3))
    mask = (small >= 0.5).astype(np.uint8)
    bits = np.packbits(mask.ravel())
    return {
        "width": int(gw),
        "height": int(gh),
        "div": int(cell),
        "bits": base64.b64encode(bits.tobytes()).decode("ascii"),
        "meters_per_cell": cell * MPP,
    }


def paint_ground(img_shape, campus, grass, water, forest, infield, purple, community, path_vis):
    """地面贴图：只画铺装、草地、水、森林、操场，不画道路"""
    h, w = img_shape[:2]
    g = np.zeros((h, w, 3), np.uint8)
    g[:] = (196, 190, 178)                          # 校园铺装（BGR）
    g[~campus & ~community] = (214, 210, 202)       # 校外淡一些
    g[grass] = (90, 140, 110)
    g[infield] = (95, 150, 105)
    g[purple] = (70, 80, 165)                       # 跑道（BGR 偏红棕）
    g[water] = (150, 120, 70)                       # 水
    g[forest] = (95, 110, 70)                       # 森林暗绿
    g[path_vis] = (120, 130, 140)                   # 林间土路（浅灰褐）
    return g


def main():
    img = cv2.imread(SRC)
    if img is None:
        raise SystemExit(f"读不到 {SRC}")
    h, w = img.shape[:2]
    m = classify(img)
    print("分类占比：", {k: round(float(v.mean()) * 100, 2) for k, v in m.items()})

    red = clean(m["red"], 1, 1, 120)
    orange = clean(m["orange"], 1, 1, 100)
    forest = clean(m["forest"], 1, 2, 5000)
    # 只保留西边那一片：三块里面积最大的
    n_, lab_, stats_, _ = cv2.connectedComponentsWithStats(forest.astype(np.uint8), 8)
    if n_ > 1:
        big = 1 + int(np.argmax(stats_[1:, 4]))
        forest = (lab_ == big)
    water = clean(m["water"], 1, 1, 300)
    grass = clean(m["grass"], 1, 1, 150)
    infield = clean(m["infield"], 1, 1, 400)
    purple = clean(m["purple"], 1, 1, 300)
    road_src = clean(m["road"], 0, 1, 60)
    black = clean(m["black"], 0, 1, 200)

    campus_mask, campus_poly = campus_polygon(black)
    print("校园面积（平方米）:", round(float(campus_mask.mean()) * w * h * MPP * MPP))
    community_mask = community_polygon(orange, road_src, campus_mask)
    block = cv2.dilate((red | orange).astype(np.uint8),
                       np.ones((9, 9), np.uint8)).astype(bool)

    road, surfaces = build_roads(road_src, block, forest, campus_mask)
    path, (path_walk, path_vis) = forest_path(forest)

    # 可行走：校园与小区内部 ─ 建筑外扩 2 米 ─ 水 ─ 森林
    walkable = (campus_mask | community_mask)
    walkable &= ~cv2.dilate((red | orange).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    walkable &= ~cv2.dilate(water.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    walkable &= ~forest
    walkable |= road
    if path_walk is not None:
        walkable |= path_walk
    walkable = clean(walkable, 0, 1, 200)
    print("可通行占比:", round(float(walkable.mean()) * 100, 2))

    buildings = build_buildings(red, orange)
    print("建筑数:", len(buildings))

    # 贴地要素按现有约定也放进 buildings，height_m = 0，渲染时画成贴地薄片
    def add_flat(mask_, kind, name, min_area=200):
        n = 0
        for poly in outline(mask_, 1.6, min_area):
            pts = np.array(poly, np.float32)
            buildings.append({
                "id": f"f{len(buildings):03d}",
                "name": name,
                "kind": kind,
                "height_level": 0,
                "height_m": 0.0,
                "polygon": [[round(float(x), 1), round(float(y), 1)] for x, y in pts],
                "area_m2": round(abs(cv2.contourArea(pts)) * MPP * MPP, 1),
            })
            n += 1
        return n

    # 铺装：校园内部、扣掉道路、绿化、水、森林、操场之后剩下的地面。
    # 图上这部分是不着色的白，用户要的是校园里该有铺装变化
    paved = campus_mask.copy()
    paved &= ~cv2.dilate(road.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    paved &= ~cv2.dilate((grass | water | infield | purple).astype(np.uint8),
                         np.ones((5, 5), np.uint8)).astype(bool)
    paved &= ~cv2.dilate((red | orange).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    paved = clean(paved, 0, 1, 3000)
    add_flat(paved, "plaza", "铺装", 3000)
    print("铺装面积（平方米）:", round(float(paved.mean()) * w * h * MPP * MPP))

    add_flat(water, "water", "水体", 300)
    add_flat(grass, "green", "绿地", 300)
    add_flat(infield, "green", "操场内场", 300)
    add_flat(purple, "sports", "跑道", 300)
    print("贴地要素后合计:", len(buildings))

    # 行道树：沿道路外沿撒点，避开路面与建筑
    road_edge = cv2.dilate(road.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & ~road
    cand = np.argwhere(road_edge & walkable)
    rng = np.random.default_rng(11)
    trees = []
    if len(cand):
        pick = cand[rng.choice(len(cand), min(160, len(cand)), replace=False)]
        trees = [[round(float(x), 1), round(float(y), 1)] for y, x in pick]

    package = {
        "image": {"width": w, "height": h,
                  "source": os.path.basename(SRC)},
        "scale": {"meters_per_px": MPP,
                  "note": "比例尺沿用手工估算的 0.5 米/像素，拿到实测尺寸后改这一处"},
        "zones": {
            "campus": {"polygon": campus_poly,
                       "bbox": [float(np.where(campus_mask)[1].min()), float(np.where(campus_mask)[0].min()),
                                float(np.where(campus_mask)[1].max()), float(np.where(campus_mask)[0].max())],
                       "area_px": float(campus_mask.sum())},
            "road": {"polygon": max(surfaces, key=lambda s: len(s["outer"]))["outer"] if surfaces else [],
                     "bbox": None, "area_px": float(road.sum())},
            "forest": {"polygon": outline(forest, 2.0, 5000)[0] if forest.any() else [],
                       "forests": outline(forest, 2.0, 5000),
                       "bbox": None,
                       "area_px": float(forest.sum())},
            "community": {"polygon": outline(community_mask, 2.0, 5000)[0] if community_mask is not None else [],
                          "bbox": None,
                          "area_px": float(community_mask.sum()) if community_mask is not None else 0},
        },
        "buildings": buildings,
        "roads": {
            "width_m": ROAD_W_M,
            "edge_m": 0.3,
            "surface": surfaces,
            "edge": [],
            "trees": trees,
            "bushes": [],
        },
        "forest_path": {"points": path,
                        "width_m": 6.0,
                        "walk_width_m": 14.0,
                        "polygon": outline(path_walk, 2.0, 200)[0] if path_walk is not None else []},
        "walk_mask": build_walk_mask(walkable),
    }

    # 地铁不在新图上，沿用旧数据包里的地铁区域，地铁页签才能继续用
    old_json = os.path.join(BASE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
    if os.path.exists(old_json):
        old = json.load(open(old_json, encoding="utf-8"))
        if "subway" in old.get("zones", {}):
            sub = dict(old["zones"]["subway"])
            poly = sub.get("polygon") or []
            if poly:
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                cx = (min(xs) + max(xs)) / 2
                cy = (min(ys) + max(ys)) / 2
                # 旧图 1079x1554，新图 1333x1079：旧坐标的 y 直接超出新图幅，
                # 导航格会被填到图画外面，设备、行人、摄像头全部取不到点。
                # 平移到一个空白角落，尺寸保持不变。
                tx, ty = 1150 - cx, 980 - cy
                sub["polygon"] = [[round(x + tx, 1), round(y + ty, 1)] for x, y in poly]
                sub["bbox"] = [min(x for x, _ in sub["polygon"]), min(y for _, y in sub["polygon"]),
                               max(x for x, _ in sub["polygon"]), max(y for _, y in sub["polygon"])]
            package["zones"]["subway"] = sub
            print("沿用旧地铁区域，并平移到新图幅内")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(package, f, ensure_ascii=False, indent=1)

    ground = paint_ground(img.shape, campus_mask, grass, water, forest,
                          infield, purple, community_mask, path_vis if path_vis is not None else np.zeros((h, w), bool))
    cv2.imwrite(OUT_GROUND, ground)

    # 核对图
    prev = img.copy()
    cv2.polylines(prev, [np.array(campus_poly, np.int32)] if campus_poly else [],
                  True, (0, 0, 255), 3)
    if community_mask is not None:
        for p in outline(community_mask, 2.0, 5000):
            cv2.polylines(prev, [np.array(p, np.int32)], True, (255, 0, 255), 3)
    for b in buildings:
        cv2.polylines(prev, [np.array(b["polygon"], np.int32)], True,
                      (0, 255, 255) if b["kind"] == "residential" else (0, 140, 255), 1)
    for s in surfaces:
        cv2.polylines(prev, [np.array(s["outer"], np.int32)], True, (255, 255, 0), 2)
    if path:
        cv2.polylines(prev, [np.array(path, np.int32)], False, (0, 0, 0), 3)
    cv2.imwrite(os.path.join(BASE, "preview_package.png"), prev)

    cls = np.zeros((h, w, 3), np.uint8)
    cls[red] = (40, 60, 200)
    cls[orange] = (60, 150, 225)
    cls[forest] = (100, 120, 60)
    cls[grass] = (90, 190, 140)
    cls[infield] = (105, 150, 95)
    cls[water] = (205, 190, 90)
    cls[purple] = (200, 60, 110)
    cls[road] = (70, 210, 235)
    sel = cls[walkable]
    cls[walkable] = np.where(sel.sum(1)[:, None] == 0, (230, 230, 230), sel)
    cv2.imwrite(os.path.join(BASE, "preview_classes.png"), cls)

    print("写出:", OUT_JSON)
    print("写出:", OUT_GROUND)


if __name__ == "__main__":
    main()
