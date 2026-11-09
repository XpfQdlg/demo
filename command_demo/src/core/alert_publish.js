/* ══════════════════════════════════════════════════════════════════════════
   alert_publish — 把指挥大屏上的告警状态机推给本机联动总线

   监控层（cine/monitor.js）每推进一步就回调一次，这里把它整理成手机页
   认识的契约（见 src/mobile/contract.js），POST 给开发服里的 alert_bus。
   发不出去不算错：单文件离线包没有服务，手机页自己会落到演示模式。

   同一起异常在整条生命周期里用同一个 id：monitor 每轮会重建 incident
   对象，所以 id 挂在 WeakMap 上，随对象生灭，切场景、重开一轮都不会串号。

   总线地址：
     默认      同源 /api/alerts（开发服 / preview）
     ?bus=URL  指定另一台机器的总线（单文件离线包 + 本机小服务时用）
     file://   退回 http://127.0.0.1:5179/api/alerts（展台电脑开着 dev server 时）
   ══════════════════════════════════════════════════════════════════════════ */

import { KIND_META, SCENE_LABELS } from "../mobile/contract.js";

const API = "/api/alerts";
const params = new URLSearchParams(location.search);
const bus_base = (params.get("bus") || "").trim().replace(/\/+$/, "");

const stats = {
  endpoint: "",
  sent: 0,
  failed: 0,
  last_error: "",
  last_ts: 0,
};

const ids = new WeakMap();
let id_seq = 0;

function endpoint() {
  if (bus_base) return bus_base + API;
  if (location.protocol === "http:" || location.protocol === "https:") return API;
  /* 双击单文件离线包：协议是 file:，相对路径拼不出服务地址。
     展台电脑上一般还开着 dev server 给手机看预警页，就发到本机 5179 */
  if (location.protocol === "file:") return `http://127.0.0.1:5179${API}`;
  return "";
}

/** 同一起异常的生命周期 id：第一次发事件时生成，之后一直复用 */
export function incident_id(inc, tab) {
  let id = ids.get(inc);
  if (!id) {
    id = `${tab || "scene"}-${++id_seq}-${Date.now().toString(36)}`;
    ids.set(inc, id);
  }
  return id;
}

function scene_label_of(tab) {
  return SCENE_LABELS[tab] || "场内";
}

/** 低层发送：永远不 throw，总线没起也不影响大屏渲染。
    串行发送：报警与派单在同一帧里连续触发，HTTP 不保证先后到达；
    手机端是按事件顺序回放状态机的，乱序会让「前往中」被「待派单」覆盖。 */
let send_chain = Promise.resolve();

export function publish_alert(event) {
  const url = endpoint();
  if (!url) return;
  stats.endpoint = url;
  stats.last_ts = Date.now();
  const body = JSON.stringify({ v: 1, source: "cinematic", ts: Date.now(), ...event });

  send_chain = send_chain
    .catch(() => {})
    .then(() =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,   // 页面切场景/刷新时也尽量把最后一条送出去
        mode: "cors",
      })
        .then((res) => {
          if (res.ok) stats.sent++;
          else {
            stats.failed++;
            stats.last_error = `HTTP ${res.status}`;
          }
        })
        .catch((err) => {
          stats.failed++;
          stats.last_error = String(err?.message || err);
        })
    );
}

/** 切换页签：手机页据此换场景名，并把旧场景没闭环的预警收尾 */
export function publish_scene(tab) {
  publish_alert({
    type: "scene",
    scene: tab,
    scene_label: scene_label_of(tab),
  });
}

/**
 * 报警生命周期事件。
 * @param type       alarm / dispatched / arrive / handling / resolved
 * @param inc        monitor 内部的 incident（需要 kind、name、area、camera、px）
 * @param tab        当前页签 id（campus / community / forest / subway）
 * @param agent      可选的执行体 { name, type }
 * @param distance_m 派单距离（米）
 * @param eta_s      预计到场秒数
 * @param note       给手机时间线看的一句补充
 */
export function publish_incident(type, { inc, tab, agent = null, distance_m = null, eta_s = null, note = "" } = {}) {
  if (!inc) return;
  const scene = tab || "campus";
  publish_alert({
    type,
    scene,
    scene_label: scene_label_of(scene),
    incident: {
      id: incident_id(inc, scene),
      kind: inc.kind,
      name: inc.name,
      scene,
      scene_label: scene_label_of(scene),
      area: inc.area,
      camera: inc.camera?.id || inc.camera || "",
      px: inc.px,
      level: KIND_META[inc.kind]?.level ?? 1,
      visitor: inc.visitor === true,
      command_id: inc.visitor ? inc.command_id || null : null,
    },
    agent: agent ? { name: agent.name, type: agent.type } : null,
    distance_m: Number.isFinite(distance_m) ? distance_m : null,
    eta_s: Number.isFinite(eta_s) ? eta_s : null,
    note: note || (inc.visitor ? "观众手机上报 · 指挥中心已受理" : ""),
  });
}

/** 验收脚本用：发了多少、最后一次错在哪 */
export function alert_stats() {
  return { ...stats, endpoint: endpoint() };
}
