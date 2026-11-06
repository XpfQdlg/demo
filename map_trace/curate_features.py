# -*- coding: utf-8 -*-
"""整合同色块轮廓，生成语义化的地图要素 JSON、预览图与 SVG。"""
import sys, os, json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# 语义要素定义：source 为原始轮廓 id 或 union 区域名
FEATURES = [
    # id, 名称, 类型, 来源, 填充色, 高度示意(0-5)
    ("north_dorm",       "北区学生公寓",         "residential", "split_green_north", "#7bc043", 3),
    ("west_dorm",        "西区学生公寓及西侧绿地", "residential", "split_green_west",  "#7bc043", 3),
    ("central_plaza",    "中心广场",             "plaza",       "green_008",         "#8fd14f", 0),
    ("east_dorm",        "东区学生公寓",         "residential", "green_010",         "#7bc043", 3),
    ("south_green",      "南部绿地",             "green",       "green_005",         "#7bc043", 0),
    ("teaching_1",       "1号教学楼",            "teaching",    "cyan_021",          "#3fd0d4", 4),
    ("library",          "图书馆",               "teaching",    "cyan_020",          "#3fd0d4", 4),
    ("hospital",         "校医院",               "public",      "cyan_022",          "#3fd0d4", 3),
    ("c1",               "中央院系区 C1",        "teaching",    "cyan_019",          "#3fd0d4", 4),
    ("c2",               "中央院系区 C2",        "teaching",    "cyan_018",          "#3fd0d4", 4),
    ("modern_edu",       "现代教育中心",         "teaching",    "cyan_016",          "#3fd0d4", 3),
    ("water_south",      "南部水体",             "water",       "union_water_south", "#4aa3df", 0),
    ("track_west",       "西田径场",             "sports",      "orange_038",        "#f0a33a", 0),
    ("track_east",       "东田径场",             "sports",      "split_orange_left", "#f0a33a", 0),
    ("gym",              "体育馆",               "sports",      "split_orange_right","#e8952f", 2),
    ("lab_center",       "实验中心区",           "lab",         "red_044",           "#e05a4f", 4),
    ("talent_apartment", "人才公寓",             "residential", "blue_050",          "#3d8ee0", 5),
    ("reserved_sw",      "待建区域（西南）",     "reserved",    "union_reserved_sw", "#f2d43d", 1),
    ("reserved_sc",      "待建区域（南中）",     "reserved",    "union_reserved_sc", "#f2d43d", 1),
    ("reserved_se",      "待建区域（东南）",     "reserved",    "union_reserved_se", "#f2d43d", 1),
]

# 预览图与 SVG 的标签位置覆盖：id -> (短标签, (x, y))
LABELS = {
    "west_dorm":         ("西区学生公寓", (128, 330)),
    "north_dorm":        ("北区学生公寓", (300, 80)),
    "east_dorm":         ("东区学生公寓", (670, 405)),
    "central_plaza":     ("中心广场",     (358, 464)),
    "hospital":          ("校医院",       (291, 158)),
    "teaching_1":        ("1号教学楼",    (355, 260)),
    "library":           ("图书馆",       (357, 351)),
    "c1":                ("中央院系区 C1", (306, 700)),
    "c2":                ("中央院系区 C2", (425, 670)),
    "modern_edu":        ("现代教育中心", (449, 840)),
    "track_west":        ("西田径场",     (208, 380)),
    "track_east":        ("东田径场",     (500, 360)),
    "gym":               ("体育馆",       (588, 360)),
    "lab_center":        ("实验中心区",   (525, 670)),
    "talent_apartment":  ("人才公寓",     (820, 920)),
    "south_green":       ("南部绿地",     (600, 900)),
    "water_south":       ("南部水体",     (382, 1050)),
    "reserved_sw":       ("待建区域（西南）", (250, 1010)),
    "reserved_sc":       ("待建区域（南中）", (570, 1085)),
    "reserved_se":       ("待建区域（东南）", (855, 1085)),
}

def split_polygon(points, w, h, axis, cut, keep):
    """把多边形按水平/垂直线切开，返回最大外轮廓。"""
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [np.array(points, np.int32)], 255)
    if axis == "y":
        if keep == "top":
            mask[cut:, :] = 0
        else:
            mask[:cut, :] = 0
    else:
        if keep == "left":
            mask[:, cut:] = 0
        else:
            mask[:, :cut] = 0
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    cnt = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(cnt, 2.0, True)
    return [[int(p[0][0]), int(p[0][1])] for p in approx]

def main():
    src = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    raw = json.load(open(os.path.join(out_dir, "map_contours.json"), encoding="utf-8"))
    unions = {r["name"]: r["points"] for r in json.load(open(os.path.join(out_dir, "union_regions.json"), encoding="utf-8"))}
    by_id = {r["id"]: r for r in raw["contours"]}
    w, h = raw["image"]["width"], raw["image"]["height"]

    split_cache = {}
    def get_points(source):
        if source in split_cache:
            return split_cache[source]
        if source.startswith("split_green_"):
            pts = split_polygon(by_id["green_012"]["points"], w, h, "y", 150, "top" if source.endswith("north") else "bottom")
        elif source.startswith("split_orange_"):
            pts = split_polygon(by_id["orange_039"]["points"], w, h, "x", 550, "left" if source.endswith("left") else "right")
        elif source.startswith("union_"):
            pts = unions.get(source[6:], [])
        else:
            pts = by_id[source]["points"]
        split_cache[source] = pts
        return pts

    features = []
    for fid, name, kind, source, color, height in FEATURES:
        pts = get_points(source)
        if len(pts) < 3:
            print("skip", fid, source)
            continue
        area = abs(cv2.contourArea(np.array(pts, np.int32)))
        x, y, bw, bh = cv2.boundingRect(np.array(pts, np.int32))
        M = cv2.moments(np.array(pts, np.int32))
        cx = M["m10"]/M["m00"] if M["m00"] else x+bw/2
        cy = M["m01"]/M["m00"] if M["m00"] else y+bh/2
        label, label_pos = LABELS.get(fid, (name, (round(cx), round(cy))))
        features.append({
            "id": fid, "name": name, "kind": kind, "source": source,
            "color": color, "height_level": height,
            "area_px": round(area, 1),
            "bbox": [int(x), int(y), int(bw), int(bh)],
            "centroid": [round(cx, 1), round(cy, 1)],
            "label": label,
            "label_pos": [int(label_pos[0]), int(label_pos[1])],
            "points": pts,
        })

    # 校园外轮廓：把所有要素栅格化后取最大外轮廓
    campus = np.zeros((h, w), np.uint8)
    for f in features:
        cv2.fillPoly(campus, [np.array(f["points"], np.int32)], 255)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    campus = cv2.morphologyEx(campus, cv2.MORPH_CLOSE, k, iterations=2)
    contours, _ = cv2.findContours(campus, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        cnt = max(contours, key=cv2.contourArea)
        approx = cv2.approxPolyDP(cnt, 3.0, True)
        campus_pts = [[int(p[0][0]), int(p[0][1])] for p in approx]
    else:
        campus_pts = []

    result = {
        "image": raw["image"],
        "coordinate_system": "像素坐标，左上角为原点，x 向右，y 向下",
        "height_note": "height_level 为 0-5 的相对高度示意，不是真实米数",
        "campus_boundary": campus_pts,
        "features": features,
    }
    with open(os.path.join(out_dir, "map_features.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 预览图：半透明填充 + 中文名称
    base = Image.open(src).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0,0,0,0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
    font_small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 12)
    for f in features:
        pts = [tuple(p) for p in f["points"]]
        color = f["color"]
        rgb = tuple(int(color[i:i+2], 16) for i in (1,3,5))
        draw.polygon(pts, fill=rgb + (70,), outline=rgb + (255,))
        draw.line(pts + [pts[0]], fill=rgb + (255,), width=2)
        cx, cy = f.get("label_pos", f["centroid"])
        text = f.get("label", f["name"])
        bbox = draw.textbbox((0,0), text, font=font)
        tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
        draw.rectangle([cx-tw/2-3, cy-th/2-2, cx+tw/2+3, cy+th/2+3], fill=(255,255,255,220))
        draw.text((cx-tw/2, cy-th/2-1), text, font=font, fill=(20,20,20,255))
    # 校园外轮廓
    if campus_pts:
        draw.line([tuple(p) for p in campus_pts] + [tuple(campus_pts[0])], fill=(20,20,20,255), width=3)
    out_img = Image.alpha_composite(base, overlay)
    out_img.convert("RGB").save(os.path.join(out_dir, "trace_clean.png"))
    print("features", len(features), "campus points", len(campus_pts))
    for f in features:
        print(f'{f["id"]:18s} {f["name"]:12s} area={f["area_px"]:9.1f} bbox={f["bbox"]}')

if __name__ == "__main__":
    main()
