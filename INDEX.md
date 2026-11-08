# 机器人大会展台 Demo · 总索引

展台演示、地图数据与方案文档。子项目各有自己的 `INDEX.md`，本文件只做导航。

**最终产物：`command_demo/cinematic.html`（观感版）。** 旧版已停用，见 `archive/`。

技术文档见 [`docs/06_3D技术架构.md`](docs/06_3D技术架构.md)。

---

## 一、目录结构

| 路径 | 作用 |
| --- | --- |
| `command_demo/` | 主项目。Vite + three.js，最终产物是 `cinematic.html` |
| `map_trace/` | 地图数据生产。当前链路是 `newmap3/`，早期版本按 `newmap2`、`newmap`、根目录脚本排列 |
| `docs/` | 方案、交接与技术文档；`docs/screenshots/` 是运行态截图 |
| `source/` | 原始输入：六张地图、91 项任务表、早期设想存档 |
| `archive/` | 旧版归档：早期静态展示页、旧单文件构建 |
| `_local/` | 本地大素材（`assets_raw`）与外部参考工程（`xiaogou`），整目录不入库 |
| `README.md` | 项目门面：是什么、怎么跑 |

---

## 二、子项目入口

### 主项目

```text
command_demo/
├── 观感版演示.html          最终交付：单文件离线包，双击即开
├── cinematic.html          观感版源码入口
├── index.html              联动指挥主演示（旧版，仅作业务参考，不展示）
├── src/
│   ├── core/               渲染、场景缓存、调度、事件、合并
│   ├── cine/               观感版场景与业务层
│   ├── map/                坐标、地图构建、寻路、行走网格
│   ├── entities/           机器狗与人形
│   ├── views/              第一人称、指挥图、弹窗、HUD
│   └── data/               执行体与剧本数据
├── tools/bundle.mjs        单文件打包
└── tools/checks/           验收脚本，见该目录 README
```

### 地图数据

| 目录 | 状态 | 内容 |
| --- | --- | --- |
| `map_trace/newmap3/` | **当前** | 从色块总平面图生成 `map_package.json` 与 `ground.png`；图幅 1333 × 1079，5 个区域、122 栋建筑、8 米宽道路、160 棵行道树 |
| `map_trace/newmap2/` | 补充数据 | 小区环路与楼栋、东西两山轮廓、地铁站台与列车参数，产出 `scene_extra.json`；前端仍在读 |
| `map_trace/newmap/` | 历史 | 过渡期分区图链路：区域、建筑迁移、道路、行走掩膜 |
| `map_trace/*.py` | 历史 | 第一版描图：轮廓、色块分割、要素整理，产出 `out/` |
| `map_trace/_archive/` | 归档 | 改数据前的 `map_package.json` 与 `ground.png` 快照（2026-11-06） |

前端读取的副本在 `command_demo/src/map/data/`，与 `newmap3/` 的产物逐字节一致。

### 方案文档

| 文件 | 内容 |
| --- | --- |
| `docs/01_对话与取舍.md` | 需求访谈、可行性判断、关键取舍、风险 |
| `docs/02_技术方案.md` | 最早的架构设想：事件模型、研判规则、检测与调度 |
| `docs/03_联动指挥方案.md` | 展台版实施口径与冻结的接口契约 |
| `docs/04_观感版整改方案.md` | 画质与场景整改记录 |
| `docs/05_交接与当前状态.md` | 交接用：做到哪、没做哪、已知问题 |
| `docs/06_3D技术架构.md` | 当前 3D 版本的技术架构、选型、设计思路、扩展与优化 |

---

## 三、当前状态

- **最终产物**是观感版 `command_demo/cinematic.html`，交付形态是单文件 `command_demo/观感版演示.html`：8 MB，双击即开，断网可用。四场景共用一套建筑构件与材质，校园与小区共八台设备，摄像头报警后就近派单。
- 联动指挥主演示 `command_demo/index.html` 停用，源码保留作业务逻辑参考。
- 早期静态展示页与旧单文件构建已移入 `archive/`。
- 地图数据已换成 2026-11-06 的新图（1333 × 1079），前端与 `newmap3` 产物同步。
- 真实视频素材目录为空，接入接口与降级路径已就绪。
- 单文件包已验证：`file://` 打开四个场景，46 个素材全部内联，贴图解码正常，控制台无报错。无头软件渲染帧率不代表真机。
- 比例尺口径不一致：数据包 `meters_per_px` 为 1.0，旧文档与 note 字段写 0.5，待实测校正。

## 四、数据链路

```text
source/maps/*.jpg|png
  → map_trace/newmap3/build_package.py        map_package.json + ground.png
  → map_trace/newmap2/*.py                    scene_extra.json
  → command_demo/src/map/data/                前端副本
  → src/map/build_scene.js · src/cine/scene_*.js
```

改数据的顺序与依赖见 `docs/04_观感版整改方案.md` 第 9.4 节。`map_package.json`、`ground.png`、
`scene_extra.json` 都是生成物，不手改。

## 五、参考代码

`_local/xiaogou/小狗模型演示/` 是外部提供的四足机器人巡检演示，借用了 `engine`、`kit`、`tex`、`dog` 等模块。
该工程的 pnpm 软链指向旧路径 `E:\code\小狗模型演示`，直接跑会失败，要改就先重装依赖。
