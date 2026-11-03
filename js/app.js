(function () {
  'use strict';

  const STORAGE_KEY = 'taiwan-loop-trip-v1';
  const SHARE_PREFIX = '#plan=';
  const $ = (id) => document.getElementById(id);

  let state = null; // { settings: {days, people, transport, level, startDate}, plan: [...] }

  /* ---------- 工具 ---------- */
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function money(n) { return 'NT$ ' + Math.round(n).toLocaleString('zh-TW'); }
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = el('textarea', { value: text });
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { /* 略過 */ }
      ta.remove();
      return ok;
    }
  }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 隱私模式等情況下略過 */ }
  }

  /* ---------- 日期與季節提醒 ---------- */
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function dayDate(startDate, offset) {
    const start = parseDate(startDate);
    if (!start) return '';
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + '日一二三四五六'[d.getDay()] + '）';
  }

  function seasonTips(s) {
    const start = parseDate(s.startDate);
    if (!start) return [];
    const months = new Set();
    for (let i = 0; i < s.days; i++) months.add(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getMonth() + 1);
    const has = (list) => list.some((m) => months.has(m));
    const tips = [];
    if (has([6, 7, 8, 9, 10])) tips.push('6–10 月是颱風季：出發前請查看中央氣象署預報，預留機動天數，住宿盡量選可免費取消的方案。');
    if (has([7, 8])) tips.push('暑假是旅遊旺季：住宿與火車票容易客滿，建議提早預訂。');
    if (has([12, 1, 2])) tips.push('冬季東北季風明顯：東北角與宜蘭常偏濕冷，山區（如阿里山）早晚溫差大，記得帶外套。');
    tips.push('遇到連假或春節，住宿與交通請更早預訂。');
    if (s.transport === 'train') tips.push('搭火車環島建議提早訂票，熱門時段容易沒有座位。');
    return tips;
  }

  /* ---------- 產生行程 ---------- */
  function buildPlan(days) {
    const total = CITIES.length;
    const plan = [];
    for (let d = 0; d < days; d++) {
      const from = Math.round(d * total / days);
      const to = Math.round((d + 1) * total / days);
      const cities = CITIES.slice(from, to);
      const isLast = d === days - 1;
      plan.push({
        title: cities.map((c) => c.name).join(' → '),
        overnight: isLast ? '返回台北，旅程結束' : cities[cities.length - 1].name,
        items: cities.flatMap((c) => c.spots.map((s) => ({
          id: uid(), name: s.name, q: s.q || s.name, city: c.name, cost: s.cost, done: false
        })))
      });
    }
    return plan;
  }

  /* ---------- 預算 ---------- */
  function calcBudget(s, plan) {
    const nights = s.days - 1;
    const tickets = plan.reduce((sum, day) =>
      sum + day.items.reduce((a, i) => a + i.cost, 0), 0) * s.people;
    const rows = [
      { label: '交通', color: '#2a7f9e', value: TRANSPORT[s.transport].total(s.days, s.people) * s.people },
      { label: '住宿', color: '#2f8f6b', value: LODGING_PER_NIGHT[s.level] * nights * s.people },
      { label: '餐飲', color: '#e0a030', value: FOOD_PER_DAY[s.level] * s.days * s.people },
      { label: '門票與體驗', color: '#8a6fd1', value: tickets }
    ];
    const subtotal = rows.reduce((a, r) => a + r.value, 0);
    rows.push({ label: '預備金 10%', color: '#8fa39b', value: subtotal * 0.1 });
    const total = subtotal * 1.1;
    return { rows, total, perPerson: total / s.people };
  }

  /* ---------- Google 地圖連結（官方網址格式，不需要金鑰） ---------- */
  function placeQuery(item) { return (item.q || item.name) + ' 台灣'; }

  function placeUrl(item) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(placeQuery(item));
  }

  // 當日路線：第一個景點出發、最後一個抵達，中間為途經點（網址最多 9 個途經點）
  function dayRouteUrl(day, transport) {
    const stops = day.items.map(placeQuery);
    if (stops.length < 2) return null;
    const params = new URLSearchParams({ api: '1', origin: stops[0], destination: stops[stops.length - 1] });
    const mid = stops.slice(1, -1).slice(0, 9);
    if (mid.length) params.set('waypoints', mid.join('|'));
    const mode = { car: 'driving', scooter: 'two-wheeler', bike: 'bicycling' }[transport];
    if (mode) params.set('travelmode', mode); // 火車／大眾運輸不支援途經點，不指定模式
    return 'https://www.google.com/maps/dir/?' + params.toString();
  }

  function mapLink(href, text, className, label) {
    return el('a', {
      className: className, href: href, target: '_blank', rel: 'noopener noreferrer',
      textContent: text, title: label, ariaLabel: label + '（另開新分頁）'
    });
  }

  /* ---------- 分享連結 ---------- */
  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(b64) {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  function shareUrl() {
    const payload = {
      v: 1,
      s: state.settings,
      p: state.plan.map((d) => ({ t: d.title, o: d.overnight, i: d.items.map((i) => [i.name, i.q || i.name, i.cost, i.city || '']) }))
    };
    return location.href.split('#')[0] + SHARE_PREFIX + toBase64Url(JSON.stringify(payload));
  }

  // 分享連結來自外部，一律檢查格式與範圍再使用
  function parseShared(hash) {
    try {
      const o = JSON.parse(fromBase64Url(hash.slice(SHARE_PREFIX.length)));
      const s = o && o.s;
      if (!o || o.v !== 1 || !s || !Array.isArray(o.p)) return null;
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!int(s.days, 1, 14) || !int(s.people, 1, 20) || !int(s.level, 0, 2) || !TRANSPORT[s.transport]) return null;
      if (o.p.length < 1 || o.p.length > 14) return null;
      const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
      const plan = o.p.map((d) => ({
        title: str(d.t, 80),
        overnight: str(d.o, 40),
        items: (Array.isArray(d.i) ? d.i : []).slice(0, 40).map((it) => ({
          id: uid(), name: str(it[0], 40), q: str(it[1], 80), cost: int(it[2], 0, 1000000) ? it[2] : 0, city: str(it[3], 20), done: false
        })).filter((it) => it.name)
      }));
      const startDate = parseDate(s.startDate) ? s.startDate : '';
      return { settings: { days: s.days, people: s.people, transport: s.transport, level: s.level, startDate: startDate }, plan: plan };
    } catch (e) {
      return null;
    }
  }

  function planAsText() {
    const s = state.settings;
    const b = calcBudget(s, state.plan);
    const lines = ['【台灣環島 ' + s.days + ' 天】' + s.people + ' 人・' + TRANSPORT[s.transport].label];
    state.plan.forEach((day, di) => {
      const date = dayDate(s.startDate, di);
      lines.push('', 'Day ' + (di + 1) + (date ? ' ' + date : '') + '｜' + day.title);
      day.items.forEach((i) => lines.push((i.done ? '☑ ' : '☐ ') + i.name + (i.cost ? '（NT$ ' + i.cost + '）' : '')));
      lines.push('住宿／終點：' + day.overnight);
    });
    lines.push('', '預估總計 ' + money(b.total) + '（每人約 ' + money(b.perPerson) + '）');
    return lines.join('\n');
  }

  /* ---------- 畫面：預算 ---------- */
  function renderBudget() {
    const b = calcBudget(state.settings, state.plan);
    const max = Math.max.apply(null, b.rows.map((r) => r.value)) || 1;
    const box = $('budget-rows');
    box.replaceChildren();
    b.rows.forEach((r) => {
      const bar = el('span', { className: 'bar' });
      bar.style.width = (r.value / max * 100) + '%';
      const row = el('div', { className: 'row' }, [
        el('div', { className: 'row-head' }, [
          el('span', {}, [el('i', { className: 'dot' }), r.label]),
          el('b', { textContent: money(r.value) })
        ]),
        el('div', { className: 'bar-track' }, [bar])
      ]);
      row.style.setProperty('--c', r.color);
      box.append(row);
    });
    $('total').textContent = money(b.total);
    $('per-person').textContent = money(b.perPerson);
    $('mb-total').textContent = money(b.total);
    $('mb-per').textContent = money(b.perPerson);
  }

  function renderTips() {
    const box = $('season-tip');
    const tips = seasonTips(state.settings);
    box.replaceChildren();
    box.hidden = tips.length === 0;
    if (!tips.length) return;
    box.append(el('strong', { textContent: '出發前的常見提醒（依你的日期）' }),
      el('ul', {}, tips.map((t) => el('li', { textContent: t }))));
  }

  /* ---------- 畫面：路線圖 ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text) n.textContent = text;
    return n;
  }
  function project(lon, lat) { return [20 + (lon - 119.9) * 140, 20 + (25.4 - lat) * 140]; }

  function buildMap() {
    const svg = svgEl('svg', { viewBox: '0 0 400 560', role: 'img', 'aria-label': '台灣環島路線示意圖' });
    const pts = (arr) => arr.map((p) => project(p[0], p[1]).map((v) => v.toFixed(1)).join(',')).join(' ');
    svg.append(svgEl('polygon', { class: 'island', points: pts(TAIWAN_OUTLINE) }));

    const coords = CITIES.map((c) => [CITY_MAP[c.name].lon, CITY_MAP[c.name].lat]);
    svg.append(svgEl('polyline', { class: 'route', points: pts(coords.concat([coords[0]])) }));

    CITIES.forEach((c, i) => {
      const m = CITY_MAP[c.name];
      const p = project(m.lon, m.lat);
      const left = m.side === 'l';
      const g = svgEl('g', { class: 'city', tabindex: 0, role: 'button', 'aria-label': c.name });
      g.dataset.city = c.name;
      g.append(
        svgEl('circle', { cx: p[0], cy: p[1], r: 10 }),
        svgEl('text', { class: 'num', x: p[0], y: p[1] + 4, 'text-anchor': 'middle' }, String(i + 1)),
        svgEl('text', { class: 'label', x: p[0] + (left ? -15 : 15), y: p[1] + 5, 'text-anchor': left ? 'end' : 'start' }, c.name)
      );
      svg.append(g);
    });
    $('route-map').append(svg);
  }

  function mapCities() { return Array.prototype.slice.call(document.querySelectorAll('#route-map .city')); }

  function renderMap() {
    mapCities().forEach((g) => {
      const items = state.plan.flatMap((d) => d.items).filter((i) => i.city === g.dataset.city);
      g.classList.toggle('visited', items.length > 0 && items.every((i) => i.done));
    });
  }

  // 路線圖旁的城市對照表：每個城市落在第幾天
  function renderLegend() {
    const box = $('route-legend');
    box.replaceChildren();
    CITIES.forEach((c, i) => {
      const di = state.plan.findIndex((d) => d.title.split(' → ').indexOf(c.name) !== -1);
      const btn = el('button', { type: 'button', className: 'legend-item' }, [
        el('span', { className: 'legend-num', textContent: String(i + 1) }),
        el('span', { className: 'legend-name', textContent: c.name }),
        el('span', { className: 'legend-day', textContent: di >= 0 ? 'Day ' + (di + 1) : '—' })
      ]);
      btn.dataset.city = c.name;
      btn.dataset.day = di;
      btn.disabled = di < 0;
      box.append(el('li', {}, [btn]));
    });
  }

  function highlightDay(di) {
    const names = di == null || !state.plan[di] ? [] : state.plan[di].title.split(' → ');
    mapCities().forEach((g) => g.classList.toggle('active', names.indexOf(g.dataset.city) !== -1));
  }

  function jumpToCity(name) {
    const di = state.plan.findIndex((d) => d.title.split(' → ').indexOf(name) !== -1);
    if (di < 0) return;
    $('days-list').children[di].scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightDay(di);
  }

  /* ---------- 畫面：每日行程 ---------- */
  function renderProgress() {
    const all = state.plan.flatMap((d) => d.items);
    const done = all.filter((i) => i.done).length;
    $('progress').textContent = '（已完成 ' + done + ' / ' + all.length + '）';
    $('progress-bar').style.width = (all.length ? done / all.length * 100 : 0) + '%';
  }

  function iconBtn(text, label, act, di, id, extra) {
    const b = el('button', { type: 'button', className: 'icon-btn ' + (extra || ''), textContent: text, title: label, ariaLabel: label });
    b.dataset.day = di; b.dataset.id = id; b.dataset.act = act;
    return b;
  }

  function renderDays() {
    const s = state.settings;
    const list = $('days-list');
    list.replaceChildren();
    state.plan.forEach((day, di) => {
      const ul = el('ul', { className: 'items' });
      day.items.forEach((item, ii) => {
        const cb = el('input', { type: 'checkbox', checked: item.done });
        cb.dataset.day = di; cb.dataset.id = item.id; cb.dataset.act = 'toggle';
        const up = iconBtn('▲', '上移 ' + item.name, 'up', di, item.id);
        const down = iconBtn('▼', '下移 ' + item.name, 'down', di, item.id);
        up.disabled = ii === 0;
        down.disabled = ii === day.items.length - 1;
        ul.append(el('li', { className: item.done ? 'done' : '' }, [
          el('label', {}, [cb, el('span', { className: 'name', textContent: item.name })]),
          mapLink(placeUrl(item), '📍地圖', 'map-link', '在 Google 地圖開啟 ' + item.name),
          el('span', { className: 'cost', textContent: item.cost ? money(item.cost) : '免費' }),
          el('span', { className: 'move' }, [up, down]),
          iconBtn('✕', '移除 ' + item.name, 'del', di, item.id, 'del')
        ]));
      });

      const form = el('form', { className: 'add' }, [
        el('input', { name: 'name', placeholder: '新增自訂項目', required: true, maxLength: 30, ariaLabel: 'Day ' + (di + 1) + ' 自訂項目名稱' }),
        el('input', { name: 'cost', type: 'number', min: 0, placeholder: '每人費用', className: 'cost-in', inputMode: 'numeric', ariaLabel: '每人費用' }),
        el('button', { type: 'submit', className: 'btn btn-small', textContent: '加入' })
      ]);
      form.dataset.day = di;

      const routeUrl = dayRouteUrl(day, s.transport);
      const date = dayDate(s.startDate, di);
      const dayTickets = day.items.reduce((a, i) => a + i.cost, 0);

      const card = el('article', { className: 'day' }, [
        el('header', {}, [
          el('span', { className: 'badge', textContent: 'Day ' + (di + 1) }),
          el('h3', { textContent: day.title }),
          date ? el('span', { className: 'date', textContent: date }) : ''
        ]),
        el('div', { className: 'day-meta' }, [
          el('span', { textContent: '住宿／終點：' + day.overnight }),
          dayTickets ? el('span', { textContent: '門票約 ' + money(dayTickets) + '／人' }) : '',
          routeUrl ? mapLink(routeUrl, '🗺 當日路線', 'route-link', '在 Google 地圖查看 Day ' + (di + 1) + ' 路線') : ''
        ]),
        ul,
        form
      ]);
      card.style.setProperty('--i', di);
      list.append(card);
    });
    renderProgress();
    renderMap();
    renderLegend();
  }

  function renderAll() {
    document.body.classList.add('has-plan');
    $('result').hidden = false;
    $('mobile-bar').hidden = false;
    renderTips();
    renderDays();
    renderBudget();
  }

  function clearAll() {
    state = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 略過 */ }
    document.body.classList.remove('has-plan');
    $('result').hidden = true;
    $('mobile-bar').hidden = true;
  }

  /* ---------- 設定 ---------- */
  function readSettings() {
    return {
      days: parseInt($('days-select').value, 10),
      people: Math.max(1, Math.min(20, parseInt($('people').value, 10) || 1)),
      transport: $('transport').value,
      level: parseInt($('level').value, 10),
      startDate: parseDate($('start-date').value) ? $('start-date').value : ''
    };
  }

  function applySettingsToForm(s) {
    $('days-select').value = s.days;
    $('people').value = s.people;
    $('transport').value = s.transport;
    $('level').value = s.level;
    $('start-date').value = s.startDate || '';
  }

  function showWarning() {
    const s = readSettings();
    const t = TRANSPORT[s.transport];
    const w = $('warning');
    if (t.minDays && s.days < t.minDays) {
      w.textContent = '提醒：' + t.warn;
      w.hidden = false;
    } else {
      w.hidden = true;
    }
  }

  /* ---------- 事件 ---------- */
  function init() {
    const sel = $('transport');
    Object.keys(TRANSPORT).forEach((k) => {
      sel.append(el('option', { value: k, textContent: TRANSPORT[k].label }));
    });
    buildMap();

    // 來源：分享連結優先，其次是這個瀏覽器先前存的行程
    const local = loadLocal();
    if (local && local.plan && local.settings) state = local;
    if (location.hash.indexOf(SHARE_PREFIX) === 0) {
      const shared = parseShared(location.hash);
      if (!shared) {
        toast('這個分享連結無法讀取');
      } else if (!state || confirm('要載入朋友分享的行程嗎？這會取代你目前儲存的行程。')) {
        state = shared;
        save();
        toast('已載入分享的行程');
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (state) {
      if (typeof state.settings.startDate !== 'string') state.settings.startDate = '';
      applySettingsToForm(state.settings);
      renderAll();
    }
    showWarning();

    $('settings').addEventListener('submit', (e) => {
      e.preventDefault();
      if (state && !confirm('重新產生行程會覆蓋目前的清單，確定嗎？')) return;
      const s = readSettings();
      state = { settings: s, plan: buildPlan(s.days) };
      save();
      renderAll();
      $('result').scrollIntoView({ behavior: 'smooth' });
    });

    // 人數／交通／預算等級／日期：即時更新（天數需重新產生）
    ['people', 'transport', 'level', 'start-date', 'days-select'].forEach((id) => {
      $(id).addEventListener('change', () => {
        showWarning();
        if (!state || id === 'days-select') return;
        const s = readSettings();
        state.settings = Object.assign({}, state.settings, { people: s.people, transport: s.transport, level: s.level, startDate: s.startDate });
        save();
        renderBudget();
        renderTips();
        if (id === 'transport' || id === 'start-date') renderDays();
      });
    });

    const map = $('route-map');
    map.addEventListener('click', (e) => {
      const g = e.target.closest('.city');
      if (g && state) jumpToCity(g.dataset.city);
    });
    map.addEventListener('keydown', (e) => {
      const g = e.target.closest('.city');
      if ((e.key === 'Enter' || e.key === ' ') && g && state) { e.preventDefault(); jumpToCity(g.dataset.city); }
    });

    const legend = $('route-legend');
    legend.addEventListener('click', (e) => {
      const b = e.target.closest('.legend-item');
      if (b && state) jumpToCity(b.dataset.city);
    });
    legend.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.legend-item');
      if (b && +b.dataset.day >= 0) highlightDay(+b.dataset.day);
    });
    legend.addEventListener('mouseleave', () => highlightDay(null));

    const list = $('days-list');
    const dayOf = (e) => {
      const card = e.target.closest ? e.target.closest('.day') : null;
      return card ? Array.prototype.indexOf.call(list.children, card) : null;
    };
    list.addEventListener('mouseover', (e) => highlightDay(dayOf(e)));
    list.addEventListener('focusin', (e) => highlightDay(dayOf(e)));
    list.addEventListener('mouseleave', () => highlightDay(null));

    list.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.act !== 'toggle') return;
      const item = state.plan[t.dataset.day].items.find((i) => i.id === t.dataset.id);
      if (item) item.done = t.checked;
      save();
      renderDays();
    });

    list.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t || t.tagName !== 'BUTTON') return;
      const day = state.plan[t.dataset.day];
      const idx = day.items.findIndex((i) => i.id === t.dataset.id);
      if (idx < 0) return;
      const act = t.dataset.act;
      if (act === 'del') {
        day.items.splice(idx, 1);
      } else if (act === 'up' || act === 'down') {
        const to = act === 'up' ? idx - 1 : idx + 1;
        if (to < 0 || to >= day.items.length) return;
        const moved = day.items.splice(idx, 1)[0];
        day.items.splice(to, 0, moved);
      } else {
        return;
      }
      save();
      renderDays();
      renderBudget();
      if (act !== 'del') { // 排序後把焦點留在同一個項目，方便連續調整
        const keep = list.querySelector('[data-id="' + t.dataset.id + '"][data-act="' + act + '"]:not(:disabled)') ||
          list.querySelector('[data-id="' + t.dataset.id + '"][data-act="' + (act === 'up' ? 'down' : 'up') + '"]:not(:disabled)');
        if (keep) keep.focus();
      }
    });

    list.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.elements.name.value.trim();
      if (!name) return;
      const cost = Math.max(0, parseInt(form.elements.cost.value, 10) || 0);
      state.plan[form.dataset.day].items.push({ id: uid(), name: name, q: name, city: '', cost: cost, done: false });
      save();
      renderDays();
      renderBudget();
    });

    $('share').addEventListener('click', async () => {
      if (!state) return;
      const url = shareUrl();
      if (navigator.share) {
        try { await navigator.share({ title: '台灣環島行程', url: url }); return; } catch (err) {
          if (err && err.name === 'AbortError') return; // 使用者取消分享
        }
      }
      toast(await copyToClipboard(url) ? '分享連結已複製，傳給旅伴吧' : '複製失敗，請手動複製網址列');
    });
    $('copytext').addEventListener('click', async () => {
      if (!state) return;
      toast(await copyToClipboard(planAsText()) ? '行程文字已複製，可貼到 LINE' : '複製失敗，請稍後再試');
    });
    $('print').addEventListener('click', () => window.print());
    $('reset').addEventListener('click', () => {
      if (confirm('確定要清除目前的行程與勾選紀錄嗎？')) clearAll();
    });
  }

  init();
})();
