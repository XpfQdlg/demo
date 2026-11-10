/**
 * alert_bus — 指挥大屏与手机预警页之间的本机联动总线（Vite 插件）
 *
 * 展台没有后端，但手机要能看到大屏上刚发生的告警、还要能把「观众上报」
 * 送回指挥中枢。做法是在开发服里挂一小块内存总线，双向两路：
 *
 *   告警流（大屏 → 手机）
 *     大屏页面  --POST /api/alerts-->              事件日志（最近 500 条）
 *     手机页面  --GET  /api/alerts/stream (SSE)-->  先收 snapshot，再收 update
 *
 *   指挥流（手机 → 大屏）
 *     手机      --POST /api/commands-->             观众上报指令
 *     大屏页面  --GET  /api/commands/stream (SSE)-->  实时收指令，切场景 / 派单
 *
 * 观众上报的兜底：如果大屏没开（指挥流没有订阅者），总线自己合成一条
 * 完整的预警生命周期（发现→派单→到场→处置→完成），手机照样能看闭环，
 * 不会卡在「已上报」一动不动。
 *
 * 为什么不维护「当前状态」：事件本身就是状态机，手机端按顺序回放
 * 最近的事件日志就能得到完整列表。后打开的手机、刷新过的页面、
 * 断线重连的手机，走的是同一条回放路径，不用另写一套恢复逻辑。
 *
 * 只在开发服与 preview 里生效；单文件离线包没有服务，手机页自动落到
 * 演示模式。手机与电脑必须在同一局域网，dev server 已绑 0.0.0.0。
 *
 * 路由：
 *   POST   /api/alerts             追加一条事件，返回 200
 *   GET    /api/alerts/stream      SSE：snapshot + update
 *   GET    /api/alerts/snapshot    当前事件日志（调试 / 轮询兜底）
 *   GET    /api/alerts/health      总线状态（验收脚本用）
 *   GET    /api/alerts/info        本机局域网地址（二维码用）
 *   POST   /api/alerts/reset       清空事件日志与兜底定时器（验收脚本用）
 *   POST   /api/commands           观众上报 / 语音指挥指令
 *   GET    /api/commands/stream    大屏订阅指挥流（SSE）
 *   GET    /api/commands/health    指挥流状态（验收脚本用）
 *   GET    /api/participants       在线观众（角色 / 积分 / 上报数）
 *   POST   /api/participants       手机注册/更新值班员身份
 *   GET    /api/stats              本场战报统计（参与、上报、最快处置）
 *   POST   /api/frames             大屏回传机器狗第一视角帧
 *   GET    /api/frames/latest      手机取最新回传帧
 */

import os from "node:os";

const API = "/api/alerts";
const CMD_API = "/api/commands";
const PEOPLE_API = "/api/participants";
const STATS_API = "/api/stats";
const FRAME_API = "/api/frames";
const MAX_EVENTS = 500;
const MAX_COMMANDS = 50;
const MAX_PARTICIPANTS = 80;
const MAX_FRAME_CHARS = 400 * 1024;   // 约 300KB 的 JPEG 帧，够手机小窗看
const PARTICIPANT_TTL = 15 * 60 * 1000;
const FRAME_TTL = 12 * 1000;
const KEEPALIVE_MS = 20000;
const MAX_BODY = 512 * 1024;

const ROLES = new Set(["guard", "fire", "inspect", "visitor"]);
const VOICE_ACTIONS = new Set(["scene", "follow", "overview", "report", "battle"]);

const EVENT_TYPES = new Set(["scene", "alarm", "dispatched", "arrive", "handling", "resolved"]);
const SCENES = new Set(["campus", "community", "subway", "forest"]);
const KINDS = new Set(["fire", "crowd", "trash"]);
const KIND_LEVEL = { fire: 3, crowd: 2, trash: 1 };
const KIND_NAME = { fire: "明火", crowd: "人员聚集", trash: "垃圾堆积" };
const SCENE_LABEL = { campus: "校园", community: "小区", subway: "地铁", forest: "森林" };

/* 太宽松会把垃圾数据灌进日志，太严格以后加字段就要改服务端。
   这里只卡「能不能识别」与「能不能合并成卡片」两条。 */
function validate_event(ev) {
  if (!ev || typeof ev !== "object") return false;
  if (!EVENT_TYPES.has(ev.type)) return false;
  if (ev.type === "scene") return typeof ev.scene === "string" && ev.scene.length > 0;
  const inc = ev.incident;
  if (!inc || typeof inc !== "object") return false;
  if (typeof inc.id !== "string" || !inc.id) return false;
  if (!KINDS.has(inc.kind)) return false;
  return true;
}

/** 语音指挥：手机端把识别出的意图发过来，大屏只执行白名单动作 */
function validate_voice_command(raw) {
  if (!raw || raw.type !== "voice_command") return null;
  const action = String(raw.action || "");
  if (!VOICE_ACTIONS.has(action)) return null;

  /* 可选参数只要出现就必须合法，别让大屏悄悄回退到 campus/第一个设备 */
  const has = (key) => raw[key] !== undefined && raw[key] !== null && raw[key] !== "";
  if (has("scene") && !SCENES.has(String(raw.scene))) return null;
  if (has("kind") && !KINDS.has(String(raw.kind))) return null;
  if (has("device")) {
    const d = Number(raw.device);
    if (!Number.isInteger(d) || d < 1 || d > 9) return null;
  }

  const scene = has("scene") ? String(raw.scene) : null;
  const kind = has("kind") ? String(raw.kind) : null;
  const device = has("device") ? Number(raw.device) : null;

  /* 按动作要求必填：切场景要知道场景，跟随要知道几号设备，直接上报要知道场景与异常 */
  if (action === "scene" && !scene) return null;
  if (action === "follow" && device === null) return null;
  if (action === "report" && (!scene || !kind)) return null;

  return {
    type: "voice_command",
    action,
    scene,
    scene_label: scene ? SCENE_LABEL[scene] : null,
    kind,
    device,
    text: typeof raw.text === "string" ? raw.text.trim().slice(0, 80) : "",
    client_id: typeof raw.client_id === "string" ? raw.client_id.slice(0, 64) : "",
  };
}

/** 值班员身份：role 只认四种，积分/上报数由手机端上报，服务端只做范围裁剪 */
const ROLE_NAME = { guard: "安保", fire: "消防", inspect: "巡检", visitor: "观众" };
function normalize_participant(raw) {
  if (!raw || typeof raw !== "object") return null;
  const client_id = typeof raw.client_id === "string" ? raw.client_id.trim().slice(0, 64) : "";
  if (!client_id) return null;
  const role = ROLES.has(raw.role) ? raw.role : "visitor";
  const clamp = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(9999, Math.max(0, Math.round(n))) : 0;
  };
  return {
    client_id,
    role,
    role_name: ROLE_NAME[role],
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 16) : `${ROLE_NAME[role]}-${Math.floor(Math.random() * 90 + 10)}`,
    score: clamp(raw.score),
    reports: clamp(raw.reports),
  };
}

/** 观众上报指令：手机只发识别结论，场景/异常类型必须合法 */
function validate_command(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "voice_command") return validate_voice_command(raw);
  if (raw.type !== "visitor_report") return null;
  const scene = String(raw.scene || "");
  const kind = String(raw.kind || "");
  if (!SCENES.has(scene) || !KINDS.has(kind)) return null;
  const confidence = Number(raw.confidence);
  return {
    type: "visitor_report",
    scene,
    scene_label: SCENE_LABEL[scene],
    kind,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 24) : KIND_NAME[kind],
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.9,
    client_id: typeof raw.client_id === "string" ? raw.client_id.slice(0, 64) : "",
    note: typeof raw.note === "string" ? raw.note.slice(0, 120) : "",
  };
}

/**
 * 手机能打开的局域网地址。
 *
 * 以前是把所有非回环 IPv4 都列出来，第一个恰好是 Hyper-V 的
 * vEthernet (Default Switch) 172.22.112.1 —— 那是个宿主机内部虚拟网卡，
 * 手机连不上，二维码扫出来就是「无法访问此网站」。
 * 这里按「真实无线网卡优先」排序，并把链路本地地址与常见虚拟网卡排掉。
 */
function local_urls(port) {
  const wired = [];
  const other = [];
  const virtual = /(vEthernet|VMware|VirtualBox|Hyper-V|Loopback|Bluetooth|WSL|Tailscale|ZeroTier)/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    /* 虚拟网卡是宿主机内部网络，手机永远连不上，直接不列 */
    if (virtual.test(name)) continue;
    for (const item of list || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      /* 169.254.x.x 是没拿到 DHCP 的链路本地地址，扫了也连不上 */
      if (item.address.startsWith("169.254.")) continue;
      const url = `http://${item.address}:${port}`;
      if (/^(WLAN|Wi-?Fi|无线|以太网|Ethernet)/i.test(name)) wired.unshift(url);
      else other.push(url);
    }
  }
  return [...wired, ...other];
}

export function alert_bus_plugin() {
  /* 开发服与 preview 是两个进程，各自一份事件日志。
     一个版本的页面只会连其中一个，不需要跨进程共享。 */
  const events = [];
  const clients = new Set();
  let last_ts = 0;

  /* 指挥流：手机上报 → 大屏 */
  const command_clients = new Set();
  const commands = [];
  const fallback_timers = new Set();
  /* key=`scene|kind` → 最近一条兜底 incident；用于抑制大屏超时后补发的重复出警 */
  const fallback_visitors = new Map();
  /* 已被判定为「兜底已处置」的大屏 incident id → 过期时间；后续状态事件直接丢弃 */
  const suppressed_incidents = new Map();
  let command_seq = 0;

  /* 值班员（手机）与本场战报统计 */
  const participants = new Map();
  const session = {
    visitor_reports: 0,
    voice_commands: 0,
    by_scene: {},
    by_kind: {},
    started_ts: Date.now(),
  };
  let latest_frame = null;

  function snapshot() {
    return { v: 1, server_ts: Date.now(), events: events.slice() };
  }

  function send(res, status, data) {
    const body = JSON.stringify(data);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(body);
  }

  function read_body(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let too_large = false;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          /* 不 destroy：把剩余字节读掉丢弃，让上层能正常回一个 400 JSON，
             而不是让客户端只看到连接被掐断 */
          too_large = true;
          chunks.length = 0;
          return;
        }
        if (!too_large) chunks.push(chunk);
      });
      req.on("end", () => {
        if (too_large) reject(new Error("body too large"));
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  }

  function broadcast(event) {
    const frame = `event: update\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  }

  function append(event) {
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    last_ts = Date.now();
    broadcast(event);
  }

  function broadcast_command(command) {
    const frame = `event: command\ndata: ${JSON.stringify(command)}\n\n`;
    for (const res of command_clients) {
      try {
        res.write(frame);
      } catch {
        command_clients.delete(res);
      }
    }
  }

  function clear_fallbacks() {
    for (const timer of fallback_timers) clearTimeout(timer);
    fallback_timers.clear();
    fallback_visitors.clear();
    suppressed_incidents.clear();
  }

  /** 大屏响应慢时，兜底已经出过同场景同类型的 visitor 警报：
      把随后到达的大屏重复警报（以及它的后续状态）丢掉，避免手机端两张卡 */
  function is_late_visitor_duplicate(raw) {
    const inc = raw.incident;
    if (!inc || inc.visitor !== true) return false;
    const expiry = suppressed_incidents.get(inc.id);
    if (expiry && expiry > Date.now()) return true;
    if (expiry) suppressed_incidents.delete(inc.id);
    if (raw.type !== "alarm") return false;
    const key = `${inc.scene || raw.scene}|${inc.kind}`;
    const fallback = fallback_visitors.get(key);
    if (fallback && Date.now() - fallback.ts < 60000 && fallback.id !== inc.id) {
      suppressed_incidents.set(inc.id, Date.now() + 120000);
      return true;
    }
    return false;
  }

  /** 大屏没开时的兜底：总线自己把观众上报演成一条完整生命周期 */
  function synthesize_visitor_lifecycle(command) {
    const incident = {
      id: `visitor-${command.id}`,
      kind: command.kind,
      name: command.name,
      scene: command.scene,
      scene_label: command.scene_label,
      area: `${command.scene_label} · 观众上报点`,
      camera: "手机上报",
      px: null,
      level: KIND_LEVEL[command.kind],
      visitor: true,
      command_id: command.id,
      analysis: {
        confidence: command.confidence,
        detect: "观众手机拍摄 · 模型识别",
        rationale: `观众在${command.scene_label}上报${command.name}，模型识别置信度 ${Math.round(
          command.confidence * 100
        )}%，进入自动处置流程。`,
        suggestion: "就近调度执行体到场核实并处置，处置进度实时回传上报手机。",
      },
    };
    const base = {
      v: 1,
      scene: command.scene,
      scene_label: command.scene_label,
      source: "visitor-fallback",
    };
    const agent = { name: "dog-2", type: "dog" };
    const at = (ms, fn) => {
      const timer = setTimeout(() => {
        fallback_timers.delete(timer);
        fn();
      }, ms);
      fallback_timers.add(timer);
    };

    fallback_visitors.set(`${command.scene}|${command.kind}`, { ts: Date.now(), id: incident.id });

    /* 先补一条 scene 事件：手机端场景条/模型署名要跟着切到上报场景 */
    append({ ...base, type: "scene", ts: Date.now() });
    append({ ...base, type: "alarm", ts: Date.now(), incident, note: "指挥大屏未连接，总线自动处置" });
    at(900, () =>
      append({
        ...base,
        type: "dispatched",
        ts: Date.now(),
        incident,
        agent,
        distance_m: 28,
        eta_s: 19,
      })
    );
    at(6500, () => append({ ...base, type: "arrive", ts: Date.now(), incident, agent }));
    at(9000, () => append({ ...base, type: "handling", ts: Date.now(), incident, agent }));
    at(12500, () => append({ ...base, type: "resolved", ts: Date.now(), incident, agent }));
  }

  function open_alert_stream(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    /* 浏览器断线后的重连间隔交给 EventSource 自己的 retry 控制 */
    res.write("retry: 3000\n\n");
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        clients.delete(res);
      }
    }, KEEPALIVE_MS);

    const close = () => {
      clearInterval(heartbeat);
      clients.delete(res);
    };
    req.on("close", close);
    req.on("error", close);
  }

  function open_command_stream(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, server_ts: Date.now() })}\n\n`);
    command_clients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        command_clients.delete(res);
      }
    }, KEEPALIVE_MS);

    const close = () => {
      clearInterval(heartbeat);
      command_clients.delete(res);
    };
    req.on("close", close);
    req.on("error", close);
  }

  async function handle_alert(req, res, path) {
    if (path === `${API}/health`) {
      send(res, 200, {
        ok: true,
        events: events.length,
        clients: clients.size,
        last_ts,
        uptime_s: Math.round(process.uptime()),
      });
      return;
    }

    if (path === `${API}/info`) {
      /* 手机扫码不能扫到 localhost：把本机局域网 IPv4 都给出来，
         二维码取第一个可达地址，页面自己再兜底。 */
      const port = req.socket.localPort || 5179;
      send(res, 200, {
        ok: true,
        port,
        host: req.headers.host || "",
        urls: local_urls(port),
      });
      return;
    }

    if (path === `${API}/stream`) {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      open_alert_stream(req, res);
      return;
    }

    if (path === `${API}/snapshot`) {
      send(res, 200, snapshot());
      return;
    }

    if (path === `${API}/reset`) {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      events.length = 0;
      commands.length = 0;
      last_ts = 0;
      participants.clear();
      latest_frame = null;
      session.visitor_reports = 0;
      session.voice_commands = 0;
      session.by_scene = {};
      session.by_kind = {};
      session.started_ts = Date.now();
      clear_fallbacks();
      send(res, 200, { ok: true });
      return;
    }

    if (path === API || path === `${API}/`) {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await read_body(req));
      } catch {
        send(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : [parsed];
      let accepted = 0;
      for (const raw of list) {
        if (!validate_event(raw)) continue;
        if (is_late_visitor_duplicate(raw)) continue;
        if (!Number.isFinite(raw.ts)) raw.ts = Date.now();
        if (!raw.source) raw.source = "cinematic";
        append(raw);
        accepted++;
      }
      if (!accepted) {
        send(res, 400, { ok: false, error: "no valid event" });
        return;
      }
      /* 返回 200 带一小段 JSON，而不是 204：Chrome 对 keepalive 的 204
         响应偶尔记成 ERR_ABORTED，排查控制台时容易被当成失败 */
      send(res, 200, { ok: true, accepted, total: events.length });
      return;
    }

    send(res, 404, { ok: false, error: "not found" });
  }

  async function handle_command(req, res, path) {
    if (path === `${CMD_API}/health`) {
      send(res, 200, {
        ok: true,
        clients: command_clients.size,
        commands: commands.length,
        last_command_ts: commands.length ? commands[commands.length - 1].ts : 0,
      });
      return;
    }

    if (path === `${CMD_API}/stream`) {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      open_command_stream(req, res);
      return;
    }

    if (path === CMD_API || path === `${CMD_API}/`) {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await read_body(req));
      } catch {
        send(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      const normalized = validate_command(parsed);
      if (!normalized) {
        send(res, 400, { ok: false, error: "invalid command" });
        return;
      }

      const command = {
        v: 1,
        ...normalized,
        id: `cmd-${++command_seq}-${Date.now().toString(36)}`,
        ts: Date.now(),
        source: "mobile",
      };
      commands.push(command);
      if (commands.length > MAX_COMMANDS) commands.shift();
      const listeners = command_clients.size;

      /* 语音指挥只转发给大屏执行，不生成预警生命周期 */
      if (command.type === "voice_command") {
        session.voice_commands += 1;
        if (listeners > 0) {
          broadcast_command(command);
          send(res, 200, { ok: true, id: command.id, mode: "big-screen", listeners });
        } else {
          send(res, 200, { ok: true, id: command.id, mode: "no-listener", listeners: 0 });
        }
        return;
      }

      session.visitor_reports += 1;
      session.by_scene[command.scene] = (session.by_scene[command.scene] || 0) + 1;
      session.by_kind[command.kind] = (session.by_kind[command.kind] || 0) + 1;

      /* 有指挥大屏在看：把指令推给大屏，由 3D 场景真正出警；
         没有大屏：总线自己演一条生命周期，保证手机端闭环不落空 */
      if (listeners > 0) {
        broadcast_command(command);
        /* 大屏可能在切场景/加载，或者当场没有空闲执行体。15 秒内没看到
           带 visitor 的报警事件，就由总线兜底合成一条，保证手机端有闭环。 */
        const watchdog = setTimeout(() => {
          fallback_timers.delete(watchdog);
          /* 按 command_id 精确匹配：多条观众上报并发时，不能用
             「最近有没有 visitor 警报」这种模糊条件，否则第二条会被误判为已处理 */
          const handled = events.some(
            (ev) =>
              ev.type === "alarm" &&
              ev.incident?.visitor === true &&
              ev.incident?.command_id === command.id
          );
          if (!handled) synthesize_visitor_lifecycle(command);
        }, 15000);
        fallback_timers.add(watchdog);
        send(res, 200, { ok: true, id: command.id, mode: "big-screen", listeners });
      } else {
        synthesize_visitor_lifecycle(command);
        send(res, 200, { ok: true, id: command.id, mode: "fallback", listeners: 0 });
      }
      return;
    }

    send(res, 404, { ok: false, error: "not found" });
  }

  function prune_participants() {
    const now = Date.now();
    for (const [id, p] of participants) {
      if (now - p.last_seen > PARTICIPANT_TTL) participants.delete(id);
    }
    if (participants.size > MAX_PARTICIPANTS) {
      const old = [...participants.values()].sort((a, b) => a.last_seen - b.last_seen);
      for (const p of old.slice(0, participants.size - MAX_PARTICIPANTS)) participants.delete(p.client_id);
    }
  }

  function participant_list() {
    prune_participants();
    return [...participants.values()].sort((a, b) => b.score - a.score || b.reports - a.reports);
  }

  function session_stats() {
    prune_participants();
    /* 最快处置：从事件日志里配 visitor 的 alarm→resolved */
    const alarms = new Map();
    let fastest = null;
    for (const ev of events) {
      const inc = ev.incident;
      if (!inc || inc.visitor !== true) continue;
      if (ev.type === "alarm") alarms.set(inc.id, ev.ts);
      else if (ev.type === "resolved" && alarms.has(inc.id)) {
        const sec = (ev.ts - alarms.get(inc.id)) / 1000;
        if (fastest === null || sec < fastest) fastest = sec;
      }
    }
    return {
      ok: true,
      participants: participants.size,
      visitor_reports: session.visitor_reports,
      voice_commands: session.voice_commands,
      by_scene: session.by_scene,
      by_kind: session.by_kind,
      fastest_resolve_s: fastest === null ? null : Math.round(fastest * 10) / 10,
      last_command_ts: commands.length ? commands[commands.length - 1].ts : 0,
      started_ts: session.started_ts,
      uptime_s: Math.round(process.uptime()),
    };
  }

  async function handle_people(req, res, path) {
    const is_health = path === `${PEOPLE_API}/health`;
    if (path !== PEOPLE_API && !is_health) {
      send(res, 404, { ok: false, error: "not found" });
      return;
    }
    if (req.method === "POST" && is_health) {
      send(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    if (req.method === "POST") {
      let parsed;
      try {
        parsed = JSON.parse(await read_body(req));
      } catch {
        send(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      const p = normalize_participant(parsed);
      if (!p) {
        send(res, 400, { ok: false, error: "invalid participant" });
        return;
      }
      const now = Date.now();
      const prev = participants.get(p.client_id);
      participants.set(p.client_id, {
        ...p,
        joined_ts: prev ? prev.joined_ts : now,
        last_seen: now,
      });
      prune_participants();
      send(res, 200, { ok: true, participant: participants.get(p.client_id), count: participants.size });
      return;
    }
    if (req.method === "GET") {
      const list = participant_list();
      send(res, 200, { ok: true, count: list.length, participants: list });
      return;
    }
    send(res, 405, { ok: false, error: "method not allowed" });
  }

  async function handle_stats(req, res) {
    if (req.method !== "GET") {
      send(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    send(res, 200, session_stats());
  }

  async function handle_frames(req, res, path) {
    if (path === `${FRAME_API}/latest`) {
      if (req.method !== "GET") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      const alive = latest_frame && Date.now() - latest_frame.ts < FRAME_TTL;
      send(res, 200, { ok: true, frame: alive ? latest_frame : null });
      return;
    }
    if (path === FRAME_API || path === `${FRAME_API}/`) {
      if (req.method !== "POST") {
        send(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(await read_body(req));
      } catch {
        send(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      const dataUrl = typeof parsed?.dataUrl === "string" ? parsed.dataUrl : "";
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) || dataUrl.length > MAX_FRAME_CHARS) {
        send(res, 400, { ok: false, error: "invalid frame" });
        return;
      }
      latest_frame = {
        dataUrl,
        ts: Date.now(),
        scene: typeof parsed.scene === "string" ? parsed.scene.slice(0, 16) : "",
        device: typeof parsed.device === "string" ? parsed.device.slice(0, 24) : "",
      };
      send(res, 200, { ok: true, bytes: dataUrl.length });
      return;
    }
    send(res, 404, { ok: false, error: "not found" });
  }

  async function handle(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    /* CORS：单文件离线包（file://）也可能往本机总线发事件，
       它的 Origin 是 null，这里放开即可。展台内网，不处理鉴权。 */
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (path === API || path.startsWith(`${API}/`)) return handle_alert(req, res, path);
    if (path === CMD_API || path.startsWith(`${CMD_API}/`)) return handle_command(req, res, path);
    if (path === PEOPLE_API || path.startsWith(`${PEOPLE_API}/`)) return handle_people(req, res, path);
    if (path === STATS_API) return handle_stats(req, res);
    if (path === FRAME_API || path.startsWith(`${FRAME_API}/`)) return handle_frames(req, res, path);
    send(res, 404, { ok: false, error: "not found" });
  }

  function install(middlewares) {
    middlewares.use((req, res, next) => {
      const path = (req.url || "").split("?")[0];
      const is_alert = path === API || path.startsWith(`${API}/`);
      const is_command = path === CMD_API || path.startsWith(`${CMD_API}/`);
      const is_people = path === PEOPLE_API || path.startsWith(`${PEOPLE_API}/`);
      const is_stats = path === STATS_API || path.startsWith(`${STATS_API}/`);
      const is_frame = path === FRAME_API || path.startsWith(`${FRAME_API}/`);
      if (!is_alert && !is_command && !is_people && !is_stats && !is_frame) {
        /* 未注册的 /api/* 不要落到 Vite 静态兜底，否则会返回 200 的 index.html */
        if (path.startsWith("/api/")) {
          send(res, 404, { ok: false, error: "not found" });
          return;
        }
        return next();
      }
      handle(req, res).catch((err) => {
        if (!res.headersSent) send(res, 500, { ok: false, error: String(err?.message || err) });
      });
    });
  }

  return {
    name: "alert-bus",
    configureServer(server) {
      install(server.middlewares);
      server.httpServer?.on("listening", () => {
        const port = server.config.server.port;
        console.log(`  ➜  AlertBus: http://localhost:${port}/api/alerts/stream  (手机页 /mobile.html)`);
        console.log(`  ➜  CommandBus: http://localhost:${port}/api/commands/stream  (观众上报 → 大屏)`);
      });
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
