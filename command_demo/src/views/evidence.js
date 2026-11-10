import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { px_to_world } from "../map/coords.js";
import { evidence_for } from "../data/evidence.js";
import { KIND_META } from "../mobile/contract.js";

/**
 * 事件现场照片卡：报警时在事发点上方弹一张实拍图，
 * 卡片底下一条引线 + 地面圆点，明确「这张图拍的就是这儿」。
 *
 * 用 CSS2DRenderer 挂 DOM：文字与图片始终是屏幕尺寸，不随镜头远近糊掉，
 * 也不会像贴图那样吃掉一张 GPU 纹理。卡片挂在场景里，
 * 切场景时随 marker 组一起被清掉。
 */

const MAX_CARDS = 2;
const HOLD_MS = 13000;
const EXIT_MS = 360;

const pad2 = (n) => String(n).padStart(2, "0");
const clock_of = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function make_evidence(parent, { floor_y = () => 0 } = {}) {
  const cards = [];

  function drop(card, fade = true) {
    const i = cards.indexOf(card);
    if (i >= 0) cards.splice(i, 1);
    clearTimeout(card.timer);
    const finish = () => {
      parent.remove(card.obj);
      card.el.remove();
      card.obj.element?.remove();
    };
    if (!fade) {
      finish();
      return;
    }
    card.el.classList.add("is-out");
    clearTimeout(card.exit);
    card.exit = setTimeout(finish, EXIT_MS);
  }

  function clear() {
    [...cards].forEach((c) => drop(c, false));
  }

  function show({ scene, px, area, name, kind, camera }) {
    if (!px) return null;
    const photo = evidence_for(scene, kind);
    if (!photo) return null;

    /* 同一点连续报警不叠第二张，把旧卡换掉 */
    const dup = cards.find((c) => c.area === area && c.name === name);
    if (dup) drop(dup, false);
    while (cards.length >= MAX_CARDS) drop(cards[0], false);

    const color = KIND_META[kind]?.color || "#ff5a6a";
    const el = document.createElement("div");
    el.className = "evi";
    el.style.setProperty("--evi-c", color);
    el.innerHTML = `
      <div class="evi-card">
        <div class="evi-head">
          <i class="evi-rec"></i>
          <span class="evi-tag">现场抓拍</span>
          <span class="evi-time">${clock_of(new Date())}</span>
        </div>
        <div class="evi-shot"><img alt="现场抓拍" draggable="false"></div>
        <div class="evi-meta"><b></b><span></span></div>
      </div>
      <span class="evi-line"></span>
      <span class="evi-pin"></span>`;

    const img = el.querySelector("img");
    img.src = photo.src;
    el.querySelector(".evi-meta b").textContent = area || "现场";
    el.querySelector(".evi-meta span").textContent = `${name} · ${camera?.id || photo.note}`;

    const w = px_to_world(px[0], px[1]);
    const obj = new CSS2DObject(el);
    obj.position.set(w.x, (floor_y() || 0) + 0.05, w.z);
    obj.userData.el = el;
    parent.add(obj);

    const card = { el, obj, area, name, timer: 0, exit: 0 };
    cards.push(card);

    /* 图被拦或文件缺失（单文件版）时别留一张空卡 */
    img.addEventListener("error", () => drop(card, false), { once: true });

    requestAnimationFrame(() => el.classList.add("is-in"));

    /* 事发点如果落在画面上沿，卡片朝上长会顶出屏幕、压到标题条：
       量一次实际位置，装不下就翻到引线下方。阈值按顶部标题带的高度留，
       只判 96 会在消息条底下露半张卡。 */
    requestAnimationFrame(() => {
      const card_el = el.querySelector(".evi-card");
      const box = card_el?.getBoundingClientRect();
      if (!box) return;
      if (box.top < 190) el.classList.add("is-flip");

      /* 左右两侧是模型卡与事件流面板，卡片压上去就看不清了：
         量完把卡片推回安全带，引线仍落在事发点（卡片够宽，偏一点也接得上）。 */
      const vw = document.documentElement.clientWidth;
      const safe_l = 404;
      const safe_r = vw - 396;
      let dx = 0;
      if (box.right > safe_r) dx = safe_r - box.right;
      else if (box.left < safe_l) dx = safe_l - box.left;
      if (dx) card_el.style.setProperty("--evi-dx", `${Math.round(dx)}px`);
    });

    card.timer = setTimeout(() => drop(card), HOLD_MS);
    return card;
  }

  return { show, clear };
}
