# -*- coding: utf-8 -*-
"""
extract_zones.py —— 从新的校园总平面图提取分区多边形

源图：campus_zoning_outline_1079x1554.jpg，尺寸 1079 × 1554

图像特点与旧图不同：旧图是填色的色块，新图是**线条**。
所以处理思路是先把线闭合成区域，再取外轮廓。

色相分组（实测）：
    蓝    215-235 度   学校边界
    黄     45-65 度    道路
    青绿  150-175 度   森林（实心填充）
    品红  322-340 度   地铁站区域（闭合线圈）
    紫    300-322 度   小区（与品红重叠，待确认）
    棕      0-15 度    左下角实心多边形，用途待确认

用法：
    python extract_zones.py
输出：
    map_zones.json    分区多边形（像素坐标）
    zones_preview.png 叠图预览
"""

import json
import os

import cv2
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "..", "..", "source", "maps", "campus_zoning_outline_1079x1554.jpg")

# 色相分组，单位度。区间左闭右开，跨 0 度的用两段表示
GROUPS = {
    "campus": [(215, 235)],
    "road": [(45, 65)],
    "forest": [(150, 175)],
    # 品红与紫在 JPEG 压缩后混在一起，实测是同一个闭合圈，
    # 统一按「地铁站区域」处理。小区的位置待用户确认后再单独提。
    "subway_area": [(300, 340)],
    "unknown_brown": [(345, 360), (0, 15)],
}

# 实心色块直接取轮廓；线条需要先闭合再填充
FILLED = {"forest", "unknown_brown"}


def hue_mask(hsv, ranges, s_min=60, v_min=30):
    """按色相区间生成掩膜。OpenCV 的 H 是 0-179，需要把角度除以 2。"""
    h = hsv[:, :, 0].astype(np.int32)
    s = hsv[:, :, 1].astype(np.int32)
    v = hsv[:, :, 2].astype(np.int32)

    mask = np.zeros(h.shape, np.uint8)
    for lo, hi in ranges:
        lo_h, hi_h = int(lo / 2), int(hi / 2)
        if lo_h <= hi_h:
            part = (h >= lo_h) & (h < max(hi_h, lo_h + 1))
        else:
            part = (h >= lo_h) | (h < hi_h)
        mask[part] = 255

    mask[(s < s_min) | (v < v_min)] = 0
    return mask


def close_line(mask, k=9):
    """线条图有细小断口，先闭运算接起来，否则填充会漏。"""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)


def fill_region(mask):
    """把闭合轮廓内部填满：取所有外轮廓，按面积从大到小逐层填充。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    for c in contours:
        cv2.drawContours(filled, [c], -1, 255, thickness=cv2.FILLED)
    return filled, contours


def polygon_of(mask, eps_ratio=0.004):
    """取最大轮廓并做多边形简化。"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    eps = eps_ratio * cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, eps, True)
    pts = approx.reshape(-1, 2).tolist()
    if len(pts) < 3:
        return None
    return pts


def main():
    img = cv2.imread(SRC)
    if img is None:
        raise SystemExit(f"读不到源图：{SRC}")
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    result = {"image": {"width": w, "height": h, "source": os.path.basename(SRC)}, "zones": {}}
    preview = img.copy()

    colors_bgr = {
        "campus": (255, 0, 0),
        "road": (0, 200, 255),
        "forest": (0, 140, 0),
        "subway_area": (255, 0, 255),
        "unknown_brown": (0, 0, 160),
    }

    for name, ranges in GROUPS.items():
        mask = hue_mask(hsv, ranges)
        raw_pixels = int(mask.sum() / 255)

        if name in FILLED:
            region = mask
        else:
            # 线条闭合程度不一：先试小核，填不上再放大核重试。
            # 判据是填充后面积应远大于线条本身像素数。
            region = None
            for k in (9, 17, 27):
                filled, _ = fill_region(close_line(mask, k))
                area_f = cv2.countNonZero(filled)
                if area_f > max(raw_pixels * 2.5, 5000):
                    region = filled
                    break
            if region is None:
                region = mask

        pts = polygon_of(region)
        if pts is None:
            print(f"  {name:14s} 未提取到轮廓（像素 {raw_pixels}）")
            continue

        area = cv2.contourArea(np.array(pts, np.int32))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        result["zones"][name] = {
            "pixel_count": raw_pixels,
            "polygon_area_px": round(area, 1),
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
            "vertex_count": len(pts),
            "polygon": pts,
        }
        print(f"  {name:14s} 顶点 {len(pts):3d}  面积 {area:10.0f}  包围盒 {min(xs)},{min(ys)}-{max(xs)},{max(ys)}")

        cv2.polylines(preview, [np.array(pts, np.int32)], True, colors_bgr[name], 3)

    out_json = os.path.join(BASE, "map_zones.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    cv2.imwrite(os.path.join(BASE, "zones_preview.png"), preview)
    print(f"\n已输出 {out_json}")
    print(f"已输出 {os.path.join(BASE, 'zones_preview.png')}")


if __name__ == "__main__":
    main()
