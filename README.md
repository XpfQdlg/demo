# 机器人大会展台 Demo

校园、小区、山林、地铁四类场景的视觉巡检演示。3D 主画面是机器狗与人形机器人的视角，
摄像头发现异常后自动呼叫最近的空闲设备前往处置。

> 展台原型，场景与数据为模拟。不声称已在任何真实场地部署。

## 目录

| 路径 | 作用 |
| --- | --- |
| `command_demo/` | 联动指挥演示（主项目）：Vite + three，含观感版与单文件交付物 |
| `visual_inspection_demo/` | 早期静态展示页与实时推理服务，作为兜底保留 |
| `map_trace/` | 校园总平面图描图与数据生成脚本 |
| `docs/` | 方案与交接文档 |
| `INDEX.md` | 总索引，先看这个 |

## 运行

联动指挥演示：

```bash
cd command_demo
npm install
npm run dev
```

- 主演示：<http://localhost:5179/>
- 观感版：<http://localhost:5179/cinematic.html?scene=campus>
  场景可选 `campus` / `community` / `forest` / `subway`

观感版操作：拖动环绕、滚轮推拉、点击地面派单、`1–9` 跟随设备、`G` 回全局、
`空格` 开关第一人称小窗、`R` 复位机位、`H` 收起面板。

## 说明

- 地图比例尺 1 像素 = 0.5 米，为图上估算值，待实测校正。
- 真实视频素材目录为空，接入接口与降级路径已就绪。
- 单文件交付物 `command_demo/联动指挥演示.html` 为 2026-11-05 的构建，之后观感版的改动未并入。

## 依赖

three 0.169、vite 5.4；验收脚本用 puppeteer-core，需要本机安装 Edge 或 Chrome。
