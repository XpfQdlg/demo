/* ══════════════════════════════════════════════════════════════════════════
   phone_link — 大屏右上角的「手机」入口

   展台讲解时手机怎么进来：电脑上点「手机」，弹出二维码与局域网地址，
   手机扫码打开 /phone（重定向到 mobile.html）。二维码里不能写 localhost，
   所以向本机总线问一次它自己的局域网 IPv4（/api/alerts/info）。

   离线单文件也能用：file:// 下没有同源服务，先探本机 5179 —— 展台电脑
   一般开着 dev server 供手机访问预警页；单文件大屏把事件发到 127.0.0.1:5179
   的总线（见 core/alert_publish.js），手机就能收到。探不到就只给文字说明。

   二维码用 qrcode-generator（MIT，纯 JS，随包打进单文件，不联网）。
   ══════════════════════════════════════════════════════════════════════════ */

import qrcode from "qrcode-generator";

const params = new URLSearchParams(location.search);
const bus_base = (params.get("bus") || "").trim().replace(/\/+$/, "");

function is_http() {
  return location.protocol === "http:" || location.protocol === "https:";
}

/** 依次尝试的总线地址：页面同源 → 本机 dev server */
function info_candidates() {
  const list = [];
  if (bus_base) list.push(bus_base);
  if (is_http()) list.push(location.origin);
  list.push("http://127.0.0.1:5179");
  return [...new Set(list)];
}

async function fetch_info() {
  for (const base of info_candidates()) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1600);
      const res = await fetch(base + "/api/alerts/info", {
        signal: ctrl.signal,
        mode: "cors",
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const info = await res.json();
      if (!info?.ok) continue;
      return { base, info };
    } catch {
      /* 这个地址没服务，试下一个 */
    }
  }
  return null;
}

/** 二维码装进容器。v8 在 M 纠错下能放 152 字节，够任何内网地址 */
function render_qr(container, text) {
  container.innerHTML = "";
  for (const type of [4, 6, 8]) {
    try {
      const qr = qrcode(type, "M");
      qr.addData(text);
      qr.make();
      container.innerHTML = qr.createSvgTag({
        cellSize: 6,
        margin: 2,
        scalable: false,
        alt: "手机预警接收页二维码",
        title: "扫码打开预警接收页",
      });
      return true;
    } catch {
      /* 容量不够，换更大的版本重试 */
    }
  }
  container.textContent = "二维码生成失败，请手动输入地址";
  return false;
}

function mobile_url_from(info, base) {
  const lan = Array.isArray(info.urls) && info.urls.length ? info.urls[0] : null;
  const origin = lan || base.replace(/\/+$/, "");
  return `${origin}/phone`;
}

export function install_phone_link() {
  const btn = document.getElementById("phoneBtn");
  const panel = document.getElementById("phonePanel");
  if (!btn || !panel) return;

  const qr_box = panel.querySelector("#phoneQR");
  const url_el = panel.querySelector("#phoneUrl");
  const hint_el = panel.querySelector("#phoneHint");
  const copy_btn = panel.querySelector("#phoneCopy");
  const close_btn = panel.querySelector("#phoneClose");
  let current_url = "";
  let opened = false;
  let loading = false;

  async function open() {
    panel.classList.add("on");
    document.body.classList.add("phone-open");
    /* 已经拿到地址就直接复用。上次没探到（比如服务还没起）时，
       关掉再点应该重新探测，而不是把「未找到本机服务」一直留在弹层里。 */
    if (opened && current_url) return;
    if (loading) return;
    loading = true;
    qr_box.innerHTML = "";
    url_el.textContent = "正在获取本机地址…";
    hint_el.textContent = "手机与这台电脑需要连同一 Wi-Fi。";
    copy_btn.disabled = true;

    const found = await fetch_info();
    loading = false;
    if (!found) {
      url_el.textContent = "未找到本机服务";
      hint_el.textContent = is_http()
        ? "预警通道不可用：请确认 dev server 正在运行（npm run dev）。"
        : "当前是单文件离线版。若要在手机上看实时预警，先在本目录运行 npm run dev，再点这里扫码。";
      qr_box.classList.add("empty");
      return;
    }

    current_url = mobile_url_from(found.info, found.base);
    url_el.textContent = current_url;
    copy_btn.disabled = false;
    qr_box.classList.remove("empty");
    opened = true;
    qr_box.classList.remove("empty");
    const ok = render_qr(qr_box, current_url);
    hint_el.textContent = ok
      ? "扫码打开预警接收页。大屏发现异常、派单、处置的每一步都会推到手机。"
      : "地址已就绪，直接在手机浏览器输入上面的地址。";
  }

  function close() {
    panel.classList.remove("on");
    document.body.classList.remove("phone-open");
  }

  btn.addEventListener("click", () => {
    if (panel.classList.contains("on")) close();
    else open();
  });
  close_btn?.addEventListener("click", close);
  panel.addEventListener("click", (e) => {
    /* 点遮罩关闭，点卡片内部不关 */
    if (e.target === panel) close();
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !panel.classList.contains("on")) return;
    close();
    /* 弹层开着时 Esc 只关弹层，不要同时触发大屏的「回到全局」 */
    e.stopImmediatePropagation();
  });
  copy_btn?.addEventListener("click", async () => {
    if (!current_url) return;
    try {
      await navigator.clipboard.writeText(current_url);
      const old = copy_btn.textContent;
      copy_btn.textContent = "已复制";
      setTimeout(() => (copy_btn.textContent = old), 1200);
    } catch {
      /* 剪贴板没权限时不影响页面，地址已经显示在下面 */
    }
  });
}
