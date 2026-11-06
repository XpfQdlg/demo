#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
expand_community —— 把小区范围拉回描图上的品红圈（原名扩边，现改为回退）

为什么改：
    早先的做法是「沿校园东边界向西扩，再向东扩到图幅边缘」，
    结果小区扩到 19707 平方米，横跨 x 709~1064：
    西边压进校园，东边贴到图幅边，内部再重新摆楼，
    摆出来的一栋中心落在 x ≈ 816，直接跑进校园用地。

    对照标注图与卫星图复核：小区就是东南角那一组人才公寓，
    标注图上品红圈的原始轮廓是 x 799~1007、y 1048~1255，约 7746 平方米。
    所以本脚本不再扩边，改为把 live 数据包里的 community 轮廓
    恢复成描图阶段算出的原始多边形。

用法：
    python expand_community.py     # 回退到描图轮廓
    python enrich_community.py     # 之后重排楼栋

原始轮廓来源：
    map_trace/newmap/map_package.json（build_map_package.py 的产物，
    是扩边之前的一版）。这个文件不能动，它是几何的基准。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_PATH = os.path.abspath(
    os.path.join(HERE, "..", "..", "command_demo", "src", "map", "data", "map_package.json")
)
TRACED_PATH = os.path.abspath(os.path.join(HERE, "..", "newmap", "map_package.json"))


def shoelace(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with open(LIVE_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)
    with open(TRACED_PATH, "r", encoding="utf-8") as f:
        traced = json.load(f)["zones"]["community"]

    old = pkg["zones"]["community"]
    mpp = pkg["scale"]["meters_per_px"]

    poly = [[round(float(x), 1), round(float(y), 1)] for x, y in traced["polygon"]]
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]

    pkg["zones"]["community"] = {
        "polygon": poly,
        "bbox": [min(xs), min(ys), max(xs), max(ys)],
        "area_px": round(shoelace(poly), 1),
    }

    with open(LIVE_PATH, "w", encoding="utf-8") as f:
        json.dump(pkg, f, ensure_ascii=False, separators=(",", ":"))

    a_old = shoelace(old["polygon"]) * mpp * mpp
    a_new = shoelace(poly) * mpp * mpp
    print(f"小区面积 {a_old:.0f} → {a_new:.0f} 平方米")
    print(f"包围盒 {[round(v) for v in pkg['zones']['community']['bbox']]}")
    print(f"写回 {LIVE_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
