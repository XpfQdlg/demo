# -*- coding: utf-8 -*-
"""给地图叠加坐标网格，便于读点。"""
import sys, os
import cv2

def main():
    src, dst = sys.argv[1], sys.argv[2]
    img = cv2.imread(src)
    h, w = img.shape[:2]
    step = 100
    for x in range(0, w, step):
        cv2.line(img, (x, 0), (x, h), (0, 0, 255), 1)
        cv2.putText(img, str(x), (x+2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,0,255), 1, cv2.LINE_AA)
    for y in range(0, h, step):
        cv2.line(img, (0, y), (w, y), (0, 0, 255), 1)
        cv2.putText(img, str(y), (2, y+14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,0,255), 1, cv2.LINE_AA)
    cv2.imwrite(dst, img)
    print(dst, w, h)

if __name__ == "__main__":
    main()
