# -*- coding: utf-8 -*-
"""
build_map_package.py —— 把新图的区域与原图的建筑合成一套 3D 场景数据包

输入：
    0f0f59a3491b758639b24555e87dc91c.jpg   新图，1079 × 1554，提供区域轮廓与道路
    ../out/map_features.json               原图提取结果，提供 20 个建筑的轮廓与高度档

关键发现：
    两张图不是严格几何一致的重绘，但**校园包围盒**对应得很好。
    按包围盒做相似变换后，人才公寓正好落在新图的品红框内，
    教学楼、图书馆、田径场也都落在道路围合出的地块里。
    因此用包围盒变换迁移建筑是可靠的。

输出：
    map_package.json   3D 场景数据，坐标为新图像素
    walk_mask.png      可行走掩膜（1/4 分辨率），供前端 A* 使用
"""

import base64
import json
import os

import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
NEW_IMG = os.path.join(BASE, "..", "0f0f59a3491b758639b24555e87dc91c.jpg")
OLD_FEATURES = os.path.join(BASE, "..", "out", "map_features.json")
ZONES = os.path.join(BASE, "map_zones.json")
ROADS = os.path.join(BASE, "map_roads.json")
CLIPPED = os.path.join(BASE, "buildings_clipped.json")

# 高度档位 → 米。档位是相对示意，不是实测楼层
HEIGHT_M = {0: 0.0, 1: 4.0, 2: 8.0, 3: 14.0, 4: 20.0, 5: 26.0}

# 比例尺假设：新图 1 像素 = 0.5 米。
# 校园东西向 908 像素约 454 米，南北向 1172 像素约 586 米。
# 这是估算值，拿到实测尺寸后只改这一处。
METERS_PER_PX = 0.5

MASK_DIV = 4  # 行走掩膜降采样倍数

# 提取时按色相命名，和实际语义对不上，这里统一改正：
#   品红闭合圈  = 小区（人才公寓一带，和学校联通）
#   棕色实心块  = 地铁站（单独建）
ZONE_RENAME = {"subway_area": "community", "unknown_brown": "subway"}


def fit_transform(old_boundary, new_bbox):
    """按校园包围盒求相似变换：旧图全分辨率坐标 → 新图像素坐标"""
    b = np.asarray(old_boundary, float) * 2.0  # 旧数据边界存的是半分辨率
    ox0, oy0 = b[:, 0].min(), b[:, 1].min()
    ox1, oy1 = b[:, 0].max(), b[:, 1].max()

    nx0, ny0, nx1, ny1 = new_bbox
    sx = (nx1 - nx0) / (ox1 - ox0)
    sy = (ny1 - ny0) / (oy1 - oy0)
    s = (sx + sy) / 2.0
    tx = nx0 - ox0 * s
    ty = ny0 - oy0 * s
    return s, tx, ty


def main():
    zones = json.load(open(ZONES, encoding="utf-8"))
    old = json.load(open(OLD_FEATURES, encoding="utf-8"))

    campus_bbox = zones["zones"]["campus"]["bbox"]
    s, tx, ty = fit_transform(old["campus_boundary"], campus_bbox)
    print(f"变换：缩放 {s:.4f}  平移 ({tx:.1f}, {ty:.1f})")

    # ── 建筑：迁移坐标 ────────────────────────────────────────────────
    buildings = []
    for f in old["features"]:
        pts = np.asarray(f["points"], float) * s + [tx, ty]
        if len(pts) < 3:
            continue
        level = int(f.get("height_level", 0))
        buildings.append(
            {
                "id": f["id"],
                "name": f["name"],
                "kind": f["kind"],
                "height_level": level,
                "height_m": HEIGHT_M.get(level, 8.0),
                "polygon": [[round(float(x), 1), round(float(y), 1)] for x, y in pts],
            }
        )
    print(f"建筑 {len(buildings)} 栋")

    # ── 用裁边结果替换建筑轮廓 ────────────────────────────────────────
    # build_roads.py 已经把压到路面上的建筑部分切掉了，这里优先用它，
    # 保证 3D 里的墙不会插进路面。
    if os.path.exists(CLIPPED):
        clipped = json.load(open(CLIPPED, encoding="utf-8"))
        if clipped:
            buildings = clipped
            print(f"已套用裁边建筑：{len(buildings)} 块")

    # ── 道路 ──────────────────────────────────────────────────────────
    roads = None
    if os.path.exists(ROADS):
        roads = json.load(open(ROADS, encoding="utf-8"))
        print(f"道路：路面 {len(roads['surface'])} 个多边形，行道树 {len(roads['trees'])} 棵")

    src = cv2.imread(NEW_IMG)
    H, W = src.shape[:2]
    hsv_cache = cv2.cvtColor(src, cv2.COLOR_BGR2HSV)
    mh, mw = H // MASK_DIV, W // MASK_DIV

    # 路面掩膜：道路在 3D 里是独立网格，行走时算可通行，同时底图上不画它
    road_mask = np.zeros((H, W), np.uint8)
    if roads:
        # 注意：循环变量不能叫 s，下面还要用相似变换的缩放系数 s
        for shape in roads["surface"]:
            cv2.fillPoly(road_mask, [np.asarray(shape["outer"], np.int32)], 255)
            for hole in shape["holes"]:
                cv2.fillPoly(road_mask, [np.asarray(hole, np.int32)], 0)

    # ── 行走掩膜 ──────────────────────────────────────────────────────
    walk = np.zeros((H, W), np.uint8)
    campus = np.asarray(zones["zones"]["campus"]["polygon"], np.int32)
    cv2.fillPoly(walk, [campus], 255)

    # 建筑占地区域按 2 米余量外扩后挖掉，避免机器狗贴着墙走
    clearance_px = int(2.0 / METERS_PER_PX)
    for b in buildings:
        poly = np.asarray(b["polygon"], np.int32)
        cv2.fillPoly(walk, [poly], 0)
        cv2.polylines(walk, [poly], True, 0, clearance_px * 2)

    # 森林、地铁站区域不参与校园内部行走
    for key in ("forest", "subway_area"):
        if key in zones["zones"]:
            poly = np.asarray(zones["zones"][key]["polygon"], np.int32)
            cv2.fillPoly(walk, [poly], 0)

    # 道路本身一定可走，覆盖掉建筑退让多挖掉的那一圈
    walk = cv2.bitwise_or(walk, road_mask)

    mask_small = cv2.resize(walk, (mw, mh), interpolation=cv2.INTER_NEAREST)
    ok = int(mask_small.sum() / 255)
    print(f"行走掩膜 {mw}×{mh}，可行走格 {ok}（{ok / (mw * mh) * 100:.1f}%）")

    # ── 地面贴图 ──────────────────────────────────────────────────────
    # 3D 里的地面直接用这张图。道路现在是独立网格，底图上不再画路，
    # 否则会出现「贴图上的路」和「几何体的路」两条边对不齐的重影。
    ground = np.full((H, W, 3), (34, 30, 28), np.uint8)  # 底色：图幅外，深灰近黑（BGR）

    def fill_zone(key, color_bgr):
        if key in zones["zones"]:
            poly = np.asarray(zones["zones"][key]["polygon"], np.int32)
            cv2.fillPoly(ground, [poly], color_bgr)

    # 颜色均按 BGR 写。注释里的 RGB 是人读的值。
    fill_zone("campus", (108, 110, 112))       # 校园铺地：中灰混凝土，RGB(112,110,108)
    fill_zone("forest", (58, 118, 62))         # 森林：草绿偏深，RGB(62,118,58)
    fill_zone("unknown_brown", (62, 60, 66))   # 地铁站区域：深灰，RGB(66,60,62)

    # 绿地（南部绿地等）：草绿，RGB(96,140,70)
    green_mask = cv2.inRange(hsv_cache, np.array([40, 60, 60]), np.array([85, 255, 255]))
    ground[green_mask > 0] = (70, 140, 96)

    cv2.imwrite(os.path.join(BASE, "ground.png"), ground)
    print("已输出 ground.png")

    # ── 打包 ──────────────────────────────────────────────────────────
    package = {
        "image": {"width": W, "height": H, "source": os.path.basename(NEW_IMG)},
        "scale": {
            "meters_per_px": METERS_PER_PX,
            "note": "比例尺为估算值，拿到实测尺寸后改这一处",
        },
        "transform_from_original": {"scale": round(s, 4), "tx": round(tx, 1), "ty": round(ty, 1)},
        "zones": {
            ZONE_RENAME.get(name, name): {
                "polygon": z["polygon"],
                "bbox": z["bbox"],
                "area_px": z["polygon_area_px"],
            }
            for name, z in zones["zones"].items()
        },
        "buildings": buildings,
        # 道路几何体：前端按多边形直接建网格，黑色路面 + 白色边线
        "roads": (
            {
                "width_m": roads["width_m"],
                "edge_m": roads["edge_m"],
                "surface": roads["surface"],
                "edge": roads["edge"],
                "trees": roads["trees"],
                "bushes": roads.get("bushes", []),
            }
            if roads
            else None
        ),
        "walk_mask": {
            "width": mw,
            "height": mh,
            "div": MASK_DIV,
            # 位打包后 base64，前端可直接同步解码做 A*，不必等图片加载
            "bits": base64.b64encode(np.packbits(mask_small > 0).tobytes()).decode("ascii"),
        },
    }

    out_json = os.path.join(BASE, "map_package.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(package, f, ensure_ascii=False)

    cv2.imwrite(os.path.join(BASE, "walk_mask.png"), mask_small)
    print(f"已输出 {out_json}")
    print(f"已输出 {os.path.join(BASE, 'walk_mask.png')}")


if __name__ == "__main__":
    main()
