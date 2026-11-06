# -*- coding: utf-8 -*-
"""收紧裁剪框后重新提取混合色区域外轮廓。"""
import sys, os, json
import cv2
import numpy as np

REGIONS = {
    "reserved_sw": (145, 920, 390, 1105),
    "reserved_sc": (465, 985, 690, 1175),
    "reserved_se": (785, 1025, 920, 1150),
    "water_south": (330, 880, 460, 1160),
}
COLORS = ["green", "cyan", "orange", "red", "yellow", "blue"]

def main():
    seg_dir, out_dir = sys.argv[1], sys.argv[2]
    masks = {}
    for c in COLORS:
        p = os.path.join(seg_dir, f"mask_{c}.png")
        m = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
        if m is not None:
            masks[c] = m
    results = []
    for name, (x1, y1, x2, y2) in REGIONS.items():
        union = np.zeros((y2-y1, x2-x1), np.uint8)
        for m in masks.values():
            union = cv2.bitwise_or(union, m[y1:y2, x1:x2])
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        union = cv2.morphologyEx(union, cv2.MORPH_CLOSE, k, iterations=2)
        union = cv2.morphologyEx(union, cv2.MORPH_OPEN, k, iterations=1)
        contours, _ = cv2.findContours(union, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            print(name, "no contour"); continue
        cnt = max(contours, key=cv2.contourArea)
        approx = cv2.approxPolyDP(cnt, 3.0, True)
        pts = [[int(p[0][0])+x1, int(p[0][1])+y1] for p in approx]
        results.append({"name": name, "bbox": [x1,y1,x2-x1,y2-y1], "points": pts, "area": float(cv2.contourArea(cnt))})
        print(name, "points", len(pts), "area", int(cv2.contourArea(cnt)), "first", pts[:3])
    with open(os.path.join(out_dir, "union_regions.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
