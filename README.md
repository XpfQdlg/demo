# 机器人大会展台 Demo

**最终产物：`command_demo/cinematic.html`（观感版）。** 四场景 3D 实时画面，机器狗与人形机器人按 A* 巡检，
摄像头发现异常后派最近的空闲设备前往处置。

> 展台原型，场景与数据为模拟。不声称已在任何真实场地部署。

## 目录

| 路径 | 作用 |
| --- | --- |
| `command_demo/` | 主项目。Vite + three.js，最终产物 `观感版演示.html` 在这里 |
| `map_trace/` | 地图数据生产：图像分类、轮廓提取、道路与掩膜、场景参数 |
| `docs/` | 方案、交接与技术文档；**先看 `docs/06_3D技术架构.md`** |
| `source/` | 原始输入：六张地图、任务表、早期设想 |
| `archive/` | 旧版归档：早期静态展示页、旧单文件构建 |
| `_local/` | 本地大素材与外部参考工程，不入库 |
| `INDEX.md` | 总索引 |

## 运行

**展台直接用离线包：双击 `command_demo/观感版演示.html`。** 8 MB，单文件，断网可用，不需要 Node。

开发或改代码：

```bash
cd command_demo
npm install
npm run dev
```

打开 <http://localhost:5179/>，根地址会跳到最终产物：

```text
http://localhost:5179/cinematic.html?scene=campus
```

场景参数 `campus` / `community` / `forest` / `subway`，可加 `&q=low|medium|high`。

改完重新打包：

```bash
npm run bundle          # 输出 观感版演示.html
```

也可以双击 `command_demo/启动.bat`，它会安装依赖、起服务并打开浏览器。

## 操作

| 按键 | 作用 |
| --- | --- |
| 拖动 / 滚轮 | 环绕与推拉 |
| 点击地面 | 派最近的空闲设备过去 |
| `1`–`9` | 跟随设备 |
| `G` / `Esc` | 回到全局俯视 |
| `空格` | 开关第一人称小窗 |
| `R` | 复位机位 |
| `H` | 收起左右面板 |

## 旧版

以下版本已停用，仅留档：

- `command_demo/index.html`：联动指挥主演示，源码保留，不作为展示入口。
- `archive/visual_inspection_demo/`：最早的静态展示页。
- `archive/联动指挥演示_旧版_2026-11-05.html`：旧单文件构建。

## 文档

| 文件 | 内容 |
| --- | --- |
| `docs/06_3D技术架构.md` | 技术架构、选型、设计思路、可扩展性与待优化项 |
| `docs/05_交接与当前状态.md` | 做到哪、没做哪、已知问题与坑 |
| `docs/03_联动指挥方案.md` | 九执行体、视角、调度、接口契约 |
| `docs/04_观感版整改方案.md` | 画质与场景整改记录 |
| `docs/screenshots/` | 运行态截图 |

## 依赖

three 0.169、vite 5.4；验收脚本用 puppeteer-core，需要本机安装 Edge 或 Chrome。
地图脚本用 Python 3 + OpenCV + NumPy。
