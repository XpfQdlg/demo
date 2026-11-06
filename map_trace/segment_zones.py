# -*- coding: utf-8 -*-
"""按 HSV 阈值分割地图色块，输出各分区掩膜与叠加图。"""
import sys, os
import cv2
import numpy as np

# 阈值按 HSV（OpenCV: H 0-180, S 0-255, V 0-255）
RANGES = {
    "green":  [(30, 60, 70, 255, 130, 255)],
    "cyan":   [(80, 105, 50, 255, 100, 255)],
    "orange": [(8, 30, 110, 255, 150, 255)],
    "red":    [(0, 10, 90, 255, 150, 255), (170, 180, 90, 255, 150, 255)],
    "yellow": [(20, 35, 170, 255, 100, 255)],
    "blue":   [(95, 115, 130, 255, 190, 255)],
}

COLORS = {
    "green":  (0, 255, 0),
    "cyan":   (255, 255, 0),
    "orange": (0, 165, 255),
    "red":    (0, 0, 255),
    "yellow": (0, 255, 255),
    "blue":   (255, 0, 0),
}

def build_mask(hsv, ranges):
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for h1, h2, s1, s2, v1, v2 in ranges:
        m = cv2.inRange(hsv, (h1, s1, v1), (h2, s2, v2))
        mask = cv2.bitwise_or(mask, m)
    return mask

def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    img = cv2.imread(src)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    overlay = img.copy()

    for name, ranges in RANGES.items():
        mask = build_mask(hsv, ranges)
        # 去噪：先开运算去掉细碎点，再闭运算补洞
        k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        k9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k3, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k9, iterations=2)
        # 去掉小连通域
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        clean = np.zeros_like(mask)
        kept = 0
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if area >= 800:
                clean[labels == i] = 255
                kept += 1
        cv2.imwrite(os.path.join(out_dir, f"mask_{name}.png"), clean)
        overlay[clean > 0] = COLORS[name]
        print(f"{name:7s} kept={kept:3d} area={int((clean>0).sum())}")

    blended = cv2.addWeighted(img, 0.45, overlay, 0.55, 0)
    cv2.imwrite(os.path.join(out_dir, "zones_overlay.png"), blended)
    print("written", os.path.join(out_dir, "zones_overlay.png"))

if __name__ == "__main__":
    main()
