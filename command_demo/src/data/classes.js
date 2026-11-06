/* ══════════════════════════════════════════════════════════════════════════
   检测类别库 — 每个类别的风险等级、判定话术、处置动作、模型与尺寸。
   场景文件只负责摆几何体，文案统一从这里取，保证四个场景风格一致。
   sev: alarm=高风险 / warn=需关注 / info=正常
   ══════════════════════════════════════════════════════════════════════════ */
export const CLASSES = {
  /* ── 通用 ─────────────────────────────────────────────────────────── */
  litter: {
    sev: "info", model: "yolo11s-seg", size: [1.0, 0.5, 1.0],
    desc: "地面发现塑料袋、饮料瓶等零星生活垃圾，未构成安全隐患。",
    action: "标记清理点位并回传照片，通知保洁班次顺路收运。",
  },
  trash_full: {
    sev: "warn", model: "yolo11s-seg", size: [0.8, 1.15, 0.8],
    desc: "垃圾桶内物料超过有效容积 90%，桶口出现外溢堆积。",
    action: "生成清运工单并同步保洁，超过 2 小时未处理则升级告警。",
  },
  fire_equipment: {
    sev: "info", model: "yolo11m-obb", size: [1.1, 1.4, 0.7],
    desc: "灭火器与消防栓在位，压力表指针位于绿区，外观无破损遮挡。",
    action: "器材状态正常，记录巡检时间并续期台账。",
  },
  hydrant: {
    sev: "info", model: "yolo11m-obb", size: [0.7, 1.15, 0.7],
    desc: "室内外消防栓箱体完整，接口无渗漏，前方 1.5 m 内无遮挡。",
    action: "确认水压正常后归档，纳入月度消防设施台账。",
  },
  extinguisher: {
    sev: "info", model: "yolo11s-obb", size: [0.32, 0.62, 0.32],
    desc: "手提式干粉灭火器压力正常，铅封完好，检验标签在有效期内。",
    action: "记录编号与有效期，临近过期时自动生成更换提醒。",
  },
  smoke_fire: {
    sev: "alarm", model: "yolo11s-fire", size: [1.6, 1.4, 1.6],
    desc: "画面中出现连续上升烟羽与明火区域，疑似初期火灾。",
    action: "立即高音告警并回传火点坐标，联动消防控制室与现场值班员。",
  },
  street_lamp: {
    sev: "warn", model: "yolo11s-cls", size: [0.5, 4.5, 0.5],
    desc: "灯杆姿态正常，灯头照度不足或昼间异常点亮，判定灯具故障。",
    action: "上报路灯运维并标注杆号，夜间复检确认是否恢复。",
  },
  manhole: {
    sev: "warn", model: "yolo11s-obb", size: [0.75, 0.12, 0.75],
    desc: "井盖出现沉降、翘起或边缘破损，存在绊倒与坠落风险。",
    action: "设置临时警示并上报市政管网，24 小时内复检。",
  },
  puddle: {
    sev: "warn", model: "yolo11s-seg", size: [1.8, 0.06, 1.3],
    desc: "路面存在成片积水，覆盖面积约 2.4 m²，反光明显。",
    action: "判断积水深度低于 3 cm，标记湿滑区域并建议加设排水检查。",
  },
  road_obstacle: {
    sev: "warn", model: "yolo11s-seg", size: [1.2, 0.9, 0.8],
    desc: "通行路径上出现固定障碍物，占用有效宽度约 60%。",
    action: "上报占道位置并自动规划绕行路径，保留现场取证图。",
  },
  crowd: {
    sev: "warn", model: "yolo11s-pose", size: [2.6, 1.7, 2.6],
    desc: "区域内聚集人员数量超过阈值，密度高于 1.2 人/m²。",
    action: "播报疏导提示并推送至值班室，持续监测密度变化。",
  },
  fence_broken: {
    sev: "warn", model: "yolo11s-seg", size: [3.2, 1.6, 0.2],
    desc: "围栏出现倒伏与缺口，有效封闭高度不足 0.6 m。",
    action: "标记破损段坐标，通知物业封堵并增设临时警戒。",
  },
  corridor_clutter: {
    sev: "warn", model: "yolo11s-seg", size: [1.4, 1.1, 0.8],
    desc: "疏散通道内堆放纸箱、家具等杂物，占道宽度约 0.8 m。",
    action: "判定疏散受阻，生成整改单并记录整改前影像。",
  },
  fire_door: {
    sev: "warn", model: "yolo11s-cls", size: [1.0, 2.1, 0.3],
    desc: "常闭式防火门处于开启状态，闭门器与顺序器工作异常。",
    action: "播报语音提示关门，超时仍未关闭则推送消防值班。",
  },
  liquid_leak: {
    sev: "warn", model: "yolo11s-seg", size: [1.2, 0.05, 1.0],
    desc: "地面出现不明液体扩散痕迹，边缘有明显流淌方向。",
    action: "标记液体范围并取样取证，通知后勤排查管路与接水点。",
  },
  label_plate: {
    sev: "info", model: "yolo11s-obb", size: [0.4, 0.6, 0.05],
    desc: "标识牌表面清晰可读，安装高度与朝向符合规范。",
    action: "读取牌面信息与编号，写入设施档案。",
  },
  tile_broken: {
    sev: "warn", model: "yolo11s-seg", size: [0.6, 0.03, 0.6],
    desc: "铺装面层出现裂纹、缺角与起拱，面积约 0.35 m²。",
    action: "记录破损范围与位置，提交维修工单并设置临时提示。",
  },
  road_crack: {
    sev: "warn", model: "yolo11s-seg", size: [2.2, 0.03, 0.35],
    desc: "路面出现细长裂缝并伴随轻微沉陷，长度约 2.1 m。",
    action: "量测裂缝宽度并定位，纳入道路病害台账跟踪。",
  },
  vehicle_misplaced: {
    sev: "warn", model: "yolo11s-obb", size: [0.7, 1.1, 1.8],
    desc: "电动车停放在楼栋出入口与疏散通道处，占用通行空间。",
    action: "语音提醒挪车并推送车主信息，超时转人工处理。",
  },
  ebike_indoor: {
    sev: "alarm", model: "yolo11s-obb", size: [0.7, 1.1, 1.8],
    desc: "电动车进入楼栋内厅停放，存在电池充电起火风险。",
    action: "立即声光告警并通知物业到场处置，同步上报消防。",
  },
  garage_lamp: {
    sev: "warn", model: "yolo11s-cls", size: [1.2, 0.16, 0.3],
    desc: "地下车库灯具出现闪烁与熄灭，该区域照度低于 30 lux。",
    action: "标记故障灯位并推送机电班组，建议同步检查线路。",
  },
  meter: {
    sev: "info", model: "yolo11s-obb", size: [0.3, 0.3, 0.15],
    desc: "表盘指针读数清晰，当前示值处于正常工作区间。",
    action: "OCR 读取示值并入库，与历史曲线比对无异常漂移。",
  },
  switch_panel: {
    sev: "info", model: "yolo11s-cls", size: [0.5, 0.6, 0.2],
    desc: "开关与旋钮的位置状态可辨识，与远程信号一致。",
    action: "记录开关状态与面板编号，异常时联动远程校核。",
  },
  door_state: {
    sev: "info", model: "yolo11s-cls", size: [0.9, 2.1, 0.16],
    desc: "门窗开闭状态与限位装置正常，玻璃无破损。",
    action: "确认关闭状态并归档，纳入日常巡查记录。",
  },
  elevator: {
    sev: "warn", model: "yolo11s-cls", size: [1.2, 2.2, 0.2],
    desc: "电梯层门外观与呼梯面板可见异常指示灯，门缝有异物。",
    action: "记录梯号与楼层，通知电梯维保单位现场确认。",
  },
  indicator: {
    sev: "warn", model: "yolo11s-cls", size: [0.4, 0.2, 0.1],
    desc: "指示灯实际状态与系统指令不一致，存在异常点亮或熄灭。",
    action: "判定信号异常并定位回路，推送机电班组复核。",
  },
  light_fixture: {
    sev: "warn", model: "yolo11s-cls", size: [1.2, 0.14, 0.3],
    desc: "照明灯具出现不亮、频闪或灯罩脱落。",
    action: "标记灯位与回路，纳入照明维护工单。",
  },
  ceiling_drip: {
    sev: "warn", model: "yolo11s-seg", size: [0.9, 0.9, 0.9],
    desc: "顶板出现渗水点并持续滴水，下方地面出现积水。",
    action: "定位渗漏点并上报土建，设置接水盘与警戒区。",
  },
  pipe_rust: {
    sev: "warn", model: "yolo11s-seg", size: [1.6, 0.3, 0.3],
    desc: "管路表面出现锈蚀与保温层破损，局部有渗漏痕迹。",
    action: "标记锈蚀段落并建议除锈防腐，列入年度检修。",
  },
  valve_leak: {
    sev: "alarm", model: "yolo11s-seg", size: [0.5, 0.6, 0.5],
    desc: "阀门填料处出现连续滴漏，阀体下方地面已见水渍。",
    action: "立即告警并通知机电值班关闭上游阀，记录泄漏速率。",
  },
  gauge: {
    sev: "info", model: "yolo11s-obb", size: [0.16, 0.16, 0.08],
    desc: "压力表读数在绿区，指针稳定无抖动。",
    action: "OCR 读取数值并入库，超限时自动推送报警。",
  },
  left_item: {
    sev: "warn", model: "yolo11s-seg", size: [0.9, 0.6, 0.6],
    desc: "座椅或通道旁发现无人看管的行李物品，静置超过 10 分钟。",
    action: "标记物品位置并长时间跟踪，按预案通知站务与安检。",
  },
  seat_damage: {
    sev: "warn", model: "yolo11s-seg", size: [1.2, 0.9, 0.5],
    desc: "座椅面层破损、护栏变形，存在划伤乘客风险。",
    action: "记录破损部位并围挡，推送站内设施维修。",
  },
  fall_detect: {
    sev: "alarm", model: "yolo11s-pose", size: [1.8, 0.7, 1.0],
    desc: "检测到人员长时间倒地卧倒，姿态持续超过 15 秒未变化。",
    action: "立即告警并通知站务人员前往查看，同步调取监控。",
  },
  climb_rail: {
    sev: "alarm", model: "yolo11s-pose", size: [1.2, 1.8, 0.6],
    desc: "检测到人员攀爬护栏行为，处于坠落与侵入限界风险中。",
    action: "即时语音制止并推送站务，必要时联动紧急停车。",
  },
  conflict: {
    sev: "alarm", model: "yolo11s-pose", size: [1.6, 1.8, 1.2],
    desc: "画面中两名人员出现肢体冲突动作，周边乘客开始避让。",
    action: "立即上报站务与警务室，保存前后 30 秒录像证据。",
  },
  crowd_density: {
    sev: "warn", model: "yolo11s-pose", size: [3.2, 1.7, 3.2],
    desc: "站台人群密度上升至 1.6 人/m²，接近限流阈值。",
    action: "推送客流预警并建议启动限流，播报疏导广播。",
  },
  blocked_path: {
    sev: "warn", model: "yolo11s-seg", size: [1.6, 1.2, 1.0],
    desc: "通道内堆放货物与纸箱，有效通行宽度不足 0.8 m。",
    action: "判定通行受阻并上报站务清理，记录占道范围。",
  },
  ticket_machine: {
    sev: "warn", model: "yolo11s-cls", size: [0.8, 1.6, 0.6],
    desc: "售票机屏幕提示故障，出票口有卡票痕迹。",
    action: "记录设备编号与故障码，推送票务运维处理。",
  },
  glass_crack: {
    sev: "warn", model: "yolo11s-seg", size: [1.4, 2.2, 0.05],
    desc: "门扇玻璃出现放射状裂纹，裂纹中心存在冲击点。",
    action: "设置警示围挡并测量裂纹扩展，安排更换玻璃。",
  },
  stair_damage: {
    sev: "warn", model: "yolo11s-seg", size: [1.2, 0.2, 0.35],
    desc: "踏步边角出现破损与掉棱，宽度约 12 cm。",
    action: "标记破损踏步位置并增设临时防滑条。",
  },
  evacuation_sign: {
    sev: "warn", model: "yolo11s-cls", size: [0.6, 0.25, 0.05],
    desc: "疏散指示标识不亮或方向错误，部分灯珠失效。",
    action: "判定指引失效并立即上报消防值班，纳入隐患整改。",
  },
  cabinet_door: {
    sev: "warn", model: "yolo11s-cls", size: [0.9, 1.6, 0.35],
    desc: "设备柜门未关闭到位，柜内指示灯异常闪烁。",
    action: "提示关门并检查柜内状态，异常时推送机电班组。",
  },
  wall_seep: {
    sev: "warn", model: "yolo11s-seg", size: [1.6, 1.4, 0.1],
    desc: "墙面出现水渍与泛碱，范围约 1.2 m²，疑似渗漏。",
    action: "标记渗漏范围并上报土建，跟踪扩大趋势。",
  },
  tree_health: {
    sev: "warn", model: "yolo11s-seg", size: [2.4, 3.6, 2.4],
    desc: "树冠叶片稀疏发黄，主干倾斜，存在倒伏与断枝风险。",
    action: "采集全景并标记隐患部位，推送园林养护处理。",
  },
  fire_lane: {
    sev: "alarm", model: "yolo11s-seg", size: [2.4, 1.2, 2.0],
    desc: "消防车通道被车辆与杂物占用，净宽不足 4 m。",
    action: "立即告警并推送物业与消防，要求 10 分钟内清理。",
  },
  bicycle_misplaced: {
    sev: "warn", model: "yolo11s-obb", size: [0.6, 1.0, 1.7],
    desc: "非机动车未停入指定区域，挤占人行与无障碍通道。",
    action: "记录停放位置并生成挪车提醒，纳入秩序考核。",
  },
  public_litter: {
    sev: "info", model: "yolo11s-seg", size: [1.2, 0.4, 1.2],
    desc: "公共区域地面发现零星垃圾，未形成堆积。",
    action: "标记清理点并回传照片，通知保洁人员处理。",
  },
  smoking: {
    sev: "warn", model: "yolo11s-pose", size: [0.6, 1.75, 0.5],
    desc: "目标人物手持点燃香烟，处于禁烟范围内。",
    action: "语音播报劝阻并记录画面，持续跟随 30 秒。",
  },
  smoking_area: {
    sev: "warn", model: "yolo11s-pose", size: [0.6, 1.75, 0.5],
    desc: "禁烟区域检测到吸烟行为，地面出现烟蒂。",
    action: "播报劝阻并回传位置，纳入重点巡查点。",
  },
  leaf_lesion: {
    sev: "warn", model: "yolo11s-seg", size: [0.9, 1.0, 0.9],
    desc: "叶面出现黄褐色斑块与卷曲，病斑占比约 18%。",
    action: "采集近景样本并定位病株坐标，生成病虫害工单。",
  },
  trunk_damage: {
    sev: "warn", model: "yolo11s-obb", size: [1.2, 4.0, 1.2],
    desc: "树干存在多处蛀孔与流脂痕迹，树冠叶片枯黄。",
    action: "围树拍摄一圈并标注蛀孔位置，上报林木病害防治。",
  },
  fallen_tree: {
    sev: "warn", model: "yolo11m-seg", size: [3.0, 1.0, 0.8],
    desc: "倒木横跨步道，有效通行宽度不足 0.4 m，伴随断枝散落。",
    action: "判定步道阻断并重规划绕行路径，上报林道清理。",
  },
  open_fire: {
    sev: "alarm", model: "yolo11s-fire", size: [1.2, 0.7, 1.2],
    desc: "检测到持续明火与上升烟羽，火点距林缘不足 15 m。",
    action: "立即高音告警并回传火点坐标，后撤 3 m 保持监视。",
  },
  smoke_plume: {
    sev: "alarm", model: "yolo11s-smoke", size: [1.6, 3.0, 1.6],
    desc: "林间出现柱状灰白烟羽，疑似地下阴燃或初期林火。",
    action: "切换热成像复核并上报疑似火点，请求无人机抵近侦察。",
  },
};

/** 按类别取文案，缺失时给出兜底 */
export function cls(name) {
  return (
    CLASSES[name] || {
      sev: "warn", model: "yolo11s-seg", size: [1.0, 1.0, 1.0],
      desc: "检测到目标，需要人工复核确认。",
      action: "回传现场画面并生成待复核工单。",
    }
  );
}
