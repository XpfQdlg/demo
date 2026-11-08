# 视觉巡检能力展示 · 代码索引

展台用的能力展示软件。纯本地运行，不依赖网络，双击启动脚本即可打开。

内容来源：`D:\Desktop\demo\各组人员任务表.md`，按场景与功能整理，不展示人员分工。

---

## 一、文件清单

| 路径 | 作用 |
| --- | --- |
| `index.html` | 唯一入口页面，加载样式、数据与逻辑 |
| `assets/css/style.css` | 全部样式，含设计令牌、组件、轮播模式、响应式 |
| `assets/js/data.js` | 功能数据（自动生成，勿手改） |
| `assets/js/media.js` | 素材清单（自动生成，勿手改） |
| `assets/js/app.js` | 路由、页面渲染、轮播控制、实时演示连接 |
| `tools/build_data.py` | 功能数据源，生成 `assets/js/data.js` |
| `tools/scan_media.py` | 扫描素材目录，生成 `assets/js/media.js` |
| `tools/live_server.py` | 本机实时推理服务，输出 MJPEG 视频流 |
| `assets/media/forest/` | 森林场景视频与图片 |
| `assets/media/community/` | 小区场景视频与图片 |
| `assets/media/campus/` | 校园场景视频与图片 |
| `assets/media/metro/` | 地铁场景视频与图片 |
| `assets/media/live/` | 实时演示用的源视频或离线循环视频 |
| `start_demo.bat` | 启动本地服务并打开讲解模式 |
| `start_kiosk.bat` | 启动本地服务并直接进入轮播模式 |
| `start_live_demo.bat` | 启动实时推理服务，可带视频与模型参数 |

---

## 二、入口说明

`index.html` 是唯一入口。页面用 hash 路由，刷新后停留在当前页。

| 地址 | 内容 |
| --- | --- |
| `#/` | 总览：场景卡片、总体指标、功能域分布 |
| `#/scene/forest` | 森林场景 8 项任务 |
| `#/scene/community` | 小区场景 20 项任务，含重复项标注 |
| `#/scene/campus` | 校园场景 30 项任务详表 |
| `#/scene/metro` | 地铁场景 33 项任务 |
| `#/matrix` | 八功能域 × 四场景覆盖矩阵，可点击查看明细 |
| `#/roadmap` | 校园场景优先级与开发安排 |
| `#/live` | 实时推理演示页 |
| `?kiosk=1` | 直接进入轮播模式，可与任意路由组合 |
| `?kiosk=1&interval=5000` | 轮播模式并调整每页停留时长（毫秒，最小 2000） |

轮播模式中，`←` `→` 手动切换，`Esc` 退出。共 8 页，默认每页 10 秒。最后一页会嵌入推理服务的实时画面；服务未启动时显示启动提示。

---

## 三、运行方式

### 1. 讲解模式

双击 `start_demo.bat`，浏览器打开 `http://127.0.0.1:8123/`。

### 2. 轮播模式

双击 `start_kiosk.bat`，直接进入轮播。适合接大屏、无人值守。

### 3. 实时推理

先启动推理服务：

```bash
# 摄像头输入
python tools/live_server.py --source 0

# 视频文件循环，展台推荐
python tools/live_server.py --source assets/media/live/demo.mp4 --loop

# 带模型
python tools/live_server.py --source assets/media/live/demo.mp4 --loop --model models/yolo11n.onnx
```

再打开或刷新 `#/live`，点击「连接演示」。

也可以用 `start_live_demo.bat`：

```bat
start_live_demo.bat 视频路径 模型路径
```

### 4. 手动启动静态服务

```bash
python -m http.server 8123 --bind 127.0.0.1
```

服务只绑定本机，不对局域网开放。

---

## 四、数据口径

所有数字由脚本从数据计算，页面不手写计数。

| 场景 | 原表标题 | 表格实际行数 | 说明 |
| --- | ---: | ---: | --- |
| 森林 | 7 | 8 | 标题少算一项 |
| 小区 | 21 | 20 | 第 7、14 条内容重复，页面标注「重复项」 |
| 校园 | 30 | 30 | 编号 1–32，缺 2 个编号 |
| 地铁 | 32 | 33 | 标题少算一项 |
| 合计 | — | 91 | 去重后 90 项 |

功能域矩阵共 32 格，覆盖 24 格。覆盖率、优先级数量、开发安排分布均由 `data.js` 计算。

修改数据：编辑 `tools/build_data.py`，运行 `python tools/build_data.py`。

---

## 五、素材接入

1. 把视频或图片放进对应场景目录，例如 `assets/media/campus/`。
2. 文件名建议以功能 id 开头，例如 `campus-01.mp4`、`metro-11.jpg`。
3. 运行 `python tools/scan_media.py` 生成清单。
4. 刷新页面，场景页底部「案例素材」自动出现。

视频编码建议 **H.264 + AAC 的 mp4**，1080p 即可。浏览器对 H.265、部分 mp4v 编码支持不好，现场容易黑屏。

轮播页需要离线兜底视频时，放在 `assets/media/live/loop.mp4`。

---

## 六、配置项

前端配置集中在 `assets/js/app.js` 顶部的 `CONFIG`：

| 字段 | 说明 |
| --- | --- |
| `brandName` | 顶栏品牌名，默认「视觉巡检」 |
| `live.apiBase` | 推理服务地址，默认 `http://127.0.0.1:8765` |
| `live.fallbackVideo` | 推理服务不可用时的离线视频 |
| `kioskInterval` | 轮播每页时长，默认 10000 毫秒 |

推理服务参数见 `python tools/live_server.py --help`。

---

## 七、依赖清单

前端：

- 现代浏览器（Chrome / Edge）
- 无第三方库，无 CDN，全部本地文件

后端（仅实时推理需要）：

```bash
pip install flask opencv-python numpy
```

可选：

```bash
pip install ultralytics   # 需要加载 .pt 模型时安装
```

`.onnx` 模型由 OpenCV DNN 直接加载，不需要 ultralytics。

---

## 八、已知限制

1. 推理服务同一时间只适合一个视频流客户端。轮播页和讲解页同时连接会争抢同一个摄像头或视频句柄。现场二选一。
2. 服务只监听 `127.0.0.1`，没有鉴权。不要改成 `0.0.0.0`。
3. 模型文件不随项目提供，需要放到 `models/` 并在启动时指定路径。
4. 未加载模型时服务仍会输出视频流，左上角标注「未加载模型」。
5. 轮播页的实时画面依赖推理服务，服务未启动时显示提示，不会留破图标。

---

## 九、待确认事项

- 品牌名与展台主题（当前为占位）
- 大屏尺寸与分辨率（影响字号与轮播布局）
- 展台现场由谁讲解，决定讲解页的信息深度
- 真实素材与模型路径
