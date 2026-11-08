# -*- coding: utf-8 -*-
"""
scan_media.py —— 扫描素材目录，生成前端使用的 media.js

约定：
    assets/media/<scene>/  存放该场景的视频或图片
    文件名建议以功能 id 开头，例如 forest-01.mp4、metro-11.jpg
    无法匹配 id 的文件仍会收录，按文件名作为标题

支持格式：mp4 / webm / mov / jpg / jpeg / png

用法：
    python tools/scan_media.py
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_DIR = os.path.join(BASE_DIR, "assets", "media")
OUT_PATH = os.path.join(BASE_DIR, "assets", "js", "media.js")

VIDEO_EXT = {".mp4", ".webm", ".mov"}
IMAGE_EXT = {".jpg", ".jpeg", ".png"}
SCENES = ["forest", "community", "campus", "metro", "live"]


def scan():
    items = []
    for scene in SCENES:
        folder = os.path.join(MEDIA_DIR, scene)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            ext = os.path.splitext(name)[1].lower()
            if ext not in VIDEO_EXT and ext not in IMAGE_EXT:
                continue
            stem = os.path.splitext(name)[0]
            items.append({
                "scene": scene,
                "file": "assets/media/%s/%s" % (scene, name),
                "type": "video" if ext in VIDEO_EXT else "image",
                "stem": stem,
                "title": stem,
                "function_id": stem if "-" in stem else "",
            })

    payload = {"items": items, "count": len(items)}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// 本文件由 tools/scan_media.py 自动生成，请勿手工修改。\n")
        f.write("window.MEDIA = ")
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print("素材条目:", len(items))
    for item in items:
        print("  %-10s %s" % (item["scene"], item["file"]))


if __name__ == "__main__":
    scan()
