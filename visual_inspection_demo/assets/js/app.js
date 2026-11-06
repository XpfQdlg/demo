/* ==========================================================================
   视觉巡检能力全景 —— 前端逻辑
   路由：hash 路由，刷新后停留在当前页
   数据：window.VISION_DATA（tools/build_data.py 生成）
   素材：window.MEDIA（tools/scan_media.py 生成）
   ========================================================================== */

(function () {
  'use strict';

  var DATA = window.VISION_DATA;
  var MEDIA = window.MEDIA || { items: [] };

  // 现场配置：只改这里。服务地址指向本机推理服务，断网也能用。
  var CONFIG = {
    brandName: '视觉巡检',
    live: {
      apiBase: 'http://127.0.0.1:8765',
      streamPath: '/stream',
      statsPath: '/stats',
      healthPath: '/health',
      fallbackVideo: 'assets/media/live/loop.mp4'
    },
    kioskInterval: 10000
  };

  var app = document.getElementById('app');
  var kioskEl = document.getElementById('kiosk');
  var kioskSlideEl = document.getElementById('kiosk-slide');
  var kioskBarEl = document.getElementById('kiosk-progress-bar');
  var kioskCounterEl = document.getElementById('kiosk-counter');

  var state = {
    filter: 'all',
    matrixCell: null,
    kioskIndex: 0,
    kioskTimer: null,
    liveTimer: null
  };

  // ------------------------------------------------------------ 基础工具

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sceneById(id) {
    return DATA.scenes.filter(function (s) { return s.id === id; })[0] || null;
  }

  function domainById(id) {
    return DATA.domains.filter(function (d) { return d.id === id; })[0] || null;
  }

  function functionsOf(sceneId) {
    return DATA.functions.filter(function (f) { return f.scene === sceneId; });
  }

  function countDomains(sceneId) {
    var seen = {};
    functionsOf(sceneId).forEach(function (f) { seen[f.domain] = true; });
    return Object.keys(seen).length;
  }

  function priorityStats() {
    var high = 0;
    var mid = 0;
    DATA.functions.forEach(function (f) {
      if (f.priority === '高') high += 1;
      if (f.priority === '中') mid += 1;
    });
    return { high: high, mid: mid };
  }

  function scheduleStats() {
    var map = {};
    DATA.functions.forEach(function (f) {
      if (!f.schedule) return;
      map[f.schedule] = (map[f.schedule] || 0) + 1;
    });
    return map;
  }

  // 功能域 × 场景 的计数表
  function buildMatrix() {
    var table = {};
    DATA.domains.forEach(function (d) {
      table[d.id] = {};
      DATA.scenes.forEach(function (s) { table[d.id][s.id] = []; });
    });
    DATA.functions.forEach(function (f) {
      if (table[f.domain] && table[f.domain][f.scene]) {
        table[f.domain][f.scene].push(f);
      }
    });
    return table;
  }

  function coveredCells(table) {
    var covered = 0;
    DATA.domains.forEach(function (d) {
      DATA.scenes.forEach(function (s) {
        if (table[d.id][s.id].length > 0) covered += 1;
      });
    });
    return covered;
  }

  function distinctCount() {
    // 原文小区有两条内容重复，按能力去重后减一
    var dup = DATA.meta.duplicates || 0;
    return DATA.meta.total - Math.max(0, dup - 1);
  }

  function mediaForScene(sceneId) {
    return MEDIA.items.filter(function (m) { return m.scene === sceneId; });
  }

  function mediaForFunction(fnId) {
    return MEDIA.items.filter(function (m) { return m.function_id === fnId; })[0] || null;
  }

  function setActiveNav(key) {
    document.querySelectorAll('.nav a').forEach(function (link) {
      var match = link.getAttribute('data-nav') === key;
      link.classList.toggle('is-active', match);
      if (match) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  // ------------------------------------------------------------ 通用组件

  function domainTag(domainId) {
    var domain = domainById(domainId);
    if (!domain) return '';
    return '<span class="tag tag-domain">' + esc(domain.id) + ' · ' + esc(domain.name) + '</span>';
  }

  function priorityTag(priority) {
    if (!priority) return '';
    var cls = priority === '高' ? 'tag-high' : 'tag-mid';
    return '<span class="tag ' + cls + '">' + esc(priority) + '优先级</span>';
  }

  function renderMediaThumb(item) {
    if (!item) return '';
    if (item.type === 'image') {
      return '<figure class="media-thumb"><img src="' + esc(item.file) + '" alt="' + esc(item.title) + '" loading="lazy"></figure>';
    }
    return '<figure class="media-thumb"><video src="' + esc(item.file) + '" muted loop playsinline preload="metadata"></video>' +
      '<span class="media-play">VIDEO</span></figure>';
  }

  function renderMediaSection(sceneId) {
    var items = mediaForScene(sceneId);
    var scene = sceneById(sceneId);
    var body;

    if (items.length === 0) {
      body = '<div class="empty-state">素材接口已就绪。把视频或图片放入 ' +
        '<code>assets/media/' + esc(sceneId) + '/</code>，运行 ' +
        '<code>python tools/scan_media.py</code> 后即可自动出现在这里。</div>';
    } else {
      body = '<div class="media-grid">' + items.map(function (item) {
        if (item.type === 'image') {
          return '<figure class="media-item"><img src="' + esc(item.file) + '" alt="' + esc(item.title) + '" loading="lazy">' +
            '<figcaption>' + esc(item.title) + '</figcaption></figure>';
        }
        return '<figure class="media-item"><video src="' + esc(item.file) + '" controls muted loop playsinline preload="metadata"></video>' +
          '<figcaption>' + esc(item.title) + '</figcaption></figure>';
      }).join('') + '</div>';
    }

    return '<section class="section">' +
      '<div class="section-head"><h2>案例素材</h2>' +
      '<span class="section-note">' + esc(scene ? scene.name : '') + ' · ' + items.length + ' 条</span></div>' +
      body + '</section>';
  }

  // ------------------------------------------------------------ 视图：总览

  function viewOverview() {
    var matrix = buildMatrix();
    var covered = coveredCells(matrix);
    var totalCells = DATA.domains.length * DATA.scenes.length;
    var priorities = priorityStats();

    var sceneHtml = DATA.scenes.map(function (scene) {
      var fns = functionsOf(scene.id);
      var top = fns.slice(0, 3).map(function (f) {
        return '<li>' + esc(f.name) + '</li>';
      }).join('');

      return '<a class="scene-col" href="#/scene/' + esc(scene.id) + '">' +
        '<span class="scene-index">SCENE ' + esc(scene.index) + '</span>' +
        '<h2>' + esc(scene.name) + '</h2>' +
        '<span class="scene-en">' + esc(scene.en) + '</span>' +
        '<span class="scene-count">' + fns.length + '<span>项任务</span></span>' +
        '<ul class="scene-list">' + top + '</ul>' +
        '<span class="scene-more">查看全部 ' + fns.length + ' 项 →</span>' +
        '</a>';
    }).join('');

    // 功能域分布：按条目数排序的横向条形
    var domainRows = DATA.domains.map(function (d) {
      var n = DATA.functions.filter(function (f) { return f.domain === d.id; }).length;
      return { id: d.id, name: d.name, count: n };
    }).sort(function (a, b) { return b.count - a.count; });

    var maxCount = domainRows[0] ? domainRows[0].count : 1;
    var barsHtml = domainRows.map(function (row) {
      var pct = maxCount ? (row.count / maxCount) * 100 : 0;
      return '<div class="bar-row">' +
        '<span class="bar-label">' + esc(row.name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + row.count + '</span>' +
        '</div>';
    }).join('');

    return '<section class="view">' +
      '<div class="hero">' +
        '<div>' +
          '<p class="eyebrow">视觉巡检 · 能力全景</p>' +
          '<h1>四个场景，<em>一套</em><br>视觉巡检能力</h1>' +
          '<p class="lede">森林、小区、校园、地铁四类场景的识别任务，按功能归并为八个域。' +
          '同一套检测、分割与时序判断能力，在不同场景之间复用。</p>' +
        '</div>' +
        '<div class="hero-aside">' +
          '<p class="hero-figure">' + DATA.meta.total + '<span>项识别任务</span></p>' +
          '<p class="hero-note">其中 ' + distinctCount() + ' 项为去重后的独立能力。' +
          '数据来源：各组人员任务表，按表格实际条目统计。</p>' +
          '<p class="hero-note">高优先级 ' + priorities.high + ' 项 · 中优先级 ' + priorities.mid + ' 项</p>' +
        '</div>' +
      '</div>' +

      '<div class="kpi-row">' +
        kpi(DATA.scenes.length, '场景') +
        kpi(DATA.meta.total, '识别任务') +
        kpi(DATA.domains.length, '功能域') +
        kpi(covered + ' / ' + totalCells, '功能域覆盖格') +
      '</div>' +

      '<div class="scene-grid">' + sceneHtml + '</div>' +

      '<section class="section">' +
        '<div class="section-head"><h2>功能域分布</h2>' +
        '<span class="section-note">按条目数排序</span></div>' +
        '<div class="bar-list">' + barsHtml + '</div>' +
      '</section>' +
      '</section>';
  }

  function kpi(value, label) {
    return '<div class="kpi"><span class="kpi-value">' + esc(value) + '</span>' +
      '<span class="kpi-label">' + esc(label) + '</span></div>';
  }

  // ------------------------------------------------------------ 视图：场景页

  function viewScene(sceneId) {
    var scene = sceneById(sceneId);
    if (!scene) return viewNotFound();

    var fns = functionsOf(sceneId);
    var isCampus = sceneId === 'campus';
    var priorities = { high: 0, mid: 0 };
    fns.forEach(function (f) {
      if (f.priority === '高') priorities.high += 1;
      if (f.priority === '中') priorities.mid += 1;
    });

    var statsHtml = '<div class="page-stats">' +
      '<span><strong>' + fns.length + '</strong>项任务</span>' +
      '<span><strong>' + countDomains(sceneId) + '</strong>个功能域</span>' +
      (isCampus ? '<span><strong>' + priorities.high + '</strong>项高优先级</span>' : '') +
      '</div>';

    var filterHtml = isCampus ? renderCampusFilters(fns) : renderDomainFilters(fns, sceneId);

    var listHtml = isCampus ? renderCampusTable(fns) : renderFunctionList(fns);

    return '<section class="view">' +
      '<header class="page-head">' +
        '<p class="eyebrow">SCENE ' + esc(scene.index) + ' / ' + esc(scene.en) + '</p>' +
        '<h1>' + esc(scene.name) + '</h1>' +
        '<p class="lede">' + esc(scene.summary) + '</p>' +
        statsHtml +
      '</header>' +
      filterHtml +
      listHtml +
      renderMediaSection(sceneId) +
      '</section>';
  }

  function renderDomainFilters(fns, sceneId) {
    var used = {};
    fns.forEach(function (f) { used[f.domain] = (used[f.domain] || 0) + 1; });
    var chips = DATA.domains.filter(function (d) { return used[d.id]; }).map(function (d) {
      var active = state.filter === d.id ? ' is-active' : '';
      return '<button class="filter-chip' + active + '" type="button" data-filter="' + esc(d.id) + '">' +
        esc(d.name) + ' · ' + used[d.id] + '</button>';
    }).join('');

    return '<div class="filter-row">' +
      '<button class="filter-chip' + (state.filter === 'all' ? ' is-active' : '') + '" type="button" data-filter="all">全部 · ' + fns.length + '</button>' +
      chips + '</div>';
  }

  function renderFunctionList(fns) {
    var list = state.filter === 'all' ? fns : fns.filter(function (f) { return f.domain === state.filter; });

    if (!list.length) {
      return '<div class="empty-state">该筛选条件下暂无任务</div>';
    }

    var rows = list.map(function (f, index) {
      var tags = domainTag(f.domain);
      if (f.schedule) {
        tags += '<span class="tag">' + esc(f.schedule) + '</span>';
      }
      if (f.dup) {
        tags += '<span class="tag tag-note">重复项</span>';
      }

      return '<div class="fn-row">' +
        '<span class="fn-index">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<div class="fn-main"><h3>' + esc(f.name) + '</h3><p>' + esc(f.target) + '</p></div>' +
        '<div class="fn-tags">' + tags + '</div>' +
        '<div class="fn-media">' + renderMediaThumb(mediaForFunction(f.id)) + '</div>' +
        '</div>';
    }).join('');

    return '<div class="fn-list">' + rows + '</div>';
  }

  function renderCampusFilters(fns) {
    var used = {};
    fns.forEach(function (f) { used[f.category] = (used[f.category] || 0) + 1; });
    var chips = Object.keys(used).map(function (name) {
      var active = state.filter === name ? ' is-active' : '';
      return '<button class="filter-chip' + active + '" type="button" data-filter="' + esc(name) + '">' +
        esc(name) + ' · ' + used[name] + '</button>';
    }).join('');

    return '<div class="filter-row">' +
      '<button class="filter-chip' + (state.filter === 'all' ? ' is-active' : '') + '" type="button" data-filter="all">全部 · ' + fns.length + '</button>' +
      chips + '</div>';
  }

  function renderCampusTable(fns) {
    var list = state.filter === 'all' ? fns : fns.filter(function (f) { return f.category === state.filter; });

    if (!list.length) {
      return '<div class="empty-state">该筛选条件下暂无任务</div>';
    }

    var rows = list.map(function (f, index) {
      return '<tr>' +
        '<td>' + String(index + 1).padStart(2, '0') + '</td>' +
        '<td class="cell-name">' + esc(f.name) + '</td>' +
        '<td>' + esc(f.category) + '</td>' +
        '<td class="cell-muted">' + esc(f.target) + '</td>' +
        '<td>' + priorityTag(f.priority) + '</td>' +
        '<td>' + esc(f.algorithm) + '</td>' +
        '<td>' + esc(f.schedule) + '</td>' +
        '<td class="cell-muted">' + esc(f.data_status) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="data-table-wrap"><table class="data-table">' +
      '<thead><tr>' +
      '<th>#</th><th>识别任务</th><th>场景子类</th><th>异常目标</th>' +
      '<th>优先级</th><th>建议算法</th><th>开发安排</th><th>数据现状</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ------------------------------------------------------------ 视图：能力矩阵

  function viewMatrix() {
    var table = buildMatrix();
    var covered = coveredCells(table);
    var totalCells = DATA.domains.length * DATA.scenes.length;

    var head = '<tr><th class="row-head">功能域</th>' + DATA.scenes.map(function (s) {
      return '<th>' + esc(s.name) + '</th>';
    }).join('') + '</tr>';

    var body = DATA.domains.map(function (d) {
      var cells = DATA.scenes.map(function (s) {
        var items = table[d.id][s.id];
        var n = items.length;
        var level = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
        var selected = state.matrixCell && state.matrixCell.domain === d.id && state.matrixCell.scene === s.id;
        return '<td><button class="cell cell-' + level + (selected ? ' is-selected' : '') + '" type="button" ' +
          'data-domain="' + esc(d.id) + '" data-scene="' + esc(s.id) + '" ' +
          'aria-label="' + esc(d.name + ' · ' + s.name + '：' + n + ' 项') + '">' +
          (n === 0 ? '—' : n) + '</button></td>';
      }).join('');

      return '<tr><td class="row-head"><span class="row-id">' + esc(d.id) + '</span><strong>' + esc(d.name) + '</strong></td>' + cells + '</tr>';
    }).join('');

    return '<section class="view">' +
      '<header class="page-head">' +
        '<p class="eyebrow">CAPABILITY MATRIX</p>' +
        '<h1>能力覆盖矩阵</h1>' +
        '<p class="lede">八个功能域在四类场景中的分布。数字为该组合下的识别任务条目数，' +
        '颜色越亮表示覆盖越集中。点击任意单元格查看明细。</p>' +
        '<div class="page-stats">' +
          '<span><strong>' + covered + '</strong>个覆盖格</span>' +
          '<span><strong>' + totalCells + '</strong>个总格数</span>' +
          '<span><strong>' + Math.round((covered / totalCells) * 100) + '%</strong>覆盖率</span>' +
        '</div>' +
      '</header>' +

      '<div class="matrix-wrap"><table class="matrix"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      renderMatrixLegend() +
      renderMatrixDetail(table) +
      '</section>';
  }

  function renderMatrixLegend() {
    var levels = [
      { cls: 'cell-0', label: '0' },
      { cls: 'cell-1', label: '1–2' },
      { cls: 'cell-2', label: '3–4' },
      { cls: 'cell-3', label: '5–6' },
      { cls: 'cell-4', label: '7+' }
    ];
    return '<div class="matrix-legend"><span>条目数</span>' + levels.map(function (item) {
      return '<span class="legend-item"><span class="legend-swatch ' + item.cls + '"></span>' + item.label + '</span>';
    }).join('') + '</div>';
  }

  function renderMatrixDetail(table) {
    if (!state.matrixCell) {
      return '<div class="matrix-detail"><h3>选择单元格</h3>' +
        '<p class="detail-meta">点击矩阵中的任一格，这里会列出该功能域在该场景下的全部识别任务。</p></div>';
    }

    var domain = domainById(state.matrixCell.domain);
    var scene = sceneById(state.matrixCell.scene);
    var items = table[state.matrixCell.domain][state.matrixCell.scene];

    if (!items.length) {
      return '<div class="matrix-detail"><h3>' + esc(domain.name) + ' · ' + esc(scene.name) + '</h3>' +
        '<p class="detail-meta">该场景暂无对应任务</p></div>';
    }

    var list = items.map(function (f) {
      return '<div class="detail-item">' + esc(f.name) + '<span>' + esc(f.target) + '</span></div>';
    }).join('');

    return '<div class="matrix-detail"><h3>' + esc(domain.name) + ' · ' + esc(scene.name) + '</h3>' +
      '<p class="detail-meta">' + items.length + ' 项任务</p>' +
      '<div class="detail-list">' + list + '</div></div>';
  }

  // ------------------------------------------------------------ 视图：技术路线

  function viewRoadmap() {
    var campus = functionsOf('campus');
    var priorities = priorityStats();
    var schedules = scheduleStats();

    var scheduleOrder = ['直接集成', '场景迁移', '优先新增', '第二批'];
    var scheduleHtml = scheduleOrder.filter(function (key) { return schedules[key]; }).map(function (key) {
      return '<div class="bar-row">' +
        '<span class="bar-label">' + esc(key) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + ((schedules[key] / campus.length) * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + schedules[key] + '</span>' +
        '</div>';
    }).join('');

    var highRows = campus.filter(function (f) { return f.priority === '高'; }).map(function (f) {
      return '<tr>' +
        '<td class="cell-name">' + esc(f.name) + '</td>' +
        '<td>' + esc(f.category) + '</td>' +
        '<td>' + esc(f.algorithm) + '</td>' +
        '<td>' + esc(f.model_base) + '</td>' +
        '<td>' + esc(f.schedule) + '</td>' +
        '<td class="cell-muted">' + esc(f.data_status) + '</td>' +
        '</tr>';
    }).join('');

    return '<section class="view">' +
      '<header class="page-head">' +
        '<p class="eyebrow">ROADMAP · CAMPUS 30</p>' +
        '<h1>校园场景技术路线</h1>' +
        '<p class="lede">校园 30 项任务的优先级、建议算法与数据现状。高优先级集中在消防安全、' +
        '积水泄漏、通道占用与楼道堆物，中优先级多为路面破损、门窗、照明等第二批任务。</p>' +
        '<div class="page-stats">' +
          '<span><strong>' + campus.length + '</strong>项任务</span>' +
          '<span><strong>' + priorities.high + '</strong>项高优先级</span>' +
          '<span><strong>' + priorities.mid + '</strong>项中优先级</span>' +
        '</div>' +
      '</header>' +

      '<section class="section">' +
        '<div class="section-head"><h2>开发安排分布</h2>' +
        '<span class="section-note">按条目数</span></div>' +
        '<div class="bar-list">' + scheduleHtml + '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="section-head"><h2>高优先级任务</h2>' +
        '<span class="section-note">' + priorities.high + ' 项</span></div>' +
        '<div class="data-table-wrap"><table class="data-table">' +
        '<thead><tr><th>识别任务</th><th>场景子类</th><th>建议算法</th>' +
        '<th>现有模型基础</th><th>开发安排</th><th>数据现状</th></tr></thead>' +
        '<tbody>' + highRows + '</tbody></table></div>' +
      '</section>' +
      '</section>';
  }

  // ------------------------------------------------------------ 视图：实时演示

  function viewLive() {
    return '<section class="view">' +
      '<header class="page-head">' +
        '<p class="eyebrow">LIVE INFERENCE</p>' +
        '<h1>实时推理演示</h1>' +
        '<p class="lede">本机推理服务启动后，检测画面会直接嵌入这里。展台现场建议用一段真实巡检视频作为输入，' +
        '画面稳定、不受现场光照影响，同时能看到检测框与推理速度。</p>' +
      '</header>' +

      '<div class="live-layout">' +
        '<div class="live-stage" id="live-stage">' +
          '<div class="live-overlay">' +
            '<span class="status-pill" id="live-status" data-state="idle"><span class="status-dot"></span>未连接</span>' +
            '<span class="fps-readout" id="live-fps">— FPS</span>' +
          '</div>' +
          '<div class="live-placeholder" id="live-placeholder">' +
            '<strong>等待推理服务</strong>' +
            '<p>先在另一台终端运行 <code>python tools/live_server.py</code>，' +
            '然后回到这里点击「连接演示」。</p>' +
          '</div>' +
        '</div>' +

        '<aside class="live-panel">' +
        '<div>' +
          '<h2>演示控制</h2>' +
          '<p>支持摄像头实时输入，也支持用视频文件模拟巡检画面。两种输入走同一套推理与绘制流程。</p>' +
        '</div>' +
        '<div class="live-actions">' +
          '<button class="btn btn-solid" id="live-connect" type="button">连接演示</button>' +
          '<button class="btn btn-ghost" id="live-stop" type="button" style="margin-left:0">停止</button>' +
        '</div>' +
        '<div class="spec-list">' +
          '<div><span>服务地址</span><span>' + esc(CONFIG.live.apiBase) + '</span></div>' +
          '<div><span>视频流</span><span>' + esc(CONFIG.live.streamPath) + '</span></div>' +
          '<div><span>输入源</span><span id="live-source">未连接</span></div>' +
          '<div><span>推理状态</span><span id="live-state-text">待机</span></div>' +
        '</div>' +
        '</aside>' +
      '</div>' +
      '</section>';
  }

  function bindLive() {
    var stage = document.getElementById('live-stage');
    var placeholder = document.getElementById('live-placeholder');
    var statusEl = document.getElementById('live-status');
    var fpsEl = document.getElementById('live-fps');
    var stateText = document.getElementById('live-state-text');
    var sourceEl = document.getElementById('live-source');
    var connectBtn = document.getElementById('live-connect');
    var stopBtn = document.getElementById('live-stop');
    var streamImg = null;
    var fallbackEl = null;
    var watchdog = null;

    if (!stage || !connectBtn) return;

    function setStatus(state, text) {
      statusEl.setAttribute('data-state', state);
      statusEl.innerHTML = '<span class="status-dot"></span>' + esc(text);
      stateText.textContent = text;
    }

    function clearStream() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
      if (streamImg) { streamImg.remove(); streamImg = null; }
      if (fallbackEl) { fallbackEl.remove(); fallbackEl = null; }
      stage.classList.remove('is-fallback');
      fpsEl.textContent = '— FPS';
      sourceEl.textContent = '未连接';
    }

    function showFallback(message) {
      clearStream();
      setStatus('error', '离线');
      sourceEl.textContent = '离线视频';
      placeholder.hidden = false;
      placeholder.innerHTML = '<strong>推理服务未连接</strong><p>' + esc(message) + '</p>';

      var video = document.createElement('video');
      fallbackEl = video;
      video.src = CONFIG.live.fallbackVideo;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.onloadeddata = function () {
        placeholder.hidden = true;
        stage.insertBefore(video, stage.firstChild);
        video.play().catch(function () {});
        setStatus('idle', '离线循环');
        stateText.textContent = '离线循环视频';
      };
      video.onerror = function () {
        video.remove();
        if (fallbackEl === video) fallbackEl = null;
      };
    }

    function pollStats() {
      fetch(CONFIG.live.apiBase + CONFIG.live.statsPath, { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && typeof data.fps === 'number') {
            fpsEl.textContent = data.fps.toFixed(1) + ' FPS';
          }
          if (data && data.source) {
            sourceEl.textContent = data.source;
          }
        })
        .catch(function () {});
    }

    function connect() {
      clearStream();
      placeholder.hidden = true;
      setStatus('connecting', '连接中');
      stateText.textContent = '连接中';
      sourceEl.textContent = '等待画面';

      var img = document.createElement('img');
      img.alt = '实时推理画面';
      img.onload = function () {
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        setStatus('running', '运行中');
        stateText.textContent = '运行中';
        state.liveTimer = setInterval(pollStats, 1000);
        pollStats();
      };
      img.onerror = function () {
        img.remove();
        showFallback('先运行 python tools/live_server.py，再点击连接。');
      };
      img.src = CONFIG.live.apiBase + CONFIG.live.streamPath + '?t=' + Date.now();
      streamImg = img;
      stage.insertBefore(img, stage.firstChild);

      watchdog = setTimeout(function () {
        if (statusEl.getAttribute('data-state') === 'connecting') {
          showFallback('连接超时。确认推理服务已启动，端口与 CONFIG.live.apiBase 一致。');
        }
      }, 4000);
    }

    connectBtn.addEventListener('click', connect);
    stopBtn.addEventListener('click', function () {
      clearStream();
      placeholder.hidden = false;
      placeholder.innerHTML = '<strong>已停止</strong><p>点击「连接演示」重新连接推理服务。</p>';
      setStatus('idle', '已停止');
    });
  }

  // ------------------------------------------------------------ 视图：404

  function viewNotFound() {
    return '<section class="view"><header class="page-head">' +
      '<p class="eyebrow">404</p><h1>页面不存在</h1>' +
      '<p class="lede">检查地址，或回到 <a href="#/" style="color:var(--accent-ink)">总览</a>。</p>' +
      '</header></section>';
  }

  // ------------------------------------------------------------ 路由

  function parseRoute() {
    var hash = window.location.hash || '#/';
    var parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);

    if (parts.length === 0) return { name: 'overview' };
    if (parts[0] === 'scene') return { name: 'scene', sceneId: parts[1] };
    if (parts[0] === 'matrix') return { name: 'matrix' };
    if (parts[0] === 'roadmap') return { name: 'roadmap' };
    if (parts[0] === 'live') return { name: 'live' };
    return { name: 'notfound' };
  }

  var lastRouteKey = null;

  function render() {
    if (!DATA) {
      app.innerHTML = '<div class="empty-state">数据文件缺失，请先运行 python tools/build_data.py</div>';
      return;
    }

    var route = parseRoute();
    var routeKey = route.name + '/' + (route.sceneId || '');

    // 只有切换页面时才重置筛选，点击筛选按钮重新渲染不会丢状态
    if (routeKey !== lastRouteKey) {
      state.filter = 'all';
      lastRouteKey = routeKey;
    }

    var html = '';

    if (route.name === 'overview') {
      setActiveNav('overview');
      html = viewOverview();
    } else if (route.name === 'scene') {
      setActiveNav(route.sceneId);
      html = viewScene(route.sceneId);
    } else if (route.name === 'matrix') {
      setActiveNav('matrix');
      html = viewMatrix();
    } else if (route.name === 'roadmap') {
      setActiveNav('roadmap');
      html = viewRoadmap();
    } else if (route.name === 'live') {
      setActiveNav('live');
      html = viewLive();
    } else {
      setActiveNav('');
      html = viewNotFound();
    }

    app.innerHTML = html;

    if (route.name === 'live') {
      bindLive();
    }

    bindCommon();
    window.scrollTo(0, 0);
  }

  function bindCommon() {
    // 场景页筛选
    document.querySelectorAll('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.filter = btn.getAttribute('data-filter');
        render();
      });
    });

    // 矩阵单元格
    document.querySelectorAll('.cell[data-domain]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.matrixCell = {
          domain: btn.getAttribute('data-domain'),
          scene: btn.getAttribute('data-scene')
        };
        render();
      });
    });
  }

  // ------------------------------------------------------------ 轮播模式

  function buildKioskSlides() {
    var matrix = buildMatrix();
    var priorities = priorityStats();
    var covered = coveredCells(matrix);
    var totalCells = DATA.domains.length * DATA.scenes.length;

    var overview = '<p class="k-eyebrow">视觉巡检 · 能力全景</p>' +
      '<h2 class="k-title">四个场景<br>一套视觉巡检能力</h2>' +
      '<p class="k-lede">森林、小区、校园、地铁 · 八大功能域</p>' +
      '<div class="k-stats">' +
        '<div class="k-stat"><strong>' + DATA.meta.total + '</strong><span>识别任务</span></div>' +
        '<div class="k-stat"><strong>' + DATA.scenes.length + '</strong><span>场景</span></div>' +
        '<div class="k-stat"><strong>' + DATA.domains.length + '</strong><span>功能域</span></div>' +
        '<div class="k-stat"><strong>' + covered + '<span style="font-size:0.4em"> / ' + totalCells + '</span></strong><span>覆盖格</span></div>' +
      '</div>' +
      '<div class="k-scene-grid">' + DATA.scenes.map(function (s) {
        var fns = functionsOf(s.id);
        return '<div class="k-scene"><h3>' + esc(s.name) + '</h3>' +
          '<span class="k-scene-count">' + fns.length + ' 项任务</span>' +
          '<ul>' + fns.slice(0, 3).map(function (f) { return '<li>' + esc(f.name) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</div>';

    var sceneSlides = DATA.scenes.map(function (s) {
      var fns = functionsOf(s.id);
      var chips = fns.slice(0, 8).map(function (f) {
        return '<li>' + esc(f.name) + '</li>';
      }).join('');
      return '<p class="k-eyebrow">SCENE ' + esc(s.index) + ' / ' + esc(s.en) + '</p>' +
        '<h2 class="k-title">' + esc(s.name) + '</h2>' +
        '<p class="k-lede">' + esc(s.summary) + '</p>' +
        '<div class="k-stats">' +
          '<div class="k-stat"><strong>' + fns.length + '</strong><span>识别任务</span></div>' +
          '<div class="k-stat"><strong>' + countDomains(s.id) + '</strong><span>功能域</span></div>' +
        '</div>' +
        '<ul class="k-list">' + chips + '</ul>';
    });

    var matrixSlide = '<p class="k-eyebrow">CAPABILITY MATRIX</p>' +
      '<h2 class="k-title" style="font-size:clamp(32px,4vw,64px)">能力覆盖矩阵</h2>' +
      '<table class="k-matrix"><thead><tr><th>功能域</th>' +
        DATA.scenes.map(function (s) { return '<th>' + esc(s.name) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + DATA.domains.map(function (d) {
        var cells = DATA.scenes.map(function (s) {
          var n = matrix[d.id][s.id].length;
          var level = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
          return '<td><span class="k-cell cell-' + level + '">' + (n === 0 ? '—' : n) + '</span></td>';
        }).join('');
        return '<tr><td>' + esc(d.name) + '</td>' + cells + '</tr>';
      }).join('') + '</tbody></table>';

    var schedules = scheduleStats();
    var roadmapSlide = '<p class="k-eyebrow">ROADMAP · CAMPUS 30</p>' +
      '<h2 class="k-title">技术路线</h2>' +
      '<p class="k-lede">校园 30 项任务的优先级与实施安排</p>' +
      '<div class="k-stats">' +
        '<div class="k-stat"><strong>' + priorities.high + '</strong><span>高优先级</span></div>' +
        '<div class="k-stat"><strong>' + priorities.mid + '</strong><span>中优先级</span></div>' +
        '<div class="k-stat"><strong>' + (schedules['直接集成'] || 0) + '</strong><span>可直接集成</span></div>' +
        '<div class="k-stat"><strong>' + (schedules['场景迁移'] || 0) + '</strong><span>场景迁移</span></div>' +
      '</div>';

    // 轮播里的实时页：服务在跑就嵌流，服务没起就显示提示，不留破图标
    var liveSlide = '<p class="k-eyebrow">LIVE INFERENCE</p>' +
      '<h2 class="k-title" style="font-size:clamp(32px,min(4.4vw,7vh),72px)">实时推理</h2>' +
      '<div class="k-live-wrap">' +
        '<img class="k-live" src="' + esc(CONFIG.live.apiBase + CONFIG.live.streamPath) + '" alt="实时推理画面" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false;">' +
        '<div class="k-live-fallback" hidden>' +
          '<strong>推理服务未启动</strong>' +
          '<p>运行 <code>python tools/live_server.py --source assets/media/live/demo.mp4 --loop</code> 后刷新轮播</p>' +
        '</div>' +
      '</div>';

    return [overview].concat(sceneSlides, [matrixSlide, roadmapSlide, liveSlide]);
  }

  var kioskSlides = [];

  function startKiosk() {
    kioskSlides = buildKioskSlides();
    state.kioskIndex = 0;
    kioskEl.hidden = false;
    document.body.classList.add('is-kiosk');
    renderKioskSlide();

    if (kioskEl.requestFullscreen) {
      kioskEl.requestFullscreen().catch(function () {});
    }

    scheduleKiosk();
  }

  function scheduleKiosk() {
    if (state.kioskTimer) clearInterval(state.kioskTimer);
    state.kioskTimer = setInterval(function () {
      state.kioskIndex = (state.kioskIndex + 1) % kioskSlides.length;
      renderKioskSlide();
    }, CONFIG.kioskInterval);
  }

  function renderKioskSlide() {
    kioskSlideEl.innerHTML = kioskSlides[state.kioskIndex] || '';
    kioskSlideEl.style.animation = 'none';
    void kioskSlideEl.offsetWidth;
    kioskSlideEl.style.animation = '';
    kioskCounterEl.textContent = (state.kioskIndex + 1) + ' / ' + kioskSlides.length;

    kioskBarEl.style.transition = 'none';
    kioskBarEl.style.width = '0%';
    void kioskBarEl.offsetWidth;
    kioskBarEl.style.transition = 'width ' + CONFIG.kioskInterval + 'ms linear';
    kioskBarEl.style.width = '100%';
  }

  function stopKiosk() {
    kioskEl.hidden = true;
    document.body.classList.remove('is-kiosk');
    if (state.kioskTimer) { clearInterval(state.kioskTimer); state.kioskTimer = null; }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  function bindKiosk() {
    document.getElementById('kiosk-entry').addEventListener('click', startKiosk);

    document.addEventListener('keydown', function (event) {
      if (kioskEl.hidden) return;

      if (event.key === 'Escape') {
        stopKiosk();
      } else if (event.key === 'ArrowRight') {
        state.kioskIndex = (state.kioskIndex + 1) % kioskSlides.length;
        renderKioskSlide();
        scheduleKiosk();
      } else if (event.key === 'ArrowLeft') {
        state.kioskIndex = (state.kioskIndex - 1 + kioskSlides.length) % kioskSlides.length;
        renderKioskSlide();
        scheduleKiosk();
      }
    });
  }

  // ------------------------------------------------------------ 启动

  function init() {
    var brandEl = document.getElementById('brand-name');
    if (brandEl) brandEl.textContent = CONFIG.brandName;

    bindKiosk();
    window.addEventListener('hashchange', render);
    render();

    // 地址栏加 ?kiosk=1 可直接进入轮播，方便在桌面建快捷方式
    // 可加 ?interval=5000 调整每页停留时长（毫秒，最小 2000）
    var params = new URLSearchParams(window.location.search);
    var interval = parseInt(params.get('interval'), 10);
    if (interval >= 2000) {
      CONFIG.kioskInterval = interval;
    }
    if (params.get('kiosk') === '1') {
      startKiosk();
    }
  }

  init();
})();
