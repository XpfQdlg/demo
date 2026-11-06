# -*- coding: utf-8 -*-
"""检测地图上的白色建筑中心点，输出坐标与标注图。"""
import sys, os, json
import cv2
import numpy as np

def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    img = cv2.imread(src)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # 白色/近白色，低饱和高亮度
    mask = cv2.inRange(hsv, (0, 0, 200), (180, 45, 255))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    dots = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        if 40 <= area <= 260 and 5 <= w <= 20 and 5 <= h <= 20 and 0.6 <= w/h <= 1.6:
            cx, cy = cents[i]
            dots.append({"x": round(float(cx), 1), "y": round(float(cy), 1), "area": int(area), "w": int(w), "h": int(h)})
    dots.sort(key=lambda d: (d["y"], d["x"]))
    with open(os.path.join(out_dir, "dots.json"), "w", encoding="utf-8") as f:
        json.dump(dots, f, ensure_ascii=False, indent=2)
    vis = img.copy()
    for i, d in enumerate(dots):
        cv2.circle(vis, (int(d["x"]), int(d["y"])), 8, (0,0,255), 1)
        cv2.putText(vis, str(i+1), (int(d["x"])+9, int(d["y"])+4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0,0,255), 1, cv2.LINE_AA)
    cv2.imwrite(os.path.join(out_dir, "dots_annotated.png"), vis)
    print("dots", len(dots))
    for i, d in enumerate(dots):
        print(i+1, d)

if __name__ == "__main__":
    main()
