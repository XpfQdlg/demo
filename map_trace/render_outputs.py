# -*- coding: utf-8 -*-
"""基于 map_features.json 生成无标签轮廓图与 SVG 矢量图。"""
import sys, os, json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    data = json.load(open(os.path.join(out_dir, "map_features.json"), encoding="utf-8"))
    w = data["image"]["width"]
    h = data["image"]["height"]
    features = data["features"]

    # 1) 原图叠加细轮廓，不填充、不写标签
    img = cv2.imread(src)
    for f in features:
        pts = np.array(f["points"], np.int32).reshape(-1, 1, 2)
        rgb = tuple(int(f["color"][i:i+2], 16) for i in (1, 3, 5))
        bgr = (rgb[2], rgb[1], rgb[0])
        cv2.polylines(img, [pts], True, bgr, 2, cv2.LINE_AA)
    cv2.imwrite(os.path.join(out_dir, "trace_outline_only.png"), img)

    # 2) SVG：浅底 + 半透明多边形 + 中文标签
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
             f'<rect x="0" y="0" width="{w}" height="{h}" fill="#f4f6f2"/>']
    if data.get("campus_boundary"):
        pts = " ".join(f'{p[0]},{p[1]}' for p in data["campus_boundary"])
        lines.append(f'<polygon points="{pts}" fill="#e8ece3" stroke="#222" stroke-width="3"/>')
    for f in features:
        pts = " ".join(f'{p[0]},{p[1]}' for p in f["points"])
        lines.append(f'<polygon points="{pts}" fill="{f["color"]}" fill-opacity="0.55" stroke="#333" stroke-width="1.4"/>')
    for f in features:
        cx, cy = f.get("label_pos", f["centroid"])
        text = f.get("label", f["name"])
        lines.append(f'<text x="{cx}" y="{cy}" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#111" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">{text}</text>')
    lines.append('</svg>')
    with open(os.path.join(out_dir, "map_features.svg"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(lines))

    print("written trace_outline_only.png and map_features.svg")

if __name__ == "__main__":
    main()
