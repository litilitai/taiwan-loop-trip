/*
 * 漸層 ASCII 背景（純 Canvas）
 * 用法：在任何元素加上 data-ascii-bg 屬性即可，例如 <footer data-ascii-bg>
 * 效果：字元排出緩慢流動的漸層波紋，滑鼠經過時會有漣漪。
 */
(function () {
  'use strict';

  const RAMP = ' .:-=+*#%@';          // 由淺到深的字元
  const CELL_H = 16;                   // 每格高度（px）
  const BUCKETS = 24;                  // 水平漸層的色階數
  const FROM = [155, 231, 196];        // 左：薄荷綠
  const TO = [143, 211, 240];          // 右：天空藍
  const MAX_ALPHA = 0.5;               // 字元最亮時的透明度

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 預先算好每個「色階 × 字元深淺」的顏色字串，繪圖時直接查表
  const styles = [];
  for (let b = 0; b < BUCKETS; b++) {
    const t = b / (BUCKETS - 1);
    const rgb = FROM.map((c, i) => Math.round(c + (TO[i] - c) * t)).join(',');
    styles.push(RAMP.split('').map((_, l) => 'rgba(' + rgb + ',' + (0.06 + (l / (RAMP.length - 1)) * MAX_ALPHA).toFixed(3) + ')'));
  }

  function mount(host) {
    const canvas = document.createElement('canvas');
    canvas.className = 'ascii-bg';
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    let w = 0, h = 0, cols = 0, rows = 0, cellW = 9;
    let mouseX = -999, mouseY = -999;
    let visible = true, rafId = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = (CELL_H - 2) + 'px "SFMono-Regular", Consolas, "Courier New", monospace';
      ctx.textBaseline = 'top';
      cellW = Math.max(6, ctx.measureText('M').width);
      cols = Math.ceil(w / cellW);
      rows = Math.ceil(h / CELL_H);
      draw(performance.now() / 1000);
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) {
        const ny = y / rows;
        for (let x = 0; x < cols; x++) {
          const nx = x / cols;
          // 幾個正弦波疊加，形成緩慢流動的漸層
          let v = Math.sin(nx * 6 + t * 0.8) +
                  Math.sin(ny * 5 - t * 0.6) +
                  Math.sin((nx + ny) * 4 + t * 0.5) +
                  Math.sin(Math.hypot(nx - 0.5, (ny - 0.5) * 0.6) * 9 - t);
          v = (v / 4 + 1) / 2;
          // 滑鼠附近加亮，形成漣漪
          const dx = x - mouseX, dy = y - mouseY;
          v += 0.7 * Math.exp(-(dx * dx + dy * dy) / 60) * (0.6 + 0.4 * Math.sin(t * 6));
          const level = Math.min(RAMP.length - 1, Math.max(0, Math.floor(v * RAMP.length)));
          if (level === 0) continue;
          ctx.fillStyle = styles[Math.floor(nx * (BUCKETS - 1))][level];
          ctx.fillText(RAMP[level], x * cellW, y * CELL_H);
        }
      }
    }

    function loop(now) {
      draw(now / 1000);
      rafId = visible ? requestAnimationFrame(loop) : 0;
    }

    host.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      mouseX = (e.clientX - r.left) / cellW;
      mouseY = (e.clientY - r.top) / CELL_H;
      if (reduceMotion) draw(0);
    });
    host.addEventListener('pointerleave', () => {
      mouseX = mouseY = -999;
      if (reduceMotion) draw(0);
    });

    new ResizeObserver(resize).observe(host);
    resize();

    if (!reduceMotion) {
      // 不在畫面內時暫停動畫，省電
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible && !rafId) rafId = requestAnimationFrame(loop);
      }).observe(host);
      rafId = requestAnimationFrame(loop);
    }
  }

  document.querySelectorAll('[data-ascii-bg]').forEach(mount);
})();
