/* ══════════════════════════════════════════════════════════════════════════
   join — 大屏左下角的常驻「扫码参与」卡

   展台上最容易被忽略的一步是「观众怎么进来」。右上角的手机按钮太小，
   讲解员一忙就想不起来点。这里把二维码常驻在画面里：路过的人自己扫，
   扫码后拍一张现场照片，四个模型会诊，大屏切场景出警。

   地址优先用总线返回的局域网 IP（手机才能访问），探不到就退回当前源。
   ══════════════════════════════════════════════════════════════════════════ */

import qrcode from "qrcode-generator";

const params = new URLSearchParams(location.search);
const bus_base = (params.get("bus") || "").trim().replace(/\/+$/, "");

function candidates() {
  const list = [];
  if (bus_base) list.push(bus_base);
  if (location.protocol.startsWith("http")) list.push(location.origin);
  list.push("http://127.0.0.1:5179");
  return [...new Set(list)];
}

async function probe() {
  for (const base of candidates()) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1400);
      const res = await fetch(base + "/api/alerts/info", { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) continue;
      const info = await res.json();
      if (!info?.ok) continue;
      return { base, info };
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function make_qr(text) {
  for (const type of [4, 6, 8]) {
    try {
      const qr = qrcode(type, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: false });
    } catch {
      /* 容量不够，换大版本 */
    }
  }
  return null;
}

export function mount_join() {
  if (document.getElementById("join")) return;
  const box = document.createElement("aside");
  box.id = "join";
  box.innerHTML = `
    <div class="jn-qr" id="joinQR"></div>
    <div class="jn-body">
      <div class="jn-kicker">SCAN TO JOIN</div>
      <div class="jn-title">扫码 · 四个模型会诊</div>
      <div class="jn-note">拍一张现场照片上报<br />大屏切场景出警</div>
      <div class="jn-url" id="joinURL">同一 Wi-Fi · 扫码即开</div>
    </div>
  `;
  document.body.append(box);

  box.addEventListener("click", () => {
    const btn = document.getElementById("phoneBtn");
    if (btn) btn.click();
  });

  (async () => {
    const found = await probe();
    const origin = found?.info?.urls?.[0] || found?.base || location.origin;
    const url = `${origin.replace(/\/+$/, "")}/phone`;
    const qr = document.getElementById("joinQR");
    if (!qr) return;
    const svg = make_qr(url);
    if (svg) {
      qr.innerHTML = svg;
      box.classList.add("ready");
      box.title = `手机扫码打开 ${url}`;
      /* 把域名写出来：现场换 Wi-Fi 时一眼能看出二维码还指向旧地址 */
      const u = document.getElementById("joinURL");
      if (u) u.textContent = origin.replace(/^https?:\/\//, "");
    } else {
      qr.textContent = "扫码地址生成失败";
    }
  })();
}
