# -*- coding: utf-8 -*-
"""从分区掩膜提取轮廓，输出 JSON、标注图与 SVG 预览。"""
import sys, os, json
import cv2
import numpy as np

COLOR_NAMES = {
    "green": "绿色分区",
    "cyan": "青色分区",
    "orange": "橙色分区",
    "red": "红色分区",
    "yellow": "黄色分区",
    "blue": "蓝色分区",
}
DRAW_COLORS = {
    "green": (0, 200, 0),
    "cyan": (200, 200, 0),
    "orange": (0, 140, 255),
    "red": (0, 0, 220),
    "yellow": (0, 200, 200),
    "blue": (220, 80, 0),
}

def main():
    src, seg_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    img = cv2.imread(src)
    h, w = img.shape[:2]
    annotated = img.copy()
    records = []

    for color in COLOR_NAMES:
        mask_path = os.path.join(seg_dir, f"mask_{color}.png")
        mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 500:
                continue
            peri = cv2.arcLength(cnt, True)
            # epsilon 越小越贴近原轮廓；2.0 像素保留细节
            approx = cv2.approxPolyDP(cnt, 2.0, True)
            if len(approx) < 3:
                continue
            x, y, bw, bh = cv2.boundingRect(approx)
            M = cv2.moments(approx)
            cx = M["m10"] / M["m00"] if M["m00"] else x + bw / 2
            cy = M["m01"] / M["m00"] if M["m00"] else y + bh / 2
            pts = [[int(p[0][0]), int(p[0][1])] for p in approx]
            rec = {
                "id": f"{color}_{len(records)+1:03d}",
                "color": color,
                "color_name": COLOR_NAMES[color],
                "area": round(area, 1),
                "bbox": [int(x), int(y), int(bw), int(bh)],
                "centroid": [round(cx, 1), round(cy, 1)],
                "points": pts,
            }
            records.append(rec)

    # 按面积从大到小排序，便于人工筛选
    records.sort(key=lambda r: -r["area"])
    for i, rec in enumerate(records):
        rec["seq"] = i + 1

    # 标注图
    for rec in records:
        pts = np.array(rec["points"], np.int32).reshape(-1, 1, 2)
        color = DRAW_COLORS[rec["color"]]
        cv2.polylines(annotated, [pts], True, color, 2, cv2.LINE_AA)
        cx, cy = int(rec["centroid"][0]), int(rec["centroid"][1])
        label = f'{rec["seq"]}'
        cv2.putText(annotated, label, (cx-8, cy+5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,0,0), 3, cv2.LINE_AA)
        cv2.putText(annotated, label, (cx-8, cy+5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 1, cv2.LINE_AA)

    cv2.imwrite(os.path.join(out_dir, "trace_annotated.png"), annotated)

    # SVG 预览
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
           f'<image href="{os.path.basename(src)}" x="0" y="0" width="{w}" height="{h}" opacity="0.35"/>']
    fills = {"green":"#7bc043","cyan":"#3fd0d4","orange":"#f0a33a","red":"#e05a4f","yellow":"#f2d43d","blue":"#3d8ee0"}
    for rec in records:
        pts = " ".join(f'{p[0]},{p[1]}' for p in rec["points"])
        svg.append(f'<polygon points="{pts}" fill="{fills[rec["color"]]}" fill-opacity="0.45" stroke="#1b1b1b" stroke-width="1.2"/>')
        cx, cy = rec["centroid"]
        svg.append(f'<text x="{cx}" y="{cy}" font-size="14" fill="#111" text-anchor="middle">{rec["seq"]}</text>')
    svg.append('</svg>')
    with open(os.path.join(out_dir, "trace_preview.svg"), "w", encoding="utf-8") as f:
        f.write("\n".join(svg))

    with open(os.path.join(out_dir, "map_contours.json"), "w", encoding="utf-8") as f:
        json.dump({"image": {"width": w, "height": h, "source": os.path.basename(src)},
                   "contours": records}, f, ensure_ascii=False, indent=2)

    print(f"contours: {len(records)}")
    for rec in records:
        print(f'{rec["seq"]:2d} {rec["id"]:12s} {rec["color_name"]:5s} area={rec["area"]:9.1f} bbox={rec["bbox"]} centroid={rec["centroid"]}')

if __name__ == "__main__":
    main()
