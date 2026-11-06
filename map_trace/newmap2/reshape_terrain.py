#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reshape_terrain —— 删掉水库两侧的假建筑，把水库与森林的轮廓改成自然岸线

问题：
    1. reserved_sw 与 reserved_sc 两块「预留用地」是描图时按实心色块给的最低等级，
       复核原图后确认水库两侧实际没有建筑，它们在 3D 里就是两块凭空长出来的楼。
    2. 水库与森林的轮廓是从标注图上按色块直接取的，边是长直线，
       3D 与地面贴图里都像一个方盒子，和自然岸线差得远。

做法：
    1. 删除 reserved_sw、reserved_sc
    2. 水库：沿边按等距重采样，每个点沿法线向内位移一段分形噪声（0~2.5 米），
       再平滑两遍。只向内缩，保证不会盖到岸上的道路与建筑
    3. 森林：同样的做法，位移幅度更大（0~6 米），波长也更长，做出林缘的凹凸
    4. 按新轮廓重绘 ground.png（校园灰 / 森林绿 / 地铁深灰三种纯色填充）

可重复运行：
    原始轮廓存在 _reshape_src.json 里，每次都以原始轮廓为基准重新生成，
    不会因为跑第二遍而越缩越小。

用法：
    python reshape_terrain.py
"""

import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PKG_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
)
GROUND_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "ground.png")
)
SRC_PATH = os.path.join(HERE, "_reshape_src.json")

# 要剔掉的楼体：
#   reserved_sw / reserved_sc  水库两侧实为空的「预留用地」
#   talent_apartment           东南角六栋人才公寓的并集轮廓，与 p2~p6 重复，
#                              一起画就叠成一团（1991 m² 盖在 1437 m² 的单栋上）
DROP_IDS = ["reserved_sw", "reserved_sc", "talent_apartment"]

# 地面贴图的三色，与 build_map_package.py 一致（BGR）
BG = (28, 30, 34)          # 图幅底色
CAMPUS_BGR = (108, 110, 112)
FOREST_BGR = (70, 140, 96)
SUBWAY_BGR = (62, 60, 66)


def shoelace(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


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


def resample(poly, step):
    """按周长等距重采样，返回 (点列, 每点的单位法线)"""
    pts = [np.array(p, float) for p in poly]
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    n = len(pts)
    out = []
    total = 0.0
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        seg = float(np.linalg.norm(b - a))
        if seg < 1e-9:
            continue
        k = max(1, int(math.ceil(seg / step)))
        for t in range(k):
            out.append(a + (b - a) * (t / k))
        total += seg
    return out


def inward_normals(pts, poly):
    """逐点求法线，并统一朝向多边形内部"""
    n = len(pts)
    normals = []
    for i in range(n):
        a = pts[(i - 1) % n]
        b = pts[(i + 1) % n]
        t = b - a
        L = float(np.linalg.norm(t))
        if L < 1e-9:
            normals.append(np.array([0.0, 0.0]))
            continue
        normals.append(np.array([t[1], -t[0]]) / L)   # 切向旋转 90°
    # 取第一个点试探：朝里还是朝外
    p0 = pts[0]
    probe = p0 + normals[0] * 1.0
    if not point_in_poly(probe, poly):
        normals = [-v for v in normals]
    return normals


def make_noise(count, octaves=3, seed=7):
    """一维分形噪声，取值 0~1，用于沿边位移"""
    rng = np.random.default_rng(seed)
    total = np.zeros(count)
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        k = max(4, int(count / (2 ** o) / 3))
        base = rng.random(k)
        xs = np.linspace(0, k, count, endpoint=False)
        idx = xs.astype(int)
        frac = xs - idx
        vals = base[idx % k] * (1 - frac) + base[(idx + 1) % k] * frac
        total += vals * amp
        norm += amp
        amp *= 0.5
    total /= norm
    total -= total.min()
    total /= max(1e-9, total.max())
    return total


def organic(poly, amp_m, mpp, seed, step_m=3.0, smooth_passes=2, eps=1.2):
    """把多边形边改成自然曲线：等距重采样 + 沿内法线位移 + 平滑"""
    if len(poly) < 3:
        return poly
    step = step_m / mpp
    pts = resample(poly, step)
    normals = inward_normals(pts, poly)
    noise = make_noise(len(pts), seed=seed)
    coords = np.array([list(p) for p in pts])
    disp = noise * (amp_m / mpp)
    for i in range(len(pts)):
        coords[i] = coords[i] + np.array(normals[i]) * disp[i]

    # 平滑，去掉锯齿，避免出现一根根尖刺
    for _ in range(smooth_passes):
        coords = 0.5 * coords + 0.25 * (np.roll(coords, 1, axis=0) + np.roll(coords, -1, axis=0))

    approx = cv2.approxPolyDP(coords.astype(np.float32).reshape(-1, 1, 2), eps, True)
    out = [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in approx]
    return out if len(out) >= 3 else poly


def blob_outline(poly, points=48, lo=0.74, seed=5):
    """把一块矩形区域改成一团有机的形状。

    做法：按多边形点的主轴取一个内切椭圆，再在半径上乘一个 0~1 的分形噪声。
    半径最少缩到 lo 倍，所以新形状一定落在原矩形内，不会越界压到校园。
    """
    dense = []
    n = len(poly)
    for i in range(n):
        a = np.array(poly[i], float)
        b = np.array(poly[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        k = max(2, int(L))
        for t in range(k):
            dense.append(a + (b - a) * (t / k))
    P = np.array(dense)
    c = P.mean(axis=0)

    # 主轴：协方差矩阵的两个特征向量
    cov = np.cov((P - c).T)
    w, v = np.linalg.eigh(cov)
    u = v[:, 1]
    u /= np.linalg.norm(u)
    w2 = np.array([-u[1], u[0]])
    a = np.abs((P - c) @ u).max()
    b = np.abs((P - c) @ w2).max()

    noise = make_noise(points, seed=seed)
    coords = []
    for i in range(points):
        t = 2 * math.pi * i / points
        f = lo + (1 - lo) * noise[i]
        p = c + u * (a * f * math.cos(t)) + w2 * (b * f * math.sin(t))
        coords.append(p)
    coords = np.array(coords)
    for _ in range(2):
        coords = 0.5 * coords + 0.25 * (np.roll(coords, 1, axis=0) + np.roll(coords, -1, axis=0))
    approx = cv2.approxPolyDP(coords.astype(np.float32).reshape(-1, 1, 2), 1.2, True)
    return [[round(float(p[0][0]), 1), round(float(p[0][1]), 1)] for p in approx]


def fill(mask_img, poly, bgr):
    pts = np.array([[int(round(x)), int(round(y))] for x, y in poly], np.int32)
    cv2.fillPoly(mask_img, [pts], bgr)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(PKG_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    mpp = pkg["scale"]["meters_per_px"]

    # ── 原始轮廓：第一次运行时落盘，之后一律以它为基准 ────────────────
    if os.path.exists(SRC_PATH):
        with open(SRC_PATH, "r", encoding="utf-8") as f:
            src = json.load(f)
    else:
        water = next(b for b in pkg["buildings"] if b["id"] == "water_south")
        src = {
            "water_south": water["polygon"],
            "forest": pkg["zones"]["forest"]["polygon"],
        }
        with open(SRC_PATH, "w", encoding="utf-8") as f:
            json.dump(src, f, ensure_ascii=False, indent=1)
        print(f"已记录原始轮廓 {SRC_PATH}")

    # ── 1. 删除水库两侧的假建筑 ──────────────────────────────────────
    before = len(pkg["buildings"])
    pkg["buildings"] = [b for b in pkg["buildings"] if b["id"] not in DROP_IDS]
    print(f"删除建筑 {before - len(pkg['buildings'])} 栋：{'、'.join(DROP_IDS)}")

    # ── 2. 水库岸线 ─────────────────────────────────────────────────
    # 幅度压到 2.5 米：再大就会啃到岸边的人行路
    for b in pkg["buildings"]:
        if b["id"] == "water_south":
            b["polygon"] = organic(src["water_south"], 2.5, mpp, seed=11,
                                   step_m=3.0, smooth_passes=2)
            print(f"水库轮廓 {len(src['water_south'])} 点 → {len(b['polygon'])} 点")
            break

    # ── 3. 森林边界 ─────────────────────────────────────────────────
    # 森林原来是 98 × 140 米的矩形，沿边加噪声改出来还是方，
    # 所以改成「内切椭圆 + 半径噪声」的团块，落在原矩形之内
    pkg["zones"]["forest"]["polygon"] = blob_outline(src["forest"], points=48, lo=0.74, seed=23)
    fp = pkg["zones"]["forest"]["polygon"]
    xs = [p[0] for p in fp]
    ys = [p[1] for p in fp]
    pkg["zones"]["forest"]["bbox"] = [min(xs), min(ys), max(xs), max(ys)]
    print(f"森林轮廓 {len(src['forest'])} 点 → {len(fp)} 点")

    with open(PKG_PATH, "w", encoding="utf-8") as f:
        json.dump(pkg, f, ensure_ascii=False, separators=(",", ":"))

    # ── 4. 重绘地面贴图 ─────────────────────────────────────────────
    # ground.png 只有三种纯色填充，直接按新轮廓重画即可，不必重跑整条链路
    W = pkg["image"]["width"]
    H = pkg["image"]["height"]
    img = np.zeros((H, W, 3), np.uint8)
    img[:] = BG
    fill(img, pkg["zones"]["campus"]["polygon"], CAMPUS_BGR)
    fill(img, pkg["zones"]["forest"]["polygon"], FOREST_BGR)
    if "subway" in pkg["zones"]:
        fill(img, pkg["zones"]["subway"]["polygon"], SUBWAY_BGR)
    cv2.imwrite(GROUND_PATH, img)

    print(f"写回 {PKG_PATH}")
    print(f"重绘 {GROUND_PATH}")


if __name__ == "__main__":
    main()
