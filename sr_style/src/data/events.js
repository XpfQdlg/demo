/* ══════════════════════════════════════════════════════════════════════════
   告警剧本 — 演示用的可复现剧情

   写成数据而不是散落在代码里，好处是改剧情不用碰逻辑。
   target_id 对应场景里已有的巡检点位，点位坐标由 build_scene 提供。

   每个剧本是一串步骤：
     { at: 毫秒, do: 'detect' | 'wait' | 'resolve', ... }
   ══════════════════════════════════════════════════════════════════════════ */

export const SCENARIOS = [
  {
    id: "s1",
    name: "校园 · 教学楼东侧明火",
    scene: "campus",
    summary: "高风险事件，调度最近的机器狗，弹窗询问是否切换视角",
    steps: [
      {
        at: 1200,
        do: "detect",
        target_id: "t-smoke",
        sev: "alarm",
        title: "教学楼东侧发现明火",
        detail: "画面中出现连续上升烟羽与明火区域，疑似初期火灾",
        conf: 0.97,
        action: "立即高音告警并回传火点坐标，联动消防控制室",
      },
      { at: 9000, do: "resolve" },
    ],
  },
  {
    id: "s2",
    name: "地铁 · 站厅人员拥挤",
    scene: "subway",
    summary: "中风险事件，调度人形机器人，视高更适合观察人群",
    steps: [
      {
        at: 1200,
        do: "detect",
        target_id: "t-m-density",
        sev: "warn",
        title: "站厅人员密度超阈值",
        detail: "区域内聚集人员数量超过阈值，密度高于 1.2 人/m²",
        conf: 0.91,
        action: "语音提示分流，联动站务引导乘客",
      },
      { at: 9000, do: "resolve" },
    ],
  },
  {
    id: "s3",
    name: "小区 · 电动车入楼",
    scene: "community",
    summary: "中风险事件，同场景两台设备，演示就近选择与占用互斥",
    steps: [
      {
        at: 1200,
        do: "detect",
        target_id: "t-cm-1",
        sev: "warn",
        title: "单元门厅电动车入楼",
        detail: "检测到电动车进入楼栋门厅，存在充电起火风险",
        conf: 0.94,
        action: "语音劝阻并推送物业，记录车辆特征",
      },
      { at: 9000, do: "resolve" },
    ],
  },
];

export const scenario_by_id = (id) => SCENARIOS.find((s) => s.id === id) || null;

/** 等级 → 中文标签与配色键 */
export const SEV_META = {
  alarm: { label: "高风险", color: "#ff5a6a" },
  warn: { label: "需关注", color: "#ffb454" },
  info: { label: "正常", color: "#46e39a" },
};
