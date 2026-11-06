# -*- coding: utf-8 -*-
"""
live_server.py —— 本机实时推理服务

作用：
    读取摄像头或视频文件，逐帧推理，把检测框画到画面上，
    以 MJPEG 流的方式提供给前端 index.html 的「实时演示」页面。

接口：
    GET /health   返回服务状态
    GET /stats    返回 FPS、检测数量、输入源（前端每秒轮询）
    GET /stream   MJPEG 视频流

启动示例：
    # 1) 用摄像头
    python tools/live_server.py --source 0

    # 2) 用视频文件循环播放（展台推荐，画面稳定）
    python tools/live_server.py --source assets/media/live/demo.mp4 --loop

    # 3) 加载 YOLO 模型
    python tools/live_server.py --source assets/media/live/demo.mp4 --loop --model models/yolo11n.onnx

模型支持：
    .pt   需要安装 ultralytics
    .onnx 优先用 ultralytics；没有则退回 OpenCV DNN
    不指定模型时仍然输出视频流，并在画面左上角标注「未加载模型」

依赖：
    flask, opencv-python, numpy
"""

import argparse
import os
import sys
import threading
import time

import cv2
import numpy as np
from flask import Flask, Response, jsonify

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__)

# 全局状态，供 /stats 读取
STATE = {
    "fps": 0.0,
    "count": 0,
    "source": "未连接",
    "model": "未加载模型",
    "mode": "idle",
    "frame_index": 0,
}

LOCK = threading.Lock()


# ------------------------------------------------------------------ 输入源
class FrameSource:
    """摄像头或视频文件。视频文件播放到结尾自动回到开头。"""

    def __init__(self, source, loop=False):
        self.loop = loop
        self.is_camera = str(source).isdigit()
        self.source_id = int(source) if self.is_camera else source
        self.cap = cv2.VideoCapture(self.source_id)
        if not self.cap.isOpened():
            raise RuntimeError("无法打开输入源: %s" % source)
        self.description = "摄像头 %s" % source if self.is_camera else os.path.basename(source)

    def read(self):
        ok, frame = self.cap.read()
        if not ok and not self.is_camera and self.loop:
            # 视频播放完毕，回到第一帧
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
        if not ok:
            return None
        return frame

    def release(self):
        self.cap.release()


# ------------------------------------------------------------------ 检测器
class NullDetector:
    """没有模型时的占位实现，只返回空结果。"""

    name = "未加载模型"

    def infer(self, frame):
        return []


class UltralyticsDetector:
    """基于 ultralytics 的 YOLO 推理。"""

    def __init__(self, model_path, conf=0.35):
        from ultralytics import YOLO  # 延迟导入，没装也不影响其它模式

        self.model = YOLO(model_path)
        self.conf = conf
        self.name = os.path.basename(model_path)

    def infer(self, frame):
        results = self.model.predict(frame, conf=self.conf, verbose=False)[0]
        boxes = []
        names = results.names or {}
        for box in results.boxes:
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            score = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = names.get(cls_id, "class_%d" % cls_id)
            boxes.append((x1, y1, x2, y2, score, str(label)))
        return boxes


class DnnDetector:
    """OpenCV DNN 读取 ONNX 模型，适配 YOLOv8 / v11 的输出格式。"""

    def __init__(self, model_path, conf=0.35, iou=0.45, input_size=640, names_file=""):
        self.net = cv2.dnn.readNetFromONNX(model_path)
        self.conf = conf
        self.iou = iou
        self.input_size = input_size
        self.names = self._load_names(names_file)
        self.name = os.path.basename(model_path)

    @staticmethod
    def _load_names(path):
        if not path or not os.path.isfile(path):
            return {}
        names = {}
        with open(path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line = line.strip()
                if line:
                    names[idx] = line
        return names

    def _letterbox(self, frame):
        h, w = frame.shape[:2]
        scale = self.input_size / max(h, w)
        nh, nw = int(round(h * scale)), int(round(w * scale))
        resized = cv2.resize(frame, (nw, nh))
        canvas = np.full((self.input_size, self.input_size, 3), 114, dtype=np.uint8)
        top = (self.input_size - nh) // 2
        left = (self.input_size - nw) // 2
        canvas[top:top + nh, left:left + nw] = resized
        return canvas, scale, left, top

    def infer(self, frame):
        canvas, scale, left, top = self._letterbox(frame)
        blob = cv2.dnn.blobFromImage(canvas, 1 / 255.0, (self.input_size, self.input_size), swapRB=True)
        self.net.setInput(blob)
        output = self.net.forward()

        # YOLOv8/v11 ONNX 输出：(1, 4 + 类别数, 候选框数)，转置后逐行解析
        if output.ndim == 3:
            output = output[0]
            if output.shape[0] < output.shape[1]:
                output = output.transpose()

        boxes = []
        scores = []
        class_ids = []
        for row in output:
            if row.shape[0] < 5:
                continue
            class_scores = row[4:]
            class_id = int(np.argmax(class_scores))
            score = float(class_scores[class_id])
            if score < self.conf:
                continue
            cx, cy, bw, bh = [float(v) for v in row[:4]]
            x1 = (cx - bw / 2 - left) / scale
            y1 = (cy - bh / 2 - top) / scale
            x2 = (cx + bw / 2 - left) / scale
            y2 = (cy + bh / 2 - top) / scale
            boxes.append([x1, y1, x2 - x1, y2 - y1])
            scores.append(score)
            class_ids.append(class_id)

        if not boxes:
            return []

        indices = cv2.dnn.NMSBoxes(boxes, scores, self.conf, self.iou)
        results = []
        for i in np.array(indices).flatten():
            x, y, w, h = boxes[i]
            label = self.names.get(class_ids[i], "class_%d" % class_ids[i])
            results.append((x, y, x + w, y + h, scores[i], label))
        return results


def build_detector(model_path, conf):
    if not model_path:
        return NullDetector()
    if not os.path.isfile(model_path):
        print("[警告] 模型文件不存在：%s，退回无模型模式" % model_path)
        return NullDetector()

    ext = os.path.splitext(model_path)[1].lower()
    try:
        if ext == ".pt":
            return UltralyticsDetector(model_path, conf)
        return DnnDetector(model_path, conf)
    except Exception as exc:  # 模型加载失败不应该让服务起不来
        print("[警告] 模型加载失败：%s，退回无模型模式" % exc)
        return NullDetector()


# ------------------------------------------------------------------ 绘制
def draw_boxes(frame, boxes):
    """画框并返回画面。统一使用高对比度配色，方便远距离观看。"""
    for (x1, y1, x2, y2, score, label) in boxes:
        p1 = (int(x1), int(y1))
        p2 = (int(x2), int(y2))
        cv2.rectangle(frame, p1, p2, (229, 135, 57), 2)

        text = "%s %.2f" % (label, score)
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(frame, (p1[0], p1[1] - th - 8), (p1[0] + tw + 8, p1[1]), (229, 135, 57), -1)
        cv2.putText(frame, text, (p1[0] + 4, p1[1] - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (13, 13, 13), 1, cv2.LINE_AA)
    return frame


def draw_hud(frame, fps, count, model_name):
    """左上角显示推理状态，现场讲解时可以直接指着看。"""
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 46), (13, 13, 13), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)

    text = "FPS %.1f   TARGETS %d   %s" % (fps, count, model_name)
    cv2.putText(frame, text, (16, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (240, 239, 236), 1, cv2.LINE_AA)
    return frame


# ------------------------------------------------------------------ 流
def generate_frames(detector, source):
    frame_count = 0
    last_time = time.time()
    fps = 0.0

    while True:
        frame = source.read()
        if frame is None:
            break

        boxes = detector.infer(frame)
        frame = draw_boxes(frame, boxes)

        frame_count += 1
        now = time.time()
        elapsed = now - last_time
        if elapsed >= 0.5:
            instant = frame_count / elapsed
            fps = instant if fps == 0 else fps * 0.7 + instant * 0.3
            frame_count = 0
            last_time = now

        with LOCK:
            STATE["fps"] = round(fps, 1)
            STATE["count"] = len(boxes)
            STATE["frame_index"] += 1

        frame = draw_hud(frame, fps, len(boxes), detector.name)
        ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            continue

        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")

        # 视频文件输入时略微限速，避免 CPU 跑满
        if not source.is_camera:
            time.sleep(0.01)


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.route("/health")
def health():
    return jsonify({"ok": True, "mode": STATE["mode"], "model": STATE["model"]})


@app.route("/stats")
def stats():
    with LOCK:
        return jsonify(dict(STATE))


@app.route("/stream")
def stream():
    detector = app.config["DETECTOR"]
    source = app.config["SOURCE"]
    return Response(generate_frames(detector, source),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


def main():
    parser = argparse.ArgumentParser(description="视觉巡检实时推理服务")
    parser.add_argument("--source", default="0", help="摄像头编号（0）或视频文件路径")
    parser.add_argument("--loop", action="store_true", help="视频文件循环播放")
    parser.add_argument("--model", default="", help="模型路径：.pt 或 .onnx")
    parser.add_argument("--conf", type=float, default=0.35, help="置信度阈值")
    parser.add_argument("--port", type=int, default=8765, help="服务端口")
    args = parser.parse_args()

    try:
        source = FrameSource(args.source, loop=args.loop)
    except Exception as exc:
        print("[错误] %s" % exc)
        sys.exit(1)

    detector = build_detector(args.model, args.conf)

    with LOCK:
        STATE["source"] = source.description
        STATE["model"] = detector.name
        STATE["mode"] = "running"

    app.config["SOURCE"] = source
    app.config["DETECTOR"] = detector

    print("输入源 :", source.description)
    print("模型   :", detector.name)
    print("地址   : http://127.0.0.1:%d/stream" % args.port)
    print("按 Ctrl+C 停止")

    app.run(host="127.0.0.1", port=args.port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
