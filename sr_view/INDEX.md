# 雷达建图试验台 · 代码索引

观感版的一个派生试验工程：**不新开面板，把「雷达建图」做成跟随镜头下的一段视觉状态**。
原工程 `../command_demo` 不动，这里单独试效果，确认后再决定要不要并回去。

口径：**示意，不是真实 SLAM**。圈内圈外是同一份仿真场景数据，
只是把「已扫到的部分」显出来，建筑并没有真的被雷达重建过。

---

## 一、文件清单

| 路径 | 作用 |
| --- | --- |
| `cinematic.html` | 页面入口与全部界面样式（从观感版复制，新增 `#scanHud` 一套样式） |
| `vite.config.js` | 开发服配置，端口 5180，只有一个入口 |
| `src/cinematic_main.js` | **主入口**。场景加载、设备跟随、监控报警、扫描模式的接线都在这里 |
| `src/core/scan_mode.js` | **本次新增**。扫描建图：材质注入、地面扫描层、HUD |
| `src/core/cinematic.js` | 渲染器、轨道相机、跟随相机。本次给 `set_follow` 加了 `dist` / `lift` / `ahead` 三个机位参数 |
| `src/core/merge_static.js` | 静态网格按材质合并。**决定了建筑不能逐栋处理**，只能整材质改 shader |
| `src/core/events.js` | 事件层状态机（detected → dispatched → arrived → resolving → resolved） |
| `src/cine/monitor.js` | 摄像头点位、报警、就近派单、处置 |
| `src/cine/scene_*.js` | 四个场景：校园 / 地铁 / 森林 / 小区（小区复用校园场景） |
| `src/views/fp.js` | 第一人称机位（本工程未接，右上小窗由 `cinematic_main.js` 自带逻辑渲染） |
| `src/map/` | 坐标、地图构建、寻路、行走网格、地图数据包 |
| `tools/check_scan.mjs` | 扫描验收：按 1 跟随，四个半径各截一张 |
| `tools/check_scene_switch.mjs` | 切场景后扫描层是否还能画出来 |
| `tools/probe_scan_mats.mjs` | 统计有多少材质没注入扫描 shader |
| `tools/probe_scan_pick.mjs` | 射线诊断：屏幕上一点打到什么、离扫描中心多远 |

其余 `src/` 下的文件与观感版一致，未改动。

---

## 二、入口与数据流

```text
cinematic.html
  └─ src/cinematic_main.js
       ├─ new Cinematic(stage)          渲染器 / 相机 / 后期
       ├─ new ScanMode(cine)            扫描层
       ├─ show(scene)                   建场景 → merge_static → scan.attach
       └─ follow_agent(i)               跟随设备 → scan.begin(设备)
            └─ cine.set_follow(..., {dist, lift, ahead})
```

每帧：

```text
Cinematic._loop
  └─ onFrame(dt, t)
       ├─ scan.update(dt, t)      半径扩张、uniform 更新、HUD
       └─ monitor.tick(dt)        报警与派单（原有逻辑，未改）
```

---

## 三、扫描效果怎么实现的

三层，全在 `src/core/scan_mode.js` 里。

**1. 场景揭示（材质注入）**

`merge_static` 把三千多个网格按材质合并成二三十个大网格，楼不再是独立对象，
逐栋淡入做不到。改成给每个材质 `onBeforeCompile` 注入一段半径场：

- 顶点：算世界坐标，实例化网格走 `instanceMatrix` 分支；
- 片元：世界坐标到扫描圆心的距离超过半径，且高度高于地面半米时，
  **直接 `discard`**——楼、树、车、人整块消失，不是压暗；
- 地面不丢弃，压到近黑，读起来是「未知区域」；
- 半径边缘一条细亮带，像雷达波扫过的前沿。

丢弃阈值比扫描前沿提前一点五米，让建筑长出来的那一下正好被亮环盖住。
**这一条是关键**：早先版本只把圈外压暗，楼还留着暗色轮廓，
一眼就能看出场景本来就在那儿，不像建图。

改的是材质，不是场景结构，所以建筑、道路、绿化、行人、道具一起生效。
**坑：** `show()` 里要注入两次。第一遍在 `merge_static` 之后，
第二遍在行人和摄像头加进来之后，否则扫描圈外的行人会亮着不暗。

**2. 地面扫描层**

一张 900 米见方的平面，自定义 shader 画 2 米网格、外圈亮环、一圈旋转拖尾。
挂在场景根节点下。**坑：** 切场景会把根节点整棵遍历并 dispose 所有几何体，
所以卸载前必须 `scan.unmount()` 把扫描层摘出来，否则下一个场景画不出来。

**3. HUD**

左下角一块面板：扫描半径、重建进度条、`示意`角标。

---

## 四、运行方式

```bash
cd D:\Desktop\demo\sr_view
npm run dev        # http://localhost:5180
```

`node_modules` 是指向 `../command_demo/node_modules` 的目录联接（junction），
不需要重新安装依赖。原工程已装 three 0.169.0 与 vite 5.4.10。

### 操作

| 键 | 作用 |
| --- | --- |
| `1`–`9` | 跟随对应设备，同时开始扫描建图 |
| `G` / `Esc` | 回全局，扫描淡出 |
| `空格` | 开关右上角第一人称小窗 |
| `H` | 收起所有面板 |
| `R` | 重置视角 |

### 验收脚本

先起开发服，再在 `sr_view` 目录下跑：

```bash
node tools/check_scan.mjs           # 截图到 shots/scan_*.png
node tools/check_scene_switch.mjs   # 切场景回归
node tools/probe_scan_mats.mjs      # 材质注入覆盖率
```

---

## 五、依赖

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| three | 0.169.0 | 渲染 |
| vite | 5.4.10 | 开发服与构建 |
| puppeteer-core | ^25.16.0 | 验收脚本（开发依赖） |

贴图与天空在 `public/cinematic/`，共 5.4 MB，均为 CC0 素材。

---

## 六、当前状态与已知限制

已验证：

- 四场景均可进入跟随并扫描，控制台无报错；
- 圈外建筑整块消失，不是压暗；
- 扫描圈内外判定正确（射线诊断：圈内 26 m、圈外 48 m）；
- 切场景后扫描层仍可绘制，几何体未被误销毁；
- 1461 / 1482 个网格材质完成注入，剩下的是天空与标记图标，本就不该压暗。

已知限制：

- **跟随即扫描**，没有和报警绑定。用户原话是「报警时选择跟随才生成」，
  目前任何一台设备被跟随都会扫描，需要确认口径。
- 扫描半径退出跟随后清零，不累积。要做「越走图越大」得把已扫描区域存下来。
- 地铁站厅太小，46 米半径一次覆盖全站，看不出扩张过程；
  机位也退回贴地（抬八米会穿顶）。
- 帧率未在真机测过。无头软件渲染只有 1–5 fps，不代表实际表现。
