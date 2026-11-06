# 校园地图描图 · 代码索引

从校园总平面俯视图提取语义化轮廓，输出可供 3D 场景使用的多边形数据。

源图：`D:\Desktop\demo\demo\04fe1873-e3af-44cc-8c6e-f450ef20e4d7.png`，尺寸 960 × 1218。

---

## 一、文件清单

| 路径 | 作用 |
| --- | --- |
| `segment_zones.py` | 按 HSV 阈值分割绿、青、橙、红、黄、蓝六类色块，生成掩膜 |
| `extract_contours.py` | 从掩膜提取外轮廓，输出原始轮廓 JSON、编号标注图 |
| `union_regions.py` | 对混合色区域做并集，提取待建区域与南部水体的外轮廓 |
| `curate_features.py` | 合并、拆分、命名，生成语义化要素 JSON 与预览图 |
| `render_outputs.py` | 生成无标签轮廓图与 SVG 矢量图 |
| `detect_dots.py` | 检测图中白色建筑中心点，输出坐标与标注图 |
| `make_grid.py` | 给原图叠加 100 像素坐标网格，便于读点 |
| `seg/` | 六类色块掩膜与叠加图 |
| `out/map_contours.json` | 原始轮廓，51 条，含面积、包围盒、质心、点集 |
| `out/union_regions.json` | 待建区域与南部水体的并集轮廓 |
| `out/map_features.json` | **最终使用的地图要素**，20 个语义要素与校园外轮廓 |
| `out/dots.json` | 白色中心点候选，46 个 |
| `out/trace_clean.png` | 原图叠加半透明色块与中文名称，用于人工核对 |
| `out/trace_outline_only.png` | 原图叠加细轮廓，不填充、不写标签 |
| `out/trace_annotated.png` | 原始轮廓编号图，用于追溯来源 |
| `out/dots_annotated.png` | 白色中心点编号图 |
| `out/map_features.svg` | 矢量预览，可直接在浏览器或 Illustrator 中打开 |
| `debug/map_grid.png` | 坐标网格参考图 |

---

## 二、运行顺序

```bash
# 1. 色块分割
python segment_zones.py <源图> seg

# 2. 原始轮廓
python extract_contours.py <源图> seg out

# 3. 混合色区域并集
python union_regions.py seg out

# 4. 语义化与拆分
python curate_features.py <源图> out

# 5. 输出预览图与 SVG
python render_outputs.py <源图> out

# 6. 可选：白色中心点
python detect_dots.py <源图> out
```

所有脚本用参数接收路径，不依赖当前工作目录。

---

## 三、数据格式

`out/map_features.json`：

```json
{
  "image": {"width": 960, "height": 1218, "source": "..."},
  "coordinate_system": "像素坐标，左上角为原点，x 向右，y 向下",
  "height_note": "height_level 为 0-5 的相对高度示意，不是真实米数",
  "campus_boundary": [[x, y], ...],
  "features": [
    {
      "id": "teaching_1",
      "name": "1号教学楼",
      "kind": "teaching",
      "source": "cyan_021",
      "color": "#3fd0d4",
      "height_level": 4,
      "area_px": 16832.5,
      "bbox": [216, 221, 283, 92],
      "centroid": [355.2, 260.9],
      "points": [[x, y], ...]
    }
  ]
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定标识，代码中引用 |
| `name` | 中文名称，用于界面显示 |
| `kind` | 要素类型：residential / teaching / public / lab / sports / plaza / green / water / reserved |
| `source` | 来源轮廓编号或拆分规则，便于追溯 |
| `color` | 界面填充色 |
| `height_level` | 0-5 相对高度，0 表示平面 |
| `area_px` | 像素面积 |
| `bbox` | 包围盒 `[x, y, w, h]` |
| `centroid` | 质心 |
| `points` | 多边形顶点，像素坐标 |

---

## 四、当前还原程度

已完成 20 个语义要素的轮廓描图，包括：

- 五个学生公寓片区、中心广场、南部绿地
- 1 号教学楼、图书馆、校医院、中央院系区 C1/C2、现代教育中心
- 西田径场、东田径场、体育馆
- 实验中心区、人才公寓
- 三块待建区域、南部水体
- 校园外轮廓，60 个点

轮廓保留到分区边界级别。分区内部的单栋建筑，例如 B-1 至 B-10、X-1 至 X-10、C1-1 至 C1-4、C2-1 至 C2-4、D-1 至 D-5，目前没有单独拆分。原因是色块填充在分区内连续，HSV 分割无法直接分开单栋建筑。

已检测到 46 个白色中心点候选，可作为下一步拆分单栋建筑的种子点。用户另有一份描图代码，后续可放入 `tools/legacy_trace/`，按同一数据格式输出，即可合并。

---

## 五、已知限制

1. 坐标是图像像素，不是真实地理坐标。若要标注真实距离，需要给定图上比例尺。
2. 高度是相对等级，不是真实米数。
3. 北区与西区由一条水平线在 `y=150` 处拆开，这条线是建模便利线，不是真实边界。
4. 东田径场与体育馆由一条竖直线在 `x=550` 处拆开，同样是近似。
5. 图中手绘红圈是原图标注，未纳入描图，也不应进入演示。
6. 标签框、文字、图例未纳入要素。
