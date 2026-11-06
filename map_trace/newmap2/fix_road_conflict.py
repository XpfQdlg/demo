#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_road_conflict —— 把压在楼体下的路面裁掉

问题：
    建筑轮廓从旧图迁移，道路从新图标注，两套几何本来就不严格一致。
    实测 38 栋楼里有 28 栋压在路面上，最大的重叠 3105 平方米。
    3D 里路面是贴地的独立几何，楼体从地面拔起，
    路面会在楼脚处钻进去又露出来，白边线沿着墙根穿过，
    看起来就是「路和楼互相穿模」。

做法：
    楼体是主对象，路面让位。把路面多边形里落在楼体下的部分挖掉，再重描轮廓。
    裁的时候给楼体外扩 1 米，留出一圈路沿，避免路紧贴墙根。

顺带处理边线层：边线是向外扩 0.45 米的同一批多边形，
用同一张楼体掩膜裁，否则白线还会从楼里穿出来。

用法：
    python fix_road_conflict.py
    直接改写 map_package.json 的 roads.surface 与 roads.edge。
    要在 build_map_package.py 之后跑。
"""

import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PKG_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
)

SCALE = 2             # 半分辨率处理，1 像素 = 1 米
CLEAR_M = 1.0         # 楼体外扩多少米让路
MIN_PIECE_M2 = 20.0   # 裁完小于这个面积的路面碎块丢掉


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(PKG_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    W = int(round(pkg["image"]["width"] / SCALE)) + 2
    H = int(round(pkg["image"]["height"] / SCALE)) + 2

    # 楼体掩膜：只算有高度的，并且外扩 CLEAR_M
    keep_out = np.zeros((H, W), np.uint8)
    n_solid = 0
    for b in pkg["buildings"]:
        if b.get("height_m", 0) <= 0.01:
            continue
        n_solid += 1
        pts = np.array([[int(round(x / SCALE)), int(round(y / SCALE))] for x, y in b["polygon"]], np.int32)
        cv2.fillPoly(keep_out, [pts], 255)
    k = int(round(CLEAR_M / SCALE)) * 2 + 1
    keep_out = cv2.dilate(keep_out, np.ones((k, k), np.uint8))

    def trim(entry):
        """挖掉楼体下方的部分，返回一组新多边形"""
        m = np.zeros((H, W), np.uint8)
        pts = np.array([[int(round(x / SCALE)), int(round(y / SCALE))] for x, y in entry["outer"]], np.int32)
        cv2.fillPoly(m, [pts], 255)
        for hole in entry.get("holes") or []:
            hp = np.array([[int(round(x / SCALE)), int(round(y / SCALE))] for x, y in hole], np.int32)
            cv2.fillPoly(m, [hp], 0)

        free = cv2.bitwise_and(m, cv2.bitwise_not(keep_out))
        if cv2.countNonZero(free) == 0:
            return []

        # 必须用 RETR_CCOMP：楼体整栋落在大路面内部时，挖掉后是个「洞」，
        # RETR_EXTERNAL 只拿外轮廓，洞会被丢掉，等于没裁。
        contours, hierarchy = cv2.findContours(free, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:
            return []
        hierarchy = hierarchy[0]

        def to_poly(c, eps=1.0):
            approx = cv2.approxPolyDP(c, eps, True)
            return [[round(float(p[0]) * SCALE, 1), round(float(p[1]) * SCALE, 1)]
                    for p in approx.reshape(-1, 2)]

        out = []
        for i, c in enumerate(contours):
            # 只处理外轮廓（父节点为 -1）
            if hierarchy[i][3] != -1:
                continue
            if cv2.contourArea(c) < MIN_PIECE_M2:
                continue
            outer = to_poly(c)
            if len(outer) < 3:
                continue
            holes = []
            child = hierarchy[i][2]
            while child != -1:
                if cv2.contourArea(contours[child]) >= MIN_PIECE_M2:
                    h = to_poly(contours[child])
                    if len(h) >= 3:
                        holes.append(h)
                child = hierarchy[child][0]
            out.append({"outer": outer, "holes": holes})
        return out

    before_s = len(pkg["roads"]["surface"])
    before_e = len(pkg["roads"]["edge"])

    new_surface = []
    for s in pkg["roads"]["surface"]:
        new_surface.extend(trim(s))
    new_edge = []
    for s in pkg["roads"]["edge"]:
        new_edge.extend(trim(s))

    pkg["roads"]["surface"] = new_surface
    pkg["roads"]["edge"] = new_edge

    with open(PKG_PATH, "w", encoding="utf-8") as f:
        json.dump(pkg, f, ensure_ascii=False, separators=(",", ":"))

    print(f"楼体 {n_solid} 栋，让路外扩 {CLEAR_M} 米")
    print(f"  路面多边形 {before_s} -> {len(new_surface)} 段")
    print(f"  边线多边形 {before_e} -> {len(new_edge)} 段")
    print(f"  写回 {PKG_PATH}")


if __name__ == "__main__":
    main()
