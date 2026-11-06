#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split_long_buildings —— 把过长的大楼体拆成几栋独立的楼

问题：
    建筑轮廓是从旧图迁移过来的，一张轮廓常常把一整排楼连成一块。
    西侧的 west_dorm 最明显：包围盒 68 × 218 米，一整条板楼连成 L 形，
    在 3D 里就是一堵两百多米长的墙，完全不像校园。

做法：
    对包围盒长宽比大于 2.5、且面积大于 2500 平方米的楼体，
    沿长轴等距切开，每一段重新描轮廓，得到几栋独立的楼。

    切的时候用栅格：整块栅格化后按条带裁剪，每带取外轮廓，
    这样任意形状都稳，不会出现自交或碎屑。

    脚本可重复运行：开跑前先把上一轮切出来的 xxx_sN 合并回一整块
    （同名族按栅格求并，再取外轮廓），因此改 TARGET_LEN 重跑不会
    出现「切了再切」的碎块，也不会出现 _s1_s1 这种套娃编号。

用法：
    python split_long_buildings.py
    改写 map_package.json 的 buildings；改完必须再跑一次
    fix_road_conflict.py，把压在新楼体下的路面挖掉。
"""

import json
import math
import os
import re
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PKG_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
)

SCALE = 0.5             # 半分辨率处理，1 像素 = 1 米
MIN_ASPECT = 2.5        # 长宽比超过这个才拆
MIN_AREA = 2500.0       # 且面积超过 2500 平方米
TARGET_LEN = 36.0       # 每段的目标长度（米）。2026-11-06 由 45 调到 36：
                        # 45 米一段仍然像一堵长墙，36 米更接近真实板楼
MIN_PIECE = 120.0       # 拆出来的碎块小于这个面积就丢掉
SPLIT_ID = re.compile(r"^(.*)_s\d+$")   # 切出来的段编号

# 不切的楼：主教学楼是东西向一整栋，切开会破坏它作为校园主轴的体量
EXCLUDE_IDS = {"teaching_1"}

CUT_JITTER_M = 3.0      # 切点前后抖动的幅度
STEP_FLOOR_M = 3.0      # 相邻段错开一层，避免一排楼顶齐平像切片面包


def id_seed(s):
    h = 0
    for ch in s:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return h


def shoelace(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def union_polygons(polys):
    """把同一族的几段合并成一整块轮廓。

    做法与切分互逆：整族栅格化求并（段与段原本共边，并起来就是原块），
    再取外轮廓。轮廓有凹口也没问题，栅格求并不会自交。
    """
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    if not xs:
        return None
    pad = 20
    ox, oy = min(xs), min(ys)
    gw = int((max(xs) - ox) / SCALE + pad * 2)
    gh = int((max(ys) - oy) / SCALE + pad * 2)
    mask = np.zeros((gh, gw), np.uint8)
    for poly in polys:
        pts = np.array(
            [[int((x - ox) / SCALE) + pad, int((y - oy) / SCALE) + pad] for x, y in poly],
            np.int32,
        )
        cv2.fillPoly(mask, [pts], 255)
    # 段与段之间的接缝只差一两个栅格，闭运算补上再取轮廓
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(c, 2.0, True)
    poly = [
        [round((float(p[0]) - pad) * SCALE + ox, 1),
         round((float(p[1]) - pad) * SCALE + oy, 1)]
        for p in approx.reshape(-1, 2)
    ]
    return poly if len(poly) >= 3 else None


def merge_split_families(buildings):
    """把上一轮的 xxx_sN 段合并回去，保持原来的顺序与位置。

    这一步让脚本可以反复运行：每次改 TARGET_LEN 重跑，都是
    「从整块重新切」，而不是在碎块上再切一刀。
    """
    order = []
    fam = {}
    for b in buildings:
        m = SPLIT_ID.match(b["id"])
        if not m:
            order.append(("one", b))
            continue
        key = m.group(1)
        if key not in fam:
            fam[key] = []
            order.append(("fam", key))
        fam[key].append(b)

    if not fam:
        return buildings

    merged = {}
    for key, pieces in fam.items():
        poly = union_polygons([p["polygon"] for p in pieces])
        if poly is None:
            merged[key] = pieces          # 合并失败就保留原样，不吞数据
            continue
        base = dict(pieces[0])
        base["id"] = key
        base["polygon"] = poly
        merged[key] = [base]
        print(f"  合并 {key:16s} {len(pieces)} 段 → 1 块")

    out = []
    for kind, v in order:
        out.extend(merged[v] if kind == "fam" else [v])
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(PKG_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    mpp = pkg["scale"]["meters_per_px"]

    print("合并上一轮切出的段：")
    pkg["buildings"] = merge_split_families(pkg["buildings"])
    print(f"合并后建筑总数 {len(pkg['buildings'])}")

    out = []
    split_count = 0

    for b in pkg["buildings"]:
        poly = b.get("polygon") or []
        h = b.get("height_m", 0)
        if h <= 0.01 or len(poly) < 3:
            out.append(b)
            continue

        area = shoelace(poly) * mpp * mpp
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        w = (max(xs) - min(xs)) * mpp
        d = (max(ys) - min(ys)) * mpp
        long_side = max(w, d)
        short_side = max(1e-6, min(w, d))
        aspect = long_side / short_side

        if b["id"] in EXCLUDE_IDS:
            out.append(b)
            continue

        if aspect < MIN_ASPECT or area < MIN_AREA:
            out.append(b)
            continue

        # 沿长轴切
        along_x = w >= d
        n_seg = max(2, int(math.ceil(long_side / TARGET_LEN)))

        # 栅格化
        pad = 20
        gw = int((max(xs) - min(xs)) / SCALE + pad * 2)
        gh = int((max(ys) - min(ys)) / SCALE + pad * 2)
        ox, oy = min(xs), min(ys)
        mask = np.zeros((gh, gw), np.uint8)
        pts = np.array([[int((x - ox) / SCALE) + pad, int((y - oy) / SCALE) + pad] for x, y in poly], np.int32)
        cv2.fillPoly(mask, [pts], 255)

        lo = (min(xs) if along_x else min(ys))
        hi = (max(xs) if along_x else max(ys))
        edges = [lo + (hi - lo) * i / n_seg for i in range(n_seg + 1)]

        # 等分切口太整齐，一排楼像切片面包。内部切点各抖 ±3 米，
        # 段与段的长短不一致，看上去才像各自独立的楼
        rng = np.random.default_rng(id_seed(b["id"]))
        for i in range(1, n_seg):
            edges[i] += rng.uniform(-CUT_JITTER_M, CUT_JITTER_M) / mpp
        edges.sort()

        pieces = []
        for i in range(n_seg):
            band = np.zeros_like(mask)
            a = int((edges[i] - lo) / SCALE) + pad
            b2 = int((edges[i + 1] - lo) / SCALE) + pad
            if along_x:
                band[:, max(0, a):b2 + 1] = 255
            else:
                band[max(0, a):b2 + 1, :] = 255
            m = cv2.bitwise_and(mask, band)

            contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in contours:
                if cv2.contourArea(c) * (SCALE / mpp) ** 2 < MIN_PIECE / (mpp * mpp):
                    continue
                approx = cv2.approxPolyDP(c, 2.0, True)
                poly2 = [
                    [round((float(p[0]) - pad) * SCALE + ox, 1),
                     round((float(p[1]) - pad) * SCALE + oy, 1)]
                    for p in approx.reshape(-1, 2)
                ]
                if len(poly2) >= 3:
                    pieces.append(poly2)

        if len(pieces) < 2:
            out.append(b)
            continue

        split_count += 1
        print(f"  {b['id']:20s} {w:.0f}×{d:.0f} 米  →  {len(pieces)} 栋")
        for i, p in enumerate(pieces):
            nb = dict(b)
            nb["id"] = f"{b['id']}_s{i + 1}"
            nb["polygon"] = p
            # 隔一段错一层高：真实校园里同一排楼很少四平齐顶
            if h > STEP_FLOOR_M and i % 2 == 1:
                nb["height_m"] = round(h + STEP_FLOOR_M, 1)
            out.append(nb)

    pkg["buildings"] = out

    with open(PKG_PATH, "w", encoding="utf-8") as f:
        json.dump(pkg, f, ensure_ascii=False, separators=(",", ":"))

    print(f"拆分 {split_count} 栋过长楼体，建筑总数 {len(out)}")
    print(f"写回 {PKG_PATH}")


if __name__ == "__main__":
    main()
