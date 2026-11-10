/**
 * battle_map — 「作战地图」备选视觉
 *
 * 不用 3D：直接把 map_package 的建筑轮廓、道路、四个场景范围画成一张
 * 深色指挥地图，四模型用色点 + 覆盖范围标出来，告警用脉冲点和虚线路径。
 * 领导不需要转视角，一眼能看到「哪个模型、在哪个区域、发现了什么」。
 */
import PACKAGE from "../map/data/map_package.json";

const MODEL = [
  { key: "campus", name: "校园巡检模型", color: "#35d7ff", short: "校园" },
  { key: "community", name: "小区安防模型", color: "#ffb84d", short: "小区" },
  { key: "subway", name: "地铁客运模型", color: "#b18cff", short: "地铁" },
  { key: "forest", name: "森林火险模型", color: "#4be08a", short: "森林" },
];

const pts = (poly) => poly.map(([x, y]) => `${x},${y}`).join(" ");
const center = (poly) => {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
};

/* 示意告警：真实事件由 3D 层的 monitor 驱动，这里给地图一个稳定的叙事先验 */
const ALERTS = [
  { x: 560, y: 760, kind: "明火", pct: 92, color: "#ff6b57", model: "校园巡检模型" },
  { x: 1030, y: 720, kind: "出入口拥挤", pct: 87, color: "#ffb84d", model: "小区安防模型" },
  { x: 260, y: 470, kind: "火险烟雾", pct: 81, color: "#ff8a4d", model: "森林火险模型" },
];

export function mount_battle_map() {
  if (document.getElementById("battleMap")) return;
  const el = document.createElement("div");
  el.id = "battleMap";
  const zone = (name, color, fill) => {
    const p = PACKAGE.zones?.[name]?.polygon;
    if (!p) return "";
    return `<polygon points="${pts(p)}" fill="${fill}" stroke="${color}" stroke-width="2.4"
      stroke-opacity=".8" vector-effect="non-scaling-stroke" />`;
  };

  const roads = (PACKAGE.roads?.surface || [])
    .map((s) => `<polygon points="${pts(s.outer)}" fill="#1b2430" stroke="#2b3a48"
      stroke-width="1" stroke-opacity=".55" vector-effect="non-scaling-stroke" />`)
    .join("");

  const buildings = (PACKAGE.buildings || [])
    .filter((b) => (b.area_m2 || 0) > 120)
    .map((b) => `<polygon points="${pts(b.polygon)}" fill="#1a2836" stroke="#3d5a70"
      stroke-width=".7" stroke-opacity=".7" vector-effect="non-scaling-stroke" />`)
    .join("");

  const labels = MODEL.map((m) => {
    const p = PACKAGE.zones?.[m.key]?.polygon;
    if (!p) return "";
    const [x, y] = center(p);
    return `<g transform="translate(${x},${y})">
      <circle r="15" fill="${m.color}" opacity=".14" />
      <circle r="5" fill="${m.color}" />
      <text x="0" y="30" text-anchor="middle" class="bm-zone">${m.name}</text>
      <text x="0" y="47" text-anchor="middle" class="bm-sub">值守中 · 覆盖 ${m.short}</text>
    </g>`;
  }).join("");

  const alerts = ALERTS.map((a) => `<g transform="translate(${a.x},${a.y})">
      <circle r="26" fill="${a.color}" opacity=".12" class="bm-pulse" />
      <circle r="12" fill="${a.color}" opacity=".2" />
      <circle r="4.5" fill="${a.color}" />
      <text x="20" y="-6" class="bm-alert">${a.kind}</text>
      <text x="20" y="12" class="bm-alert-sub">${a.pct}% · ${a.model}</text>
    </g>`).join("");

  el.innerHTML = `<svg viewBox="0 0 1333 1079" preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="bmGrid" width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M60 0H0V60" fill="none" stroke="#8fd4ff" stroke-opacity=".055" stroke-width="1" />
      </pattern>
      <radialGradient id="bmGlow" cx="50%" cy="45%" r="62%">
        <stop offset="0%" stop-color="#12324a" stop-opacity=".55" />
        <stop offset="100%" stop-color="#05080d" stop-opacity="0" />
      </radialGradient>
      <filter id="bmSoft"><feGaussianBlur stdDeviation="5" /></filter>
    </defs>
    <rect x="0" y="0" width="1333" height="1079" fill="#070b12" />
    <rect x="0" y="0" width="1333" height="1079" fill="url(#bmGrid)" />
    <rect x="0" y="0" width="1333" height="1079" fill="url(#bmGlow)" />
    <g opacity=".9">${roads}</g>
    <g>${buildings}</g>
    ${zone("campus", "#35d7ff", "rgba(24,54,64,.35)")}
    ${zone("community", "#ffb84d", "rgba(54,42,20,.28)")}
    ${zone("forest", "#4be08a", "rgba(20,48,30,.32)")}
    ${zone("subway", "#b18cff", "rgba(40,28,60,.32)")}
    <g>${alerts}</g>
    <path d="M560 760 C 640 720, 760 700, 860 660" fill="none" stroke="#35d7ff"
      stroke-width="2" stroke-dasharray="7 7" opacity=".75" class="bm-route" />
  </svg>`;
  document.body.appendChild(el);
}
