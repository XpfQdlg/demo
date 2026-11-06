#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_scene_extra —— 生成三个场景的补充数据包

输入：
    ../command_demo/src/map/data/map_package.json   现有地图数据（校园、区域、道路）
    ../../A85B...jpg                                嘉陵江路校区总平面图（山体走向参考）
    ../../e7ea...png                                卫星图（小区 理工嘉苑 排布参考）

输出：
    ../../command_demo/src/map/data/scene_extra.json
    preview_extra.png                               核对图

三块内容：
    community  小区：环形路 + 中轴路 + 行列住宅楼 + 门岗 + 车棚
    hills      东西两座山：多边形轮廓（已挖掉校园）+ 山脊 + 峰高
    subway     地铁站：站台、轨道、列车的几何参数

坐标一律像素坐标，1 像素 = 0.5 米。理由见 command_demo/INDEX.md 第五节。
"""

import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PKG_PATH = os.path.join(ROOT, "command_demo", "src", "map", "data", "map_package.json")
OUT_PATH = os.path.join(ROOT, "command_demo", "src", "map", "data", "scene_extra.json")
PREVIEW_PATH = os.path.join(HERE, "preview_extra.png")


# ── 基础工具 ───────────────────────────────────────────────────────────


def poly_area(pts):
    """鞋带公式，只用来判断轮廓是否够大"""
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def to_local(pts, origin, u_axis, v_axis, mpp):
    """像素 → 局部米制坐标。u 沿小区长边，v 与之垂直"""
    ox, oy = origin
    ux, uy = u_axis
    vx, vy = v_axis
    out = []
    for x, y in pts:
        dx = (x - ox) * mpp
        dy = (y - oy) * mpp
        out.append((dx * ux + dy * uy, dx * vx + dy * vy))
    return out


def to_px(pt_uv, origin, u_axis, v_axis, mpp):
    """局部米制坐标 → 像素"""
    u, v = pt_uv
    x = origin[0] + (u * u_axis[0] + v * v_axis[0]) / mpp
    y = origin[1] + (u * u_axis[1] + v * v_axis[1]) / mpp
    return [round(x, 1), round(y, 1)]


def rect_uv(uc, vc, w, d, angle_deg=0.0):
    """局部坐标里的矩形（中心、宽、深、绕中心旋转角），返回四角"""
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for du, dv in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        pts.append((uc + du * ca - dv * sa, vc + du * sa + dv * ca))
    return pts


def point_in_poly(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ── 小区布局 ───────────────────────────────────────────────────────────

def largest_inscribed_rect(poly, step=0.5):
    """在局部坐标里找最大的轴对齐内接矩形（返回 u0,v0,u1,v1）。
    小区多边形有不规则凹口，内缩法会在凹角甩出尖刺或自交，
    直接暴力搜一个四角都在界内的矩形最稳，代价是几十万次判内，施工期跑一次足够。"""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)

    best = None
    best_area = 0.0
    for w in np.arange(x1 - x0, 4.0, -step * 2):
        for h in np.arange(y1 - y0, 4.0, -step * 2):
            area = w * h
            if area <= best_area:
                break  # h 继续变小面积只会更小
            for uc in np.arange(x0 + w / 2, x1 - w / 2 + step, step * 2):
                for vc in np.arange(y0 + h / 2, y1 - h / 2 + step, step * 2):
                    corners = [
                        (uc - w / 2, vc - h / 2), (uc + w / 2, vc - h / 2),
                        (uc + w / 2, vc + h / 2), (uc - w / 2, vc + h / 2),
                    ]
                    if all(point_in_poly(c, poly) for c in corners):
                        if area > best_area:
                            best_area = area
                            best = (uc - w / 2, vc - h / 2, uc + w / 2, vc + h / 2)
                        break
                else:
                    continue
                break
    return best


def ribbon_points(points, half_w, closed=True):
    """把折线加宽成环带，与前端 ribbon_polygon 同一套算法。
    注意：这里的 points 是局部米制坐标，half_w 也是米，不再做像素换算。
    拐角用前后两段的平均方向做法线，与前端一致，斜接外扩量才查得准。"""
    n = len(points)
    left, right = [], []
    for i in range(n):
        prev = points[(i - 1) % n] if closed else points[max(0, i - 1)]
        nxt = points[(i + 1) % n] if closed else points[min(n - 1, i + 1)]
        dx, dy = nxt[0] - prev[0], nxt[1] - prev[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * half_w, dx / L * half_w
        left.append((points[i][0] + nx, points[i][1] + ny))
        right.append((points[i][0] - nx, points[i][1] - ny))
    return left + right[::-1]


def erode_polygon(poly, meters, mpp, scale=0.5):
    """多边形向内腐蚀，返回简化后的轮廓（像素坐标）。

    为什么不用几何内缩：小区轮廓有凹口和斜边，几何内缩会在凹角甩出尖刺
    或自交（之前试过两次都失败）。栅格腐蚀没有这个问题，
    任意形状都稳，代价是边界精度约一格。
    """
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    pad = 40
    w = int((max(xs) - min(xs)) / scale + pad * 2)
    h = int((max(ys) - min(ys)) / scale + pad * 2)
    ox, oy = min(xs), min(ys)

    mask = np.zeros((h, w), np.uint8)
    pts = np.array([[int((x - ox) / scale) + pad, int((y - oy) / scale) + pad] for x, y in poly], np.int32)
    cv2.fillPoly(mask, [pts], 255)

    # 腐蚀半径按像素算：米 / 比例尺 / 栅格比例
    r = int(round(meters / mpp / scale))
    if r > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1))
        mask = cv2.erode(mask, k)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(c, 2.0, True)
    return [[(float(pt[0]) - pad) * scale + ox, (float(pt[1]) - pad) * scale + oy]
            for pt in approx.reshape(-1, 2)]


def build_community(pkg):
    mpp = pkg["scale"]["meters_per_px"]
    poly = pkg["zones"]["community"]["polygon"]

    # 主方向：取最长边作 u 轴
    n = len(poly)
    best = (0, 0, (1.0, 0.0))
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        d = math.hypot(x2 - x1, y2 - y1)
        if d > best[0]:
            best = (d, i, ((x2 - x1) / d, (y2 - y1) / d))
    u_axis = best[2]
    v_axis = (-u_axis[1], u_axis[0])

    cx = sum(p[0] for p in poly) / n
    cy = sum(p[1] for p in poly) / n

    local = to_local(poly, origin=(cx, cy), u_axis=u_axis, v_axis=v_axis, mpp=mpp)
    umin = min(p[0] for p in local); umax = max(p[0] for p in local)
    vmin = min(p[1] for p in local); vmax = max(p[1] for p in local)
    uc = (umin + umax) / 2
    vc = (vmin + vmax) / 2

    # 环路：离边界 9 米；楼栋可占：离边界 26 米
    ring_px = erode_polygon(poly, 9.0, mpp)
    inner_px = erode_polygon(poly, 26.0, mpp)
    if ring_px is None or inner_px is None:
        ring_px, inner_px = poly, poly

    ring_uv = to_local(ring_px, (cx, cy), u_axis, v_axis, mpp)
    inner_uv = to_local(inner_px, (cx, cy), u_axis, v_axis, mpp)

    iu = [p[0] for p in inner_uv]; iv = [p[1] for p in inner_uv]
    iu0, iu1 = min(iu), max(iu)
    iv0, iv1 = min(iv), max(iv)

    # 中轴：过场地中心，沿 u 方向贯穿 inner
    spine_v = (iv0 + iv1) / 2
    spine = [(iu0 + 2, spine_v), (iu1 - 2, spine_v)]

    roads_uv = [
        {"points": ring_uv + [ring_uv[0]], "width_m": 6.5, "closed": False},
        {"points": spine, "width_m": 5.5, "closed": False},
    ]

    # 住宅楼：中轴上下各两排，每排三栋
    bw, bd, bh = 26.0, 11.0, 17.0
    rows = [spine_v + 13.0, spine_v + 30.0, spine_v - 13.0, spine_v - 30.0]
    cols = [iu0 + (iu1 - iu0) * f for f in (0.22, 0.5, 0.78)]

    buildings = []
    for r_i, row_v in enumerate(rows):
        for s_i, u in enumerate(cols):
            corners = rect_uv(u, row_v, bw, bd, 0)
            if not all(point_in_poly(p, inner_uv) for p in corners):
                continue
            side = "north" if row_v > spine_v else "south"
            buildings.append({
                "id": f"cm-{side}-{r_i + 1}-{s_i + 1}",
                "polygon": [to_px(p, (cx, cy), u_axis, v_axis, mpp) for p in corners],
                "height_m": bh + (r_i % 2) * 3,
                "kind": "residential",
                "floors": 5 + (r_i % 2),
            })

    # 门岗：环路西侧中点；车棚：东南角
    gate_px = to_px((iu0 - 4.0, spine_v), (cx, cy), u_axis, v_axis, mpp)
    gate = {
        "x": round(gate_px[0], 1),
        "y": round(gate_px[1], 1),
        "heading": round(math.atan2(u_axis[0], u_axis[1]), 4),
    }

    shed_poly = rect_uv(iu1 - 12.0, iv0 + 7.0, 22, 5)
    shed = {
        "polygon": [to_px(p, (cx, cy), u_axis, v_axis, mpp) for p in shed_poly],
        "height_m": 2.6,
        "in_zone": all(point_in_poly(p, local) for p in shed_poly),
    }

    return {
        "outline": poly,
        "frame": {
            "origin": [round(cx, 1), round(cy, 1)],
            "u": [round(u_axis[0], 4), round(u_axis[1], 4)],
            "v": [round(v_axis[0], 4), round(v_axis[1], 4)],
            "size_m": [round(umax - umin, 1), round(vmax - vmin, 1)],
        },
        "roads": [
            {
                "points": [to_px(p, (cx, cy), u_axis, v_axis, mpp) for p in r["points"]],
                "width_m": r["width_m"],
                "closed": r["closed"],
            }
            for r in roads_uv
        ],
        "buildings": buildings,
        "gate": gate,
        "shed": shed,
    }


# ── 山体 ───────────────────────────────────────────────────────────────

# 手工描的粗轮廓（像素坐标），只求走向对，细节靠 3D 里的高度场补。
# 西山：校园西侧。东边界收到 x≈205，山脚与校园之间留出空地。
WEST_ROUGH = [
    [-40, 560], [40, 600], [100, 660], [118, 720], [112, 790],
    [180, 800], [205, 880], [205, 980], [195, 1080], [160, 1160],
    [95, 1210], [30, 1210], [-40, 1150], [-60, 900], [-60, 700],
]

# 东山：校园东侧与东北角，地形一直铺到图幅外
EAST_ROUGH = [
    [700, 120], [880, 90], [1080, 110], [1180, 260], [1180, 520],
    [1120, 700], [1030, 860], [920, 940], [840, 900], [800, 760],
    [780, 560], [740, 380], [690, 240],
]


def subtract_polygon(rough, campus, scale=0.5):
    """用栅格法从 rough 里挖掉 campus，返回若干简化后的轮廓（像素坐标）"""
    w = int(round(1180 / scale)) + 4
    h = int(round(1560 / scale)) + 4
    off = 2

    def to_mask(pts):
        m = np.zeros((h, w), np.uint8)
        arr = np.array([[int(round(x / scale)) + off, int(round(y / scale)) + off] for x, y in pts], np.int32)
        cv2.fillPoly(m, [arr], 255)
        return m

    m_rough = to_mask(rough)
    m_campus = to_mask(campus)
    m = cv2.bitwise_and(m_rough, cv2.bitwise_not(m_campus))

    # 山体贴着校园，挖掉后边角会有毛刺，先闭运算再取轮廓
    k = np.ones((5, 5), np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)

    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        if cv2.contourArea(c) < (60 / scale) ** 2:
            continue
        eps = 2.0 / scale * 0.5
        approx = cv2.approxPolyDP(c, eps, True)
        pts = []
        for pt in approx.reshape(-1, 2):
            x = (pt[0] - off) * scale
            y = (pt[1] - off) * scale
            pts.append([round(float(x), 1), round(float(y), 1)])
        if len(pts) >= 4:
            out.append(pts)
    out.sort(key=poly_area, reverse=True)
    return out


def build_forest_site(pkg, hills):
    """西山上的巡检场地：山腰平台 + 朝山的站位。

    西山轮廓东西向 -1..300、南北向 580..1210 像素（约 150 × 315 米）。
    空地取轮廓内部偏东南的一块（x 150..250、y 900..1010），
    这一带在山的东麓，既能看见主峰，又不压校园（校园西边界在 x≈318）。
    """
    campus = pkg["zones"]["campus"]["polygon"]
    west = next((h for h in hills if h["side"] == "west"), None)
    if not west:
        return None

    poly = west["polygon"]
    # 空地整块落在山体东侧之外（山体东边界 x≈205，校园西边界 x≈318），
    # 不与山体重叠，压平只作用于平地，山坡保持完整。
    clearing = [[212, 892], [300, 892], [300, 1012], [212, 1012]]

    # 万一压到校园就往西退
    shift = 0.0
    while any(point_in_poly(p, campus) for p in clearing) and shift < 160:
        shift += 4.0
        clearing = [[p[0] - shift, p[1]] for p in clearing]

    cx = sum(p[0] for p in clearing) / 4
    cy = sum(p[1] for p in clearing) / 4

    # 站位在空地东侧边缘，面朝西山主峰。
    # 实体前向是 +Z（世界），偏航用 atan2(dx, dz)，dx/dz 都是「目标 - 站位」。
    sx, sy = cx + 26, cy + 10
    rx, ry = 95.0, 900.0   # 山脊中段的像素坐标
    heading = math.atan2(rx - sx, ry - sy)

    return {
        "hill_id": west["id"],
        "clearing": [[round(x, 1), round(y, 1)] for x, y in clearing],
        "site": {"x": round(sx, 1), "y": round(sy, 1), "heading": round(heading, 4)},
        "ridge": west["ridge"],
        "peak_m": west["peak_m"],
        # 过渡带 45 米：空地边缘抬升平缓，抬头能看见完整山坡
        "flatten_smooth": 45.0,
    }


def build_hills(pkg):
    campus = pkg["zones"]["campus"]["polygon"]

    hills = []
    for hid, rough, peak, ridge in (
        ("west", WEST_ROUGH, 46.0, [[60, 980], [95, 860], [80, 740], [30, 660]]),
        ("east", EAST_ROUGH, 58.0, [[980, 380], [1010, 300], [1050, 220], [1080, 160]]),
    ):
        parts = subtract_polygon(rough, campus)
        for i, poly in enumerate(parts):
            hills.append({
                "id": f"{hid}-{i + 1}",
                "side": hid,
                "polygon": poly,
                "peak_m": peak if i == 0 else round(peak * 0.6, 1),
                "ridge": ridge,
                "roughness": 0.35 if hid == "west" else 0.42,
            })
    return hills


# ── 地铁 ───────────────────────────────────────────────────────────────

def build_subway(pkg):
    mpp = pkg["scale"]["meters_per_px"]
    brown = pkg["zones"]["subway"]["polygon"]
    xs = [p[0] for p in brown]
    ys = [p[1] for p in brown]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)

    return {
        # 站厅尺寸，米。长轴沿东西向
        "hall": {
            "length_m": round((x1 - x0) * mpp, 1),
            "depth_m": round((y1 - y0) * mpp, 1),
            "height_m": 6.0,
        },
        # 岛式站台：居中，两侧各一条轨道
        "platform": {
            "width_m": 12.0,
            "height_m": 0.9,
            "edge_band_m": 1.2,      # 黄色安全线带宽
            "tactile_m": 0.5,        # 盲道宽
            "stop_line_m": 0.25,     # 停止线宽
            "stop_line_from_end_m": 6.0,
        },
        "track": {
            "width_m": 4.4,
            "gauge_m": 1.435,
            "rail_h_m": 0.16,
            "sleep_step_m": 1.3,
        },
        # 列车：进站停靠再出站，周期 30 秒，停 8 秒
        # approach_m 是单侧进站距离，等于「到站台端头 + 车长」。
        # 站台长 173 米、车长 6 × 22 + 5 × 0.6 = 135 米，取 260 米足够，
        # 再大车会长时间停在画面外，看起来像没车
        "train": {
            "cars": 4,
            "car_len_m": 20.0,
            "car_gap_m": 0.6,
            "width_m": 3.0,
            "height_m": 3.5,
            "cycle_s": 30.0,
            "dwell_s": 8.0,
            "approach_m": 260.0,
            "max_speed_mps": 16.0,
        },
    }


# ── 核对图 ─────────────────────────────────────────────────────────────

def draw_preview(pkg, extra):
    W, H = pkg["image"]["width"], pkg["image"]["height"]
    canvas = np.full((H, W, 3), 24, np.uint8)

    def fill(poly, color, alpha=1.0):
        arr = np.array([[int(round(x)), int(round(y))] for x, y in poly], np.int32)
        if alpha >= 1.0:
            cv2.fillPoly(canvas, [arr], color)
        else:
            layer = canvas.copy()
            cv2.fillPoly(layer, [arr], color)
            cv2.addWeighted(layer, alpha, canvas, 1 - alpha, 0, canvas)

    fill(pkg["zones"]["campus"]["polygon"], (72, 72, 78))
    for h in extra["hills"]:
        fill(h["polygon"], (60, 110, 60) if h["side"] == "west" else (52, 92, 58))
    fill(pkg["zones"]["community"]["polygon"], (60, 50, 82))

    cm = extra["community"]
    for r in cm["roads"]:
        pts = np.array([[int(x), int(y)] for x, y in r["points"]], np.int32)
        cv2.polylines(canvas, [pts], r["closed"], (210, 210, 120), max(1, int(r["width_m"] / pkg["scale"]["meters_per_px"])))

    for b in cm["buildings"]:
        fill(b["polygon"], (200, 200, 190))

    g = cm["gate"]
    cv2.circle(canvas, (int(g["x"]), int(g["y"])), 5, (60, 60, 230), -1)

    for h in extra["hills"]:
        for x, y in h["polygon"]:
            cv2.circle(canvas, (int(x), int(y)), 2, (120, 200, 120), -1)

    cv2.imwrite(PREVIEW_PATH, canvas)
    print("核对图:", PREVIEW_PATH)


# ── 主流程 ─────────────────────────────────────────────────────────────

def main():
    with open(PKG_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    extra = {
        "_note": "由 map_trace/newmap2/build_scene_extra.py 生成。坐标单位像素，1 像素 = 0.5 米。",
        "community": build_community(pkg),
        "hills": build_hills(pkg),
        "subway": build_subway(pkg),
    }
    extra["forest"] = build_forest_site(pkg, extra["hills"])

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(extra, f, ensure_ascii=False, separators=(",", ":"))

    print("输出:", OUT_PATH)
    print("小区楼栋:", len(extra["community"]["buildings"]))
    for h in extra["hills"]:
        print(f"  山体 {h['id']}: {len(h['polygon'])} 点, 面积 {poly_area(h['polygon']):.0f} px2")
    draw_preview(pkg, extra)


if __name__ == "__main__":
    main()
