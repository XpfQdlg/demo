# checks · 验收脚本

无头浏览器截图 + 控制台报错收集。全部在 `command_demo` 目录下运行，截图写到 `command_demo/shots/`。

前提：本机装了 Edge 或 Chrome，`puppeteer-core` 已安装。开发服务先起来（`npm run dev`，端口 5179）。

## 常用

| 脚本 | 用途 |
| --- | --- |
| `shot.mjs` | 通用截图：指定 URL、输出路径、可注入一段 `--eval` 再等 `--after` 毫秒 |
| `_smoke.mjs` | 主演示冒烟：固定等待后截图并收集报错，确认数据改动后页面还能建起来 |
| `cinematic_shot.mjs` | 观感版单场景截图，`--scene=campus\|community\|forest\|subway` |
| `file_check.mjs` | 单文件交付物验收：以 `file://` 打开 `观感版演示.html`，切四场景，检查贴图是否从 data URI 解码、控制台是否报错 |
| `perf.mjs` | 结构体检：网格数、三角形数、材质数、纹理数 |
| `train_check.mjs` | 列车相位：直接改 `engine.time` 推到进站、停站、出站三段 |

## 业务与交互

| 脚本 | 用途 |
| --- | --- |
| `_alert_probe.mjs` | 监控报警：点位、文案、派了哪台、处置后道具与光圈是否复位；四场景通用 |
| `_ui_probe.mjs` | 讲解面板与点击派单：设备列表、事件流、点击派单、跟随优先、`H` 收起 |
| `_follow.mjs` | 设备跟随：按 `1` 跟第一台，截图看主画面与小窗 |
| `_tabs.mjs` | 校园与小区页签切换：确认只有一个场景根节点、机位确实变了 |
| `_life_probe.mjs` | 行人数量与走动、情景道具落点 |

## 一次性探针

下面这些是排查具体问题时写的，保留是为了记录当时怎么验证的，日常不必跑：

`_all4.mjs`（四场景各一张）、`_wide.mjs`、`_closeup.mjs`（任意机位）、`_map_probe.mjs`（地图俯视）、`probe_top.mjs`（俯视快照 PNG）、`_probe_conn.mjs`（西北连体楼）、`_probe_forest.mjs`、`_probe_hill.mjs`、`_probe_robots.mjs`、`_train_probe.mjs`、`_train_probe2.mjs`。

## 注意

- 无头软件渲染只有 1~5 fps，仿真时间每帧最多累加 0.05 秒，等墙钟推不动仿真。涉及时间的验收要直接改 `__app.engine.time` 或 `__cine` 上的时间字段。
- `shot.mjs` 用 `networkidle2` 会等不到空闲，改用 `_smoke.mjs` 的固定等待写法。
- 脚本里的相对路径 `shots/...` 以 `command_demo` 为当前目录，从项目根直接跑会写到错误位置。
