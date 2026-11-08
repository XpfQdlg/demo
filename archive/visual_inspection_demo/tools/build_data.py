# -*- coding: utf-8 -*-
"""
build_data.py —— 把功能清单整理成前端可直接读取的数据文件

设计原则：
1. 唯一数据源放在本脚本里，前端所有数字都由数据计算，不手写。
2. 输出 assets/js/data.js，用普通 <script> 加载，index.html 直接双击也能打开，不依赖网络。
3. 条目内容来自 D:/Desktop/demo/各组人员任务表.md，并修正了原文的计数矛盾：
   森林 标题 7 项 / 实际 8 行；小区 标题 21 项 / 实际 20 行；
   地铁 标题 32 项 / 实际 33 行；小区第 7、14 条内容重复。

用法：
    python tools/build_data.py
"""

import json
import os
from datetime import date

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(BASE_DIR, "assets", "js", "data.js")

# ---------------------------------------------------------------- 场景定义
SCENES = [
    {
        "id": "forest",
        "index": "01",
        "name": "森林",
        "en": "FOREST",
        "summary": "林区火情、病虫害与人为风险巡检",
    },
    {
        "id": "community",
        "index": "02",
        "name": "小区",
        "en": "RESIDENTIAL",
        "summary": "社区公共区域与地下空间日常巡检",
    },
    {
        "id": "campus",
        "index": "03",
        "name": "校园",
        "en": "CAMPUS",
        "summary": "教学楼、宿舍、道路与实验室综合巡检",
    },
    {
        "id": "metro",
        "index": "04",
        "name": "地铁",
        "en": "METRO",
        "summary": "站厅、通道与设备用房高频巡检",
    },
]

# ---------------------------------------------------------------- 功能域定义
DOMAINS = [
    {"id": "A", "name": "消防安全"},
    {"id": "B", "name": "水与泄漏"},
    {"id": "C", "name": "设备状态"},
    {"id": "D", "name": "结构破损"},
    {"id": "E", "name": "秩序与行为"},
    {"id": "F", "name": "环境卫生"},
    {"id": "G", "name": "遗留物与物品"},
    {"id": "H", "name": "森林专项"},
]


def make(scene, domain, name, target, **extra):
    """构造一条功能记录，字段完整，避免前端到处判空。"""
    record = {
        "scene": scene,
        "domain": domain,
        "name": name,
        "target": target,
        "category": extra.get("category", ""),
        "priority": extra.get("priority", ""),
        "algorithm": extra.get("algorithm", ""),
        "model_base": extra.get("model_base", ""),
        "schedule": extra.get("schedule", ""),
        "data_status": extra.get("data_status", ""),
        "note": extra.get("note", ""),
        "dup": extra.get("dup", False),
    }
    return record


# ---------------------------------------------------------------- 森林（8 项）
FOREST = [
    make("forest", "A", "明火 / 烟雾 / 微烟雾", "可见火苗、可见烟雾、早期微烟雾"),
    make("forest", "H", "树干虫害与病害", "树干异常"),
    make("forest", "H", "树叶虫害与病斑", "叶片虫斑、病斑"),
    make("forest", "E", "吸烟行为", "人员吸烟动作"),
    make("forest", "H", "倒木与断枝", "倒伏树木、断枝"),
    make("forest", "H", "林间道路障碍", "道路通行受阻"),
    make("forest", "A", "消防器材", "灭火器、消防栓"),
    make("forest", "F", "树林垃圾", "林区内垃圾散落"),
]

# ---------------------------------------------------------------- 小区（20 项）
COMMUNITY = [
    make("community", "E", "出入口拥挤", "出入口人流密集"),
    make("community", "E", "人员异常聚集", "重点区域人员聚集"),
    make("community", "E", "电动车违规停放", "电动车占道停放"),
    make("community", "E", "电动车入楼检测", "电动车进入楼宇"),
    make("community", "C", "地面减速带识别", "减速带位置 / 状态"),
    make("community", "C", "路灯亮灭状态", "路灯夜间是否点亮"),
    make(
        "community", "A", "烟雾火灾监测", "可见烟雾、明火",
        dup=True, note="与第 14 条「烟雾火焰识别」内容重复，按同一能力计数",
    ),
    make("community", "A", "防火门状态", "常闭式防火门异常敞开"),
    make("community", "D", "井盖异常", "井盖缺失、移位、破损"),
    make("community", "E", "道路障碍物", "道路上的石块、杂物等"),
    make("community", "D", "路面破损", "裂缝、坑洞、路面破损"),
    make("community", "B", "地面积水（道路 / 楼宇公共区）", "积水区域"),
    make("community", "B", "地面积水（地下车库）", "地下车库积水"),
    make(
        "community", "A", "烟雾火焰识别", "可见烟雾、明火",
        dup=True, note="与第 7 条「烟雾火灾监测」内容重复，按同一能力计数",
    ),
    make("community", "F", "垃圾满溢", "垃圾桶满溢"),
    make("community", "F", "楼道堆物", "楼道堆放杂物"),
    make("community", "D", "小区围栏破损", "围栏倾倒、破损、缺失"),
    make("community", "C", "地下车库灯具故障", "车库照明不亮"),
    make("community", "A", "消防栓识别（2 类）", "消防栓箱门、遮挡、缺失"),
    make("community", "A", "灭火器识别（5 类）", "灭火器在位、缺失、倾倒、压力异常等"),
]

# ---------------------------------------------------------------- 校园（30 项）
# 字段对应详表：场景子类 / 识别任务 / 异常目标 / 优先级 / 建议算法 / 现有模型基础 / 开发安排 / 数据现状
CAMPUS = [
    make("campus", "C", "机械开关识别", "开关位置、阀门手柄状态",
         category="实验室安全", priority="高", algorithm="YOLO 检测 + 开闭分类",
         model_base="已有机械开关模型", schedule="直接集成", data_status="实拍 196，未训练"),
    make("campus", "D", "地砖破损检测", "裂纹、破损、地砖缺失",
         category="教学楼巡检", priority="中", algorithm="实例分割 / 异常检测",
         model_base="需新数据集", schedule="第二批", data_status="实拍 198，未训练"),
    make("campus", "D", "围栏设施检测", "倾倒、破损、缺失",
         category="设备设施", priority="中", algorithm="实例分割 + 定点对比",
         model_base="需新数据集", schedule="第二批", data_status="实拍 200 + 公共 1200，未标注"),
    make("campus", "B", "地面积水检测", "瓷砖积水、走廊漏水",
         category="教学楼巡检", priority="高", algorithm="YOLO 分割 + 跨帧确认",
         model_base="已有地面积水模型", schedule="场景迁移", data_status="实拍 190 + 公共 2000+，未训练"),
    make("campus", "B", "道路积水检测", "水坑、道路积水",
         category="校园道路", priority="高", algorithm="分割 + 多帧一致性",
         model_base="已有地面积水模型", schedule="场景迁移", data_status="—"),
    make("campus", "B", "液体泄漏检测", "地面漏水、可见液体",
         category="实验室安全", priority="高", algorithm="YOLO 分割 + 时序分析",
         model_base="已有跑冒滴漏模型", schedule="场景迁移", data_status="—"),
    make("campus", "B", "公共区域漏水检测", "走廊、洗漱间积水",
         category="宿舍公共区域", priority="高", algorithm="YOLO 分割 + 重复检测",
         model_base="已有地面积水模型", schedule="场景迁移", data_status="—"),
    make("campus", "C", "电梯外观巡检", "层显异常、门前障碍",
         category="设备设施", priority="中", algorithm="OCR + 门前障碍检测",
         model_base="已有 OCR 基础", schedule="第二批", data_status="—"),
    make("campus", "E", "电动车入楼检测", "电动车进入走廊 / 门厅",
         category="宿舍公共区域", priority="高", algorithm="电动车检测 + 区域规则",
         model_base="需电动车数据", schedule="优先新增", data_status="实拍 120+ + 公共 1000，混训 0.74"),
    make("campus", "C", "仪表读数识别", "压力表、温度表、数字仪表",
         category="实验室安全", priority="高", algorithm="仪表检测 + 读数 / OCR",
         model_base="已有机械 / 电子表模型", schedule="直接集成", data_status="公共：机械 7000+，电子 1000+"),
    make("campus", "C", "门窗状态识别", "门窗敞开、玻璃破损",
         category="教学楼巡检", priority="中", algorithm="目标检测 + 状态分类",
         model_base="需新数据集", schedule="第二批", data_status="实拍 200，未训练"),
    make("campus", "A", "防火门状态识别", "常闭门异常敞开",
         category="消防安全", priority="高", algorithm="门体检测 + 开闭分类",
         model_base="需补充数据", schedule="优先新增", data_status="—"),
    make("campus", "A", "安全出口识别", "标识遮挡、指示灯不亮",
         category="消防安全", priority="高", algorithm="检测 + 亮灭分类 + 点位对比",
         model_base="可复用指示灯模型", schedule="场景迁移", data_status="—"),
    make("campus", "A", "烟雾火焰检测", "可见烟雾、明火",
         category="消防安全", priority="高", algorithm="YOLO 检测 + 多帧确认",
         model_base="可迁移森林烟火", schedule="优先新增", data_status="—"),
    make("campus", "E", "楼道障碍物检测", "纸箱、垃圾、遗留物品",
         category="教学楼巡检", priority="高", algorithm="YOLO + 地面区域分割",
         model_base="可复用检测框架", schedule="优先新增", data_status="—"),
    make("campus", "C", "指示灯状态检测", "运行 / 故障指示灯",
         category="实验室安全", priority="高", algorithm="指示灯定位 + 颜色 / 亮灭",
         model_base="已有指示灯模型", schedule="直接集成", data_status="—"),
    make("campus", "C", "路灯状态识别", "夜间路灯不亮",
         category="设备设施", priority="中", algorithm="灯具检测 + 夜间亮灭",
         model_base="可复用亮灭思路", schedule="第二批", data_status="实拍 153 + 公共 2200+，混训 0.6–0.7"),
    make("campus", "D", "井盖状态识别", "缺失、移位、破损",
         category="校园道路", priority="高", algorithm="井盖检测 + 点位比对",
         model_base="需新数据集", schedule="优先新增", data_status="实拍 290 + 公共 1100，混训 0.9"),
    make("campus", "C", "照明灯状态检测", "灯具熄灭、闪烁",
         category="教学楼巡检", priority="中", algorithm="灯具检测 + 视频时序",
         model_base="可复用指示灯判断", schedule="第二批", data_status="实拍 100 + 公共 5000，未标注"),
    make("campus", "E", "道路障碍物检测", "石块、树枝、散落物",
         category="校园道路", priority="高", algorithm="YOLO + RGB-D 空间筛选",
         model_base="可复用 RGB-D", schedule="优先新增", data_status="公共 2 万"),
    make("campus", "F", "楼道堆物检测", "快递箱、垃圾、杂物",
         category="宿舍公共区域", priority="高", algorithm="YOLO + 走廊分割 + 持续时间",
         model_base="可复用快递箱识别", schedule="优先新增", data_status="实拍 300 + 数据 200"),
    make("campus", "A", "灭火器识别", "缺失、倾倒、位置异常",
         category="消防安全", priority="高", algorithm="YOLO 检测 + 点位对比",
         model_base="已有灭火器模型", schedule="直接集成", data_status="公共 140 + 实拍 40"),
    make("campus", "E", "非机动车乱停放", "电动车、自行车占道",
         category="校园道路", priority="高", algorithm="车辆检测 + 禁停规则",
         model_base="可复用检测框架", schedule="优先新增", data_status="实拍 230，在标注"),
    make("campus", "E", "人员聚集检测", "区域密度异常",
         category="人员安防", priority="中", algorithm="人员检测 + 计数 / 密度",
         model_base="可复用人员检测", schedule="第二批", data_status="实拍 200 + 公共 2200，未训练"),
    make("campus", "A", "消防设施巡检", "灭火器、防火门、疏散标识",
         category="宿舍公共区域", priority="高", algorithm="多目标检测 + 状态规则",
         model_base="已有部分消防模型", schedule="直接集成", data_status="—"),
    make("campus", "A", "消防栓识别", "箱门异常、遮挡、缺失",
         category="消防安全", priority="高", algorithm="YOLO 检测 + 状态分类",
         model_base="已有消防栓模型", schedule="直接集成", data_status="实拍 26，已标注未训练"),
    make("campus", "D", "道路破损识别", "裂缝、坑洞",
         category="校园道路", priority="中", algorithm="裂缝 / 坑洞分割 + 深度",
         model_base="需新数据集", schedule="第二批", data_status="实拍 104 + 公共 4000，未训练"),
    make("campus", "A", "消防通道占用", "自行车 / 车辆 / 杂物堵塞",
         category="消防安全", priority="高", algorithm="YOLO + 电子围栏 + 持续时间",
         model_base="可复用检测框架", schedule="优先新增", data_status="公共 700+，训练效果差"),
    make("campus", "F", "公共区域垃圾识别", "垃圾散落、垃圾桶满溢",
         category="教学楼巡检", priority="高", algorithm="YOLO 检测 + 实例分割",
         model_base="需补充垃圾数据", schedule="优先新增", data_status="—"),
    make("campus", "H", "绿化树木异常", "倒伏、断枝、枯死",
         category="校园道路", priority="中", algorithm="目标检测 + 状态分类",
         model_base="可迁移森林巡检", schedule="第二批", data_status="实拍 150+"),
]

# ---------------------------------------------------------------- 地铁（33 项）
METRO = [
    make("metro", "E", "妨碍通行物品", "行李箱、纸箱、杂物占用通道"),
    make("metro", "B", "地面积水 / 湿滑", "瓷砖积水、漏水、湿滑区域"),
    make("metro", "C", "压力表 / 指针温度表 / 流量表", "仪表读数"),
    make("metro", "D", "地砖裂缝 / 缺角 / 缺失", "地砖破损"),
    make("metro", "B", "墙面水渍 / 顶棚渗漏", "墙面水渍、顶棚渗漏痕迹"),
    make("metro", "C", "指示灯亮灭与颜色", "红 / 黄 / 绿指示灯状态"),
    make("metro", "C", "拨动开关 / 旋钮 / 手柄位置", "机械开关状态"),
    make("metro", "A", "灭火器在位 / 倾倒 / 破损", "消防器材状态"),
    make("metro", "F", "垃圾桶满溢 / 周边垃圾散落", "垃圾"),
    make("metro", "C", "数显温度 / 压力 / 电流 / 电压表", "数字仪表读数"),
    make("metro", "G", "遗留物品", "箱包、塑料瓶、无人看管物品"),
    make("metro", "D", "座椅 / 护栏 / 墙面破损", "公共设施破损"),
    make("metro", "B", "阀门渗漏 / 管道滴水 / 油液泄漏", "液体泄漏"),
    make("metro", "D", "设备管路锈蚀腐蚀", "表面锈蚀斑"),
    make("metro", "E", "杂物货物妨碍通行", "通道占用"),
    make("metro", "E", "人员密度", "区域密度异常"),
    make("metro", "A", "可见烟雾 / 早期烟雾", "烟雾"),
    make("metro", "A", "明火 / 异常火苗", "明火"),
    make("metro", "C", "柜门异常开启 / 未关严", "柜门状态"),
    make("metro", "C", "门边 / 缝隙异物", "门缝异物"),
    make("metro", "A", "常闭式防火门未关 / 门前堆物", "防火门"),
    make("metro", "A", "疏散指示灯不亮 / 标识遮挡", "疏散标识"),
    make("metro", "E", "轮椅 / 行李长期阻挡", "无障碍通道占用"),
    make("metro", "C", "售票机识别", "售票机状态"),
    make("metro", "D", "边角破损 / 踏步缺陷", "台阶破损"),
    make("metro", "D", "门扇损坏 / 玻璃破裂", "门体破损"),
    make("metro", "B", "天花板滴水 / 管线渗漏", "顶部渗漏"),
    make("metro", "A", "出口导向标识缺失 / 遮挡", "导向标识"),
    make("metro", "C", "门体开闭 / 疑似未闭合", "屏蔽门 / 门体状态"),
    make("metro", "A", "消防栓箱遮挡 / 箱门异常", "消防栓箱"),
    make("metro", "E", "跌倒 / 长时间卧倒", "人员异常姿态"),
    make("metro", "E", "攀爬护栏 / 翻越围挡", "异常行为"),
    make("metro", "E", "持续肢体冲突", "斗殴行为"),
]


def build():
    """合并四个场景，补上稳定 id，输出 data.js。"""
    functions = FOREST + COMMUNITY + CAMPUS + METRO
    counters = {}
    for item in functions:
        scene = item["scene"]
        counters[scene] = counters.get(scene, 0) + 1
        item["id"] = "%s-%02d" % (scene, counters[scene])

    # 校正说明：原文标题与表格行数不一致，这里如实记录，前端可展示
    corrections = [
        {"scene": "forest", "claim": "原文标题 7 项", "actual": len(FOREST)},
        {"scene": "community", "claim": "原文标题 21 项", "actual": len(COMMUNITY)},
        {"scene": "campus", "claim": "原文标题 30 项", "actual": len(CAMPUS)},
        {"scene": "metro", "claim": "原文标题 32 项", "actual": len(METRO)},
    ]

    payload = {
        "meta": {
            "title": "视觉巡检能力全景",
            "subtitle": "四场景 · 八大功能域",
            "source": "各组人员任务表.xlsx / .md",
            "generated_at": date.today().isoformat(),
            "total": len(functions),
            "duplicates": sum(1 for f in functions if f["dup"]),
            "corrections": corrections,
        },
        "scenes": SCENES,
        "domains": DOMAINS,
        "functions": functions,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("// 本文件由 tools/build_data.py 自动生成，请勿手工修改。\n")
        f.write("// 生成日期：%s\n" % payload["meta"]["generated_at"])
        f.write("window.VISION_DATA = ")
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print("已生成:", OUT_PATH)
    print("条目总数:", len(functions), "重复标记:", payload["meta"]["duplicates"])
    for scene in SCENES:
        print("  %-10s %d 项" % (scene["name"], counters.get(scene["id"], 0)))


if __name__ == "__main__":
    build()
