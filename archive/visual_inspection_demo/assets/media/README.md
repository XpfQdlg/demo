# 素材目录说明

按场景存放视频与图片，前端会自动读取。

```text
assets/media/
├── forest/      森林
├── community/   小区
├── campus/      校园
├── metro/       地铁
└── live/        实时演示的源视频与离线兜底视频
```

## 命名建议

以功能 id 开头，前端会把素材挂到对应任务行：

```text
campus-01.mp4      校园第 1 项任务
metro-11.jpg       地铁第 11 项任务
forest-01.mp4      森林第 1 项任务
```

功能 id 可以在页面地址里查到，例如 `#/scene/campus` 下第 1 行就是 `campus-01`。
不以 id 开头的文件也会显示，只是不会挂到具体任务行。

## 格式

- 视频：`.mp4`（H.264 + AAC 编码最稳）、`.webm`、`.mov`
- 图片：`.jpg`、`.jpeg`、`.png`

H.265 或部分 mp4v 编码在浏览器里可能无法播放，现场会黑屏，导入前先转码。

## 生效方式

放入文件后运行：

```bash
python tools/scan_media.py
```

然后刷新页面。
