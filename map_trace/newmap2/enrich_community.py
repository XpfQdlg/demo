#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
enrich_community —— 在扩大后的小区轮廓里重新排布楼栋与内部道路

背景：
    expand_community.py 把小区的范围扩到了 19707 平方米（原来 7746），
    但 build_scene_extra.py 里的排布逻辑还是「中轴上下各两排、每排三栋」，
    扩出来的东侧与南侧全是空地，3D 里看就是一片草坪上孤零零六栋楼。

做法：
    1. 沿轮廓向内腐蚀 24 米，得到「可建区」——环路占 9 米，剩下的留作宅间绿地
    2. 在可建区里按 42 × 12 米的板楼、52 × 32 米的网格贪心摆放，
       四角与四边中点都必须落在可建区内，保证不会压到路或越界
    3. 内部道路：一条东西主路 + 两条南北支路，端头接到环路上
    4. 附带几块场地（篮球场、健身区）和停车场，交给前端铺地面与摆道具

只改写 scene_extra.json 的 community 字段，其余字段原样保留。

用法：
    python enrich_community.py
"""

import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRA_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "scene_extra.json")
)
PKG_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
)

RING_INSET = 9.0        # 环路中心线离小区边界
RING_W = 6.5            # 环路宽度
BUILD_INSET = 20.0      # 可建区离边界
ROAD_W = 5.5            # 内部道路宽度

SLAB_W = 36.0           # 板楼长边
SLAB_D = 12.0           # 板楼进深
PITCH_U = 44.0          # 沿 u 方向的网格间距（楼长 + 8 米山墙间距）
PITCH_V = 30.0          # 沿 v 方向的网格间距（楼深 + 18 米宅间绿地）


def to_local(pts, origin, u_axis, v_axis, mpp):
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
    u, v = pt_uv
    x = origin[0] + (u * u_axis[0] + v * v_axis[0]) / mpp
    y = origin[1] + (u * u_axis[1] + v * v_axis[1]) / mpp
    return [round(x, 1), round(y, 1)]


def rect_uv(uc, vc, w, d):
    return [
        (uc - w / 2, vc - d / 2), (uc + w / 2, vc - d / 2),
        (uc + w / 2, vc + d / 2), (uc - w / 2, vc + d / 2),
    ]


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


def rect_inside(rect, poly):
    """四角 + 四边中点都在多边形内。只看四角的话，斜边上容易漏掉凸出去的边。"""
    pts = list(rect)
    for i in range(4):
        a, b = rect[i], rect[(i + 1) % 4]
        pts.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
    return all(point_in_poly(p, poly) for p in pts)


def erode_polygon(poly, meters, mpp, scale=0.5):
    """栅格腐蚀，返回像素坐标下的内缩轮廓"""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    pad = 40
    w = int((max(xs) - min(xs)) / scale + pad * 2)
    h = int((max(ys) - min(ys)) / scale + pad * 2)
    ox, oy = min(xs), min(ys)

    mask = np.zeros((h, w), np.uint8)
    pts = np.array([[int((x - ox) / scale) + pad, int((y - oy) / scale) + pad] for x, y in poly], np.int32)
    cv2.fillPoly(mask, [pts], 255)

    r = int(round(meters / mpp / scale))
    if r > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r * 2 + 1, r * 2 + 1))
        mask = cv2.erode(mask, k)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(c, 1.5, True)
    return [[(float(pt[0]) - pad) * scale + ox, (float(pt[1]) - pad) * scale + oy]
            for pt in approx.reshape(-1, 2)]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(PKG_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)
    with open(EXTRA_PATH, "r", encoding="utf-8") as f:
        extra = json.load(f)

    mpp = pkg["scale"]["meters_per_px"]
    poly = pkg["zones"]["community"]["polygon"]

    # 主方向取最长边
    n = len(poly)
    best = (0.0, (1.0, 0.0))
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        d = math.hypot(x2 - x1, y2 - y1)
        if d > best[0]:
            best = (d, ((x2 - x1) / d, (y2 - y1) / d))
    u_axis = best[1]
    v_axis = (-u_axis[1], u_axis[0])

    cx = sum(p[0] for p in poly) / n
    cy = sum(p[1] for p in poly) / n
    origin = (cx, cy)

    local = to_local(poly, origin, u_axis, v_axis, mpp)
    umin = min(p[0] for p in local); umax = max(p[0] for p in local)
    vmin = min(p[1] for p in local); vmax = max(p[1] for p in local)

    ring_px = erode_polygon(poly, RING_INSET, mpp)
    build_px = erode_polygon(poly, BUILD_INSET, mpp)
    ring_uv = to_local(ring_px, origin, u_axis, v_axis, mpp)
    build_uv = to_local(build_px, origin, u_axis, v_axis, mpp)

    bu = [p[0] for p in build_uv]; bv = [p[1] for p in build_uv]
    bu0, bu1 = min(bu), max(bu)
    bv0, bv1 = min(bv), max(bv)

    print(f"可建区 u [{bu0:.0f}, {bu1:.0f}]  v [{bv0:.0f}, {bv1:.0f}]")

    # ── 楼栋：从大到小贪心摆放 ───────────────────────────────────────
    # 先摆 36 × 12 的主板楼，再在剩下的空隙里补 24 × 11 的小楼。
    # 每一步都检查「四角与四边中点都在可建区内」以及「与已摆楼栋至少留 gap」，
    # 斜边的楔形区域也能塞满，不会出现大片空地。
    buildings = []
    placed = []   # 已摆楼栋的 AABB，用于避让

    # 描图阶段已经有的人才公寓：排布时必须让开。
    # 这几栋是真实的楼，程序再摆一栋叠上去就成了「两栋楼穿在一起」。
    fixed = []
    for b in pkg["buildings"]:
        if not b["id"].startswith("talent_apartment"):
            continue
        if b.get("height_m", 0) <= 0.01:
            continue
        uv = to_local(b["polygon"], origin, u_axis, v_axis, mpp)
        fx = [p[0] for p in uv]
        fy = [p[1] for p in uv]
        fixed.append((min(fx), min(fy), max(fx), max(fy)))
    print(f"已有人才公寓 {len(fixed)} 栋，排布时避让")

    def hits(r, gap):
        for q in placed + fixed:
            if (r[0] < q[2] + gap and r[2] > q[0] - gap and
                    r[1] < q[3] + gap and r[3] > q[1] - gap):
                return True
        return False

    def pack(w, d, pitch_u, pitch_v, gap, v_offset=0.0, tag="a"):
        idx = 0
        v = bv0 + d / 2 + v_offset
        while v + d / 2 <= bv1:
            u = bu0 + w / 2
            while u + w / 2 <= bu1:
                rect = rect_uv(u, v, w, d)
                r = (u - w / 2, v - d / 2, u + w / 2, v + d / 2)
                if rect_inside(rect, build_uv) and not hits(r, gap):
                    floors = 6 if (idx + len(buildings)) % 3 else 5
                    buildings.append({
                        "id": f"cm-{tag}{len(buildings) + 1}",
                        "polygon": [to_px(p, origin, u_axis, v_axis, mpp) for p in rect],
                        "height_m": round(floors * 3.0, 1),
                        "kind": "residential",
                        "floors": floors,
                    })
                    placed.append(r)
                    idx += 1
                    u += pitch_u
                else:
                    u += 4.0
            v += pitch_v

    pack(36.0, 12.0, 44.0, 30.0, 10.0)                     # 主板楼
    pack(24.0, 11.0, 30.0, 26.0, 8.0, v_offset=15.0, tag="b")  # 缝隙里的小楼

    # ── 道路 ────────────────────────────────────────────────────────
    # 环路沿内缩轮廓闭合
    ring_closed = ring_uv + [ring_uv[0]]
    roads = [{"points": [to_px(p, origin, u_axis, v_axis, mpp) for p in ring_closed],
              "width_m": RING_W, "closed": False}]

    # 主路：沿 u 穿过可建区中线
    spine_v = (bv0 + bv1) / 2
    spine = [(bu0 - 6, spine_v), (bu1 + 6, spine_v)]
    roads.append({"points": [to_px(p, origin, u_axis, v_axis, mpp) for p in spine],
                  "width_m": ROAD_W, "closed": False})

    # 两条支路：沿 v 方向，把南北两侧的楼栋串起来
    for f in (0.32, 0.68):
        uc = bu0 + (bu1 - bu0) * f
        lane = [(uc, bv0 - 6), (uc, bv1 + 6)]
        roads.append({"points": [to_px(p, origin, u_axis, v_axis, mpp) for p in lane],
                      "width_m": 4.5, "closed": False})

    # ── 场地：篮球场 + 停车场 ─────────────────────────────────────────
    courts = []
    # 在可建区里找两块空地，避开楼栋
    def free(rect):
        if not rect_inside(rect, build_uv):
            return False
        for b in buildings:
            bp = [to_local([p], origin, u_axis, v_axis, mpp)[0] for p in b["polygon"]]
            bx = [p[0] for p in bp]; by = [p[1] for p in bp]
            # 轴对齐包围盒相交就当作冲突（楼栋本身就是轴对齐的）
            rx = [p[0] for p in rect]; ry = [p[1] for p in rect]
            if (min(rx) < max(bx) + 2 and max(rx) > min(bx) - 2 and
                    min(ry) < max(by) + 2 and max(ry) > min(by) - 2):
                return False
        for c in courts:
            cp = [to_local([p], origin, u_axis, v_axis, mpp)[0] for p in c["polygon"]]
            rx = [p[0] for p in rect]; ry = [p[1] for p in rect]
            if (min(rx) < max(q[0] for q in cp) + 6 and max(rx) > min(q[0] for q in cp) - 6 and
                    min(ry) < max(q[1] for q in cp) + 6 and max(ry) > min(q[1] for q in cp) - 6):
                return False
        return True

    step = 6.0
    u = bu0
    while u < bu1 and len(courts) < 2:
        v = bv0  # 每换一列都要从最低一行重新扫
        while v < bv1 and len(courts) < 2:
            rect = rect_uv(u + 14, v + 8, 28, 15)
            if free(rect):
                courts.append({
                    "kind": "basketball",
                    "polygon": [to_px(p, origin, u_axis, v_axis, mpp) for p in rect],
                })
                u += 40
                break
            v += step
        u += 46

    # 停车场：环路内侧、主路两端各一块
    parkings = []
    for uc in (bu0 + 18, bu1 - 18):
        rect = rect_uv(uc, spine_v, 30, 14)
        if rect_inside(rect, build_uv):
            parkings.append({
                "polygon": [to_px(p, origin, u_axis, v_axis, mpp) for p in rect],
            })

    # ── 门岗与车棚 ───────────────────────────────────────────────────
    # 大门开在主路东端（u 最小的一侧），朝城市道路，不与校园同侧
    gate_uv = (bu0 - 7.0, spine_v)
    gate_px = to_px(gate_uv, origin, u_axis, v_axis, mpp)
    gate = {
        "x": round(gate_px[0], 1),
        "y": round(gate_px[1], 1),
        "heading": round(math.atan2(u_axis[0], u_axis[1]), 4),
    }

    shed_rect = rect_uv(bu0 + 16, bv0 + 10, 22, 5)
    shed = {
        "polygon": [to_px(p, origin, u_axis, v_axis, mpp) for p in shed_rect],
        "height_m": 2.6,
        "in_zone": rect_inside(shed_rect, build_uv),
    }

    extra["community"] = {
        "outline": poly,
        "frame": {
            "origin": [round(cx, 1), round(cy, 1)],
            "u": [round(u_axis[0], 4), round(u_axis[1], 4)],
            "v": [round(v_axis[0], 4), round(v_axis[1], 4)],
            "size_m": [round(umax - umin, 1), round(vmax - vmin, 1)],
        },
        "roads": roads,
        "buildings": buildings,
        "courts": courts,
        "parkings": parkings,
        "gate": gate,
        "shed": shed,
    }

    with open(EXTRA_PATH, "w", encoding="utf-8") as f:
        json.dump(extra, f, ensure_ascii=False, separators=(",", ":"))

    area = abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                   for i in range(len(poly)))) / 2 * mpp * mpp
    print(f"小区面积 {area:.0f} 平方米")
    print(f"楼栋 {len(buildings)} 栋，道路 {len(roads)} 条，场地 {len(courts)} 块，停车场 {len(parkings)} 块")
    print(f"写回 {EXTRA_PATH}")


if __name__ == "__main__":
    main()
