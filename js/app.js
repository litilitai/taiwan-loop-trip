(function () {
  'use strict';

  const STORAGE_KEY = 'taiwan-loop-trip-v1';
  const $ = (id) => document.getElementById(id);

  let state = load(); // { settings: {days, people, transport, level}, plan: [...] }

  /* ---------- 工具 ---------- */
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function money(n) { return 'NT$ ' + Math.round(n).toLocaleString('zh-TW'); }
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 隱私模式等情況下略過 */ }
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
      { label: '交通', value: TRANSPORT[s.transport].total(s.days, s.people) * s.people },
      { label: '住宿', value: LODGING_PER_NIGHT[s.level] * nights * s.people },
      { label: '餐飲', value: FOOD_PER_DAY[s.level] * s.days * s.people },
      { label: '門票與體驗', value: tickets }
    ];
    const subtotal = rows.reduce((a, r) => a + r.value, 0);
    rows.push({ label: '預備金 10%', value: subtotal * 0.1 });
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
    const params = new URLSearchParams({
      api: '1',
      origin: stops[0],
      destination: stops[stops.length - 1]
    });
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

  /* ---------- 畫面 ---------- */
  function renderBudget() {
    const b = calcBudget(state.settings, state.plan);
    const max = Math.max.apply(null, b.rows.map((r) => r.value)) || 1;
    const box = $('budget-rows');
    box.replaceChildren();
    b.rows.forEach((r) => {
      const bar = el('span', { className: 'bar' });
      bar.style.width = (r.value / max * 100) + '%';
      box.append(el('div', { className: 'row' }, [
        el('div', { className: 'row-head' }, [el('span', { textContent: r.label }), el('b', { textContent: money(r.value) })]),
        el('div', { className: 'bar-track' }, [bar])
      ]));
    });
    $('total').textContent = money(b.total);
    $('per-person').textContent = money(b.perPerson);
  }

  function renderProgress() {
    const all = state.plan.flatMap((d) => d.items);
    const done = all.filter((i) => i.done).length;
    $('progress').textContent = '（已完成 ' + done + ' / ' + all.length + '）';
  }

  function renderDays() {
    const list = $('days-list');
    list.replaceChildren();
    state.plan.forEach((day, di) => {
      const ul = el('ul', { className: 'items' });
      day.items.forEach((item) => {
        const cb = el('input', { type: 'checkbox', checked: item.done });
        cb.dataset.day = di; cb.dataset.id = item.id; cb.dataset.act = 'toggle';
        const del = el('button', { type: 'button', className: 'del', textContent: '✕', title: '移除', ariaLabel: '移除 ' + item.name });
        del.dataset.day = di; del.dataset.id = item.id; del.dataset.act = 'del';
        ul.append(el('li', { className: item.done ? 'done' : '' }, [
          el('label', {}, [cb, el('span', { className: 'name', textContent: item.name })]),
          mapLink(placeUrl(item), '📍地圖', 'map-link', '在 Google 地圖開啟 ' + item.name),
          el('span', { className: 'cost', textContent: item.cost ? money(item.cost) : '免費' }),
          del
        ]));
      });

      const form = el('form', { className: 'add' }, [
        el('input', { name: 'name', placeholder: '新增自訂項目', required: true, maxLength: 30 }),
        el('input', { name: 'cost', type: 'number', min: 0, placeholder: '每人費用', className: 'cost-in' }),
        el('button', { type: 'submit', className: 'btn btn-small', textContent: '加入' })
      ]);
      form.dataset.day = di;

      const routeUrl = dayRouteUrl(day, state.settings.transport);

      list.append(el('article', { className: 'day' }, [
        el('header', {}, [
          el('span', { className: 'badge', textContent: 'Day ' + (di + 1) }),
          el('h3', { textContent: day.title })
        ]),
        el('p', { className: 'overnight' }, [
          '住宿／終點：' + day.overnight,
          routeUrl ? mapLink(routeUrl, '🗺 當日路線', 'route-link', '在 Google 地圖查看 Day ' + (di + 1) + ' 路線') : ''
        ]),
        ul,
        form
      ]));
    });
    renderProgress();
    renderMap();
  }

  /* ---------- 路線圖 ---------- */
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

  function highlightDay(di) {
    const names = di == null ? [] : state.plan[di].title.split(' → ');
    mapCities().forEach((g) => g.classList.toggle('active', names.indexOf(g.dataset.city) !== -1));
  }

  function jumpToCity(name) {
    const di = state.plan.findIndex((d) => d.title.split(' → ').indexOf(name) !== -1);
    if (di < 0) return;
    const card = $('days-list').children[di];
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightDay(di);
  }

  function renderAll() {
    $('result').hidden = false;
    renderDays();
    renderBudget();
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

  /* ---------- 設定 ---------- */
  function readSettings() {
    const people = Math.max(1, Math.min(20, parseInt($('people').value, 10) || 1));
    return {
      days: parseInt($('days').value, 10),
      people: people,
      transport: $('transport').value,
      level: parseInt($('level').value, 10)
    };
  }

  function applySettingsToForm(s) {
    $('days').value = s.days;
    $('people').value = s.people;
    $('transport').value = s.transport;
    $('level').value = s.level;
  }

  /* ---------- 事件 ---------- */
  function init() {
    const sel = $('transport');
    Object.keys(TRANSPORT).forEach((k) => {
      sel.append(el('option', { value: k, textContent: TRANSPORT[k].label }));
    });

    buildMap();
    const map = $('route-map');
    map.addEventListener('click', (e) => {
      const g = e.target.closest('.city');
      if (g && state) jumpToCity(g.dataset.city);
    });
    map.addEventListener('keydown', (e) => {
      const g = e.target.closest('.city');
      if ((e.key === 'Enter' || e.key === ' ') && g && state) { e.preventDefault(); jumpToCity(g.dataset.city); }
    });

    if (state && state.plan) {
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

    // 人數／交通／預算等級：即時更新費用（天數需重新產生）
    ['people', 'transport', 'level', 'days'].forEach((id) => {
      $(id).addEventListener('change', () => {
        showWarning();
        if (!state || id === 'days') return;
        const s = readSettings();
        state.settings = Object.assign({}, state.settings, { people: s.people, transport: s.transport, level: s.level });
        save();
        renderBudget();
        if (id === 'transport') renderDays(); // 當日路線連結的交通模式會跟著變
      });
    });

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
      const t = e.target.closest('[data-act="del"]');
      if (!t) return;
      const day = state.plan[t.dataset.day];
      day.items = day.items.filter((i) => i.id !== t.dataset.id);
      save();
      renderDays();
      renderBudget();
    });
    list.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.elements.name.value.trim();
      if (!name) return;
      const cost = Math.max(0, parseInt(form.elements.cost.value, 10) || 0);
      state.plan[form.dataset.day].items.push({ id: uid(), name: name, city: '', cost: cost, done: false });
      save();
      renderDays();
      renderBudget();
    });

    $('print').addEventListener('click', () => window.print());
    $('reset').addEventListener('click', () => {
      if (!confirm('確定要清除目前的行程與勾選紀錄嗎？')) return;
      state = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 略過 */ }
      $('result').hidden = true;
    });
  }

  init();
})();
