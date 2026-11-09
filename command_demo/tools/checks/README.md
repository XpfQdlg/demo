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
| `_alert_bus_probe.mjs` | 大屏五段生命周期是否完整、同 id、按序推到本机总线 |
| `_mobile_probe.mjs` | 手机预警页：实时链路、统计/筛选/详情/未读、演示模式 |
| `_phone_link_probe.mjs` | 大屏「手机」入口：二维码生成、局域网地址可达性 |
| `_e2e_phone_probe.mjs` | 端到端：大屏真实报警 → 手机页收到 → 处置闭环 |
| `_model_bar_probe.mjs` | 四模型场景应用：大屏模型条切换、页签 tooltip、场景本地化异常名 |
| `_visitor_bus_probe.mjs` | 观众上报总线协议：big-screen / fallback 两种模式与定时器清理 |
| `_visitor_probe.mjs` | 观众上报端到端：手机会诊上报 → 大屏切场景出警 → 手机观众上报卡片闭环 |
| `_phone_v3_probe.mjs` | AEGIS 手机重设计：四 Tab、语音/AR/盲盒/我的/现场回传、320 适配 |
| `_bigscreen_session_probe.mjs` | 大屏会话：在线值班员、本场战报、语音指挥、跟随回传帧 |

## 一次性探针

下面这些是排查具体问题时写的，保留是为了记录当时怎么验证的，日常不必跑：

`_all4.mjs`（四场景各一张）、`_wide.mjs`、`_closeup.mjs`（任意机位）、`_map_probe.mjs`（地图俯视）、`probe_top.mjs`（俯视快照 PNG）、`_probe_conn.mjs`（西北连体楼）、`_probe_forest.mjs`、`_probe_hill.mjs`、`_probe_robots.mjs`、`_train_probe.mjs`、`_train_probe2.mjs`。

## 注意

- `_visitor_bus_probe` 的 fallback 用例假设总线上没有大屏订阅者；如果开发服开着大屏页/其他浏览器在看，
  这些用例会误报。跑之前先关掉其它页面，或看脚本输出里的 SKIP 提示。
- `npm run dev` 下总线是**会话内存**：`POST /api/alerts/reset` 只清服务端（事件/值班员/战报/帧/兜底定时器），
  已经打开的页面需要刷新才能看到归零。

- 无头软件渲染只有 1~5 fps，仿真时间每帧最多累加 0.05 秒，等墙钟推不动仿真。涉及时间的验收要直接改 `__app.engine.time` 或 `__cine` 上的时间字段。
- `shot.mjs` 用 `networkidle2` 会等不到空闲，改用 `_smoke.mjs` 的固定等待写法。
- 脚本里的相对路径 `shots/...` 以 `command_demo` 为当前目录，从项目根直接跑会写到错误位置。
