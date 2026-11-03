/*
 * Data Rain — 純 JS 版（移植自 React 元件，無需打包或 npm）
 * 用法：DataRain.mount(容器元素, { fullscreen: false, palette: { calm, mid, hot } })
 * 選項：count, flowSpeed, obstacleRadius, autopilot, fullscreen, palette
 * 顏色也可用 CSS 變數 --dr-calm / --dr-mid / --dr-hot / --dr-core 設定。
 */
(function (global) {
  'use strict';

  /* ───────────── constants ───────────── */
  const MAX = 7000;          // particle capacity
  const L = 19;              // history points per particle
  const STEP = 1 / 60;       // fixed physics step
  const PUFFS = 32;          // vortex pool size
  const TAU = Math.PI * 2;
  const AGE_BUCKETS = 6;
  const SEGS_PER_BUCKET = 3;

  const DEFAULT_CALM = [34, 230, 255];
  const DEFAULT_MID = [138, 92, 255];
  const DEFAULT_HOT = [255, 61, 154];
  const DEFAULT_CORE = [234, 252, 255];

  const BASE_ALPHA = [0.2, 0.32, 0.48];
  const BASE_WIDTH = [0.7, 0.9, 1.2];
  const ALPHA_GAIN = 1.3;
  const HEAD_WIDTH = 1.4;

  const K_RELAX = 1 - Math.exp(-STEP / 0.12);
  const K_Q = 1 - Math.exp(-STEP * 8);
  const K_CURSOR = 1 - Math.exp(-STEP * 18);
  const K_VEL = 1 - Math.exp(-STEP * 10);
  const K_IN = 1 - Math.exp(-STEP / 0.06);
  const K_OUT = 1 - Math.exp(-STEP / 0.2);
  const FIRE_P = 0.03 * STEP;
  const FIRE_DECAY = Math.exp(-STEP / 0.45);
  const PUFF_DECAY = Math.exp(-STEP / 1.1);

  /* ───────────── helpers ───────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseHex(input, fallback) {
    if (!input) return fallback;
    let s = input.trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 無散度的「搖擺」流場：ψ = A/|k| · sin(k·x + ωt + φ)
  function makeWave(lambda, angle, omega, phase, amp) {
    const k = TAU / lambda;
    return {
      kx: k * Math.cos(angle), ky: k * Math.sin(angle),
      om: omega, ph: phase,
      au: amp * Math.sin(angle), av: -amp * Math.cos(angle)
    };
  }
  const WAVE_0 = makeWave(380, 0.35, 0.18, 0.7, 16);
  const WAVE_1 = makeWave(620, 1.9, 0.27, 2.1, 13);
  const WAVE_2 = makeWave(900, 3.4, 0.35, 4.2, 10);

  /* ───────────── mount ───────────── */
  function mount(host, options) {
    const props = Object.assign({}, options || {});

    // DOM 結構
    const root = document.createElement('div');
    root.className = 'dr-root' + (props.fullscreen === false ? ' dr-root--contained' : '') + (props.className ? ' ' + props.className : '');
    root.setAttribute('aria-hidden', 'true');
    const bloom = document.createElement('canvas'); bloom.className = 'dr-bloom';
    const main = document.createElement('canvas'); main.className = 'dr-main';
    const vignette = document.createElement('div'); vignette.className = 'dr-vignette';
    const grain = document.createElement('div'); grain.className = 'dr-grain';
    root.append(bloom, main, vignette, grain);
    host.prepend(root);

    const ctx = main.getContext('2d');
    const bctx = bloom.getContext('2d');
    if (!ctx || !bctx) { root.remove(); return { destroy() {}, refresh() {} }; }

    const reduced = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = mulberry32(7);

    let disposed = false;
    let initialised = false;
    let live = false;
    let inView = true;

    /* geometry */
    let w = 0, h = 0, dpr = 1, bw = 1, bh = 1;

    /* particles（只配置一次） */
    const px = new Float32Array(MAX), py = new Float32Array(MAX);
    const vx = new Float32Array(MAX), vy = new Float32Array(MAX);
    const pz = new Float32Array(MAX), v0 = new Float32Array(MAX);
    const qv = new Float32Array(MAX), fire = new Float32Array(MAX);
    const len = new Uint8Array(MAX);
    const hx = new Float32Array(MAX * L), hy = new Float32Array(MAX * L);
    let head = 0;

    /* render groups */
    const groupList = [];
    for (let g = 0; g < 6; g++) groupList.push(new Int32Array(MAX));
    const groupCount = new Int32Array(6);

    /* styles */
    const strokeStyles = new Array(6 * AGE_BUCKETS).fill('');
    const strokeWidths = new Float32Array(6 * AGE_BUCKETS);
    const headStyles = ['', ''];
    let haloGradient = null;

    /* vortex pool */
    const pX = new Float32Array(PUFFS), pY = new Float32Array(PUFFS);
    const pGamma = new Float32Array(PUFFS), pAge = new Float32Array(PUFFS);
    const pAlive = new Uint8Array(PUFFS);
    const aX = new Float32Array(PUFFS), aY = new Float32Array(PUFFS);
    const aG = new Float32Array(PUFFS), aC2 = new Float32Array(PUFFS), aR2 = new Float32Array(PUFFS);
    let aCount = 0, puffCursor = 0, shedSign = 1, shedAcc = 0;

    /* simulation state */
    let simTime = 0, liveTime = 0, active = 0, targetCount = 0, quality = 1;

    /* input / cursor */
    let pointerActive = false, pointerX = 0, pointerY = 0;
    let idleSince = 0, idleDelay = 1.2, prevSrc = 0;
    let tgtX = 0, tgtY = 0, cx = 0, cy = 0, pcx = 0, pcy = 0, vcx = 0, vcy = 0;
    let influence = 0, curA = 64;

    /* loop */
    let raf = 0, last = 0, acc = 0, frameEma = 16.7, workEma = 4, slowFrames = 0, fastFrames = 0;

    /* ───────────── styles & palette ───────────── */
    function buildStyles() {
      const cs = getComputedStyle(root);
      const pal = props.palette || {};
      const calm = parseHex(pal.calm || cs.getPropertyValue('--dr-calm'), DEFAULT_CALM);
      const mid = parseHex(pal.mid || cs.getPropertyValue('--dr-mid'), DEFAULT_MID);
      const hot = parseHex(pal.hot || cs.getPropertyValue('--dr-hot'), DEFAULT_HOT);
      const core = parseHex(cs.getPropertyValue('--dr-core'), DEFAULT_CORE);
      const colours = [calm, mid, hot];

      for (let g = 0; g < 6; g++) {
        const depth = g < 3 ? 0 : 1;
        const bucket = g % 3;
        const c = colours[bucket];
        for (let ab = 0; ab < AGE_BUCKETS; ab++) {
          const falloff = Math.pow(1 - (ab + 0.5) / AGE_BUCKETS, 1.5);
          const alpha = Math.min(0.95, BASE_ALPHA[bucket] * (depth === 0 ? 0.55 : 1) * falloff * ALPHA_GAIN);
          strokeStyles[g * AGE_BUCKETS + ab] = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')';
          const width = BASE_WIDTH[bucket] * (depth === 0 ? 0.75 : 1) * (1 - (0.45 * ab) / AGE_BUCKETS);
          strokeWidths[g * AGE_BUCKETS + ab] = clamp(width, 0.6, 1.3);
        }
      }
      headStyles[0] = 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',0.5)';
      headStyles[1] = 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',0.85)';

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',1)');
      grad.addColorStop(0.45, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',0.32)');
      grad.addColorStop(1, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',0)');
      haloGradient = grad;
    }

    /* ───────────── particles ───────────── */
    function seedParticle(i, uniform) {
      let x, y;
      if (uniform) {
        x = rand() * w;
        y = rand() * h;
      } else {
        x = -40 + rand() * (w + 80);
        y = -40 - rand() * 80;
      }
      const z = 0.35 + 0.65 * rand();
      const nominal = 70 + 90 * z * z;
      const flow = clamp(props.flowSpeed !== undefined ? props.flowSpeed : 1, 0.05, 5);
      pz[i] = z;
      v0[i] = nominal;
      len[i] = 9 + Math.floor(rand() * 11);
      px[i] = x;
      py[i] = y;
      vx[i] = 0;
      vy[i] = nominal * flow;
      qv[i] = 1;
      fire[i] = 0;
      const base = i * L;
      for (let k = 0; k < L; k++) { hx[base + k] = x; hy[base + k] = y; }
    }

    function seedAll() { for (let i = 0; i < MAX; i++) seedParticle(i, true); }

    function setActive(n, uniform) {
      const next = clamp(Math.round(n), 1, MAX);
      for (let i = active; i < next; i++) seedParticle(i, uniform);
      active = next;
    }

    function applyCount(uniform) {
      const auto = clamp(Math.round((w * h) / 520), 1200, 5200);
      targetCount = clamp(Math.round(props.count !== undefined ? props.count : auto), 1, MAX);
      setActive(targetCount * quality, uniform);
    }

    /* ───────────── vortex puffs ───────────── */
    function spawnPuff(a, speed) {
      const dxn = vcx / speed;
      const dyn = vcy / speed;
      const sign = shedSign;
      shedSign = -shedSign;
      const j = puffCursor;
      puffCursor = (puffCursor + 1) % PUFFS;
      pX[j] = cx - dxn * 0.6 * a - dyn * sign * 0.7 * a;
      pY[j] = cy - dyn * 0.6 * a + dxn * sign * 0.7 * a;
      pGamma[j] = clamp(sign * Math.min(speed, 1200) * a * 1.5, -105000, 105000);
      pAge[j] = 0;
      pAlive[j] = 1;
    }

    /* ───────────── physics step ───────────── */
    function simulate() {
      const flow = clamp(props.flowSpeed !== undefined ? props.flowSpeed : 1, 0.05, 5);
      const obsR = props.obstacleRadius !== undefined ? props.obstacleRadius : 64;
      const autopilotOn = props.autopilot !== undefined ? props.autopilot : true;

      head = (head + 1) % L;
      simTime += STEP;
      if (live) liveTime += STEP;

      /* cursor source: real pointer > ghost > none */
      const ghostOn = !reduced && autopilotOn && !pointerActive && live && liveTime - idleSince >= idleDelay;
      const src = pointerActive ? 2 : ghostOn ? 1 : 0;
      if (src === 1) {
        tgtX = w * (0.5 + 0.32 * Math.sin(0.37 * liveTime));
        tgtY = h * (0.5 + 0.28 * Math.sin(0.53 * liveTime + 1.2));
      } else if (src === 2) {
        tgtX = pointerX;
        tgtY = pointerY;
      }
      const snap = src !== 0 && prevSrc === 0 && influence < 0.05;
      prevSrc = src;

      if (snap) {
        cx = tgtX; cy = tgtY; pcx = cx; pcy = cy; vcx = 0; vcy = 0;
      } else {
        pcx = cx; pcy = cy;
        cx += (tgtX - cx) * K_CURSOR;
        cy += (tgtY - cy) * K_CURSOR;
        vcx += ((cx - pcx) / STEP - vcx) * K_VEL;
        vcy += ((cy - pcy) / STEP - vcy) * K_VEL;
      }

      /* influence envelope */
      influence += ((src !== 0 ? 1 : 0) - influence) * (src !== 0 ? K_IN : K_OUT);
      const infl = influence;

      const vcMag = Math.sqrt(vcx * vcx + vcy * vcy);
      const a = obsR + Math.min(vcMag * 0.025, 36);
      curA = a;

      /* shed Kármán puffs */
      if (infl > 0.3 && vcMag > 60) {
        const dxm = cx - pcx;
        const dym = cy - pcy;
        shedAcc += Math.sqrt(dxm * dxm + dym * dym);
        let guard = 0;
        while (shedAcc >= 28 && guard < 4) {
          shedAcc -= 28;
          guard++;
          spawnPuff(a, vcMag);
        }
        if (shedAcc >= 28) shedAcc = 0;
      } else {
        shedAcc = 0;
      }

      /* evolve puffs, build compact live list */
      aCount = 0;
      const puffDrift = 0.5 * 115 * flow * STEP;
      for (let j = 0; j < PUFFS; j++) {
        if (pAlive[j] === 0) continue;
        const age = pAge[j] + STEP;
        if (age > 2.4) { pAlive[j] = 0; continue; }
        pAge[j] = age;
        pGamma[j] *= PUFF_DECAY;
        pY[j] += puffDrift;
        const c2 = 676 + 90 * age; // 26² + 90·age（黏滯擴散）
        aX[aCount] = pX[j];
        aY[aCount] = pY[j];
        aG[aCount] = pGamma[j] / TAU;
        aC2[aCount] = c2;
        aR2[aCount] = 36 * c2;
        aCount++;
      }

      /* sway phases */
      const ph0 = WAVE_0.om * simTime + WAVE_0.ph;
      const ph1 = WAVE_1.om * simTime + WAVE_1.ph;
      const ph2 = WAVE_2.om * simTime + WAVE_2.ph;
      const k0x = WAVE_0.kx, k0y = WAVE_0.ky, k1x = WAVE_1.kx, k1y = WAVE_1.ky, k2x = WAVE_2.kx, k2y = WAVE_2.ky;
      const a0u = WAVE_0.au, a0v = WAVE_0.av, a1u = WAVE_1.au, a1v = WAVE_1.av, a2u = WAVE_2.au, a2v = WAVE_2.av;

      const obsOn = infl > 0.002;
      const projectOn = infl > 0.05;
      const projScale = Math.min(1, infl * 1.5);
      const respawnBottom = h + 40;
      const respawnRight = w + 120;

      for (let i = 0; i < active; i++) {
        const x0 = px[i];
        const y0 = py[i];
        const z = pz[i];
        const v0e = v0[i] * flow;

        /* base + divergence-free sway */
        const c0 = Math.cos(k0x * x0 + k0y * y0 + ph0);
        const c1 = Math.cos(k1x * x0 + k1y * y0 + ph1);
        const c2 = Math.cos(k2x * x0 + k2y * y0 + ph2);
        let tx = (a0u * c0 + a1u * c1 + a2u * c2) * z;
        let ty = v0e + (a0v * c0 + a1v * c1 + a2v * c2) * z;

        const zf = 0.55 + 0.45 * z; // 遠處的線受影響較小
        const aE = a * zf;
        const rx = x0 - cx;
        const ry = y0 - cy;

        let pertX = 0, pertY = 0, deficit = 0;

        if (obsOn) {
          const d2 = rx * rx + ry * ry;
          let Ux = -vcx;
          let Uy = v0e - vcy;
          let U = Math.sqrt(Ux * Ux + Uy * Uy);
          if (U > 1e-3) {
            if (U > 900) {
              const sc = 900 / U;
              Ux *= sc; Uy *= sc; U = 900;
            }
            const ex = Ux / U;
            const ey = Uy / U;
            const s = rx * ex + ry * ey;   // 沿相對流向（+ 為下游）
            const n = -rx * ey + ry * ex;  // 橫向

            /* 靜態尾流缺損 */
            if (s > 0 && s < 12 * aE) {
              const wd = 0.9 * aE + 0.2 * s;
              const nn = n / wd;
              deficit = 0.55 * Math.exp(-s / (3 * aE)) * Math.exp(-nn * nn);
            }

            /* 圓柱位勢流（只取擾動部分） */
            const near = 9 * aE;
            if (d2 < near * near) {
              const rho2 = Math.max(s * s + n * n, aE * aE * 0.64);
              const k = (aE * aE) / (rho2 * rho2);
              const ds = -U * k * (s * s - n * n);
              const dn = -U * k * 2 * s * n;
              let win = 1;
              const inner = 5 * aE;
              if (d2 > inner * inner) {
                const t = (Math.sqrt(d2) - inner) / (4 * aE);
                win = 1 - t * t * (3 - 2 * t);
              }
              pertX = (ds * ex - dn * ey) * win;
              pertY = (ds * ey + dn * ex) * win;
            }
          }
        }

        /* Lamb–Oseen 渦旋（會自行衰減，所以不乘 influence） */
        let vorX = 0, vorY = 0;
        for (let j = 0; j < aCount; j++) {
          const dx = x0 - aX[j];
          const dy = y0 - aY[j];
          const d2p = dx * dx + dy * dy + 1e-3;
          const r2 = aR2[j];
          if (d2p < r2) {
            const f = (aG[j] * (1 - Math.exp(-d2p / aC2[j]))) / d2p;
            const wnd = 1 - d2p / r2;
            const fw = f * wnd * wnd * zf;
            vorX += -dy * fw;
            vorY += dx * fw;
          }
        }

        const keep = 1 - deficit * infl;
        tx = tx * keep + pertX * infl + vorX;
        ty = ty * keep + pertY * infl + vorY;

        /* inertia */
        let ux = vx[i] + (tx - vx[i]) * K_RELAX;
        let uy = vy[i] + (ty - vy[i]) * K_RELAX;
        const sp2 = ux * ux + uy * uy;
        if (sp2 > 810000) {
          const sc = 900 / Math.sqrt(sp2);
          ux *= sc; uy *= sc;
        }
        let x = x0 + ux * STEP;
        let y = y0 + uy * STEP;

        /* 粒子不可進入圓盤 */
        if (projectOn) {
          const aP = aE * projScale;
          const qx = x - cx;
          const qy = y - cy;
          const q2 = qx * qx + qy * qy;
          const lim = 0.98 * aP;
          if (q2 < lim * lim) {
            const rr = Math.sqrt(q2);
            const nx = rr < 1e-3 ? 0 : qx / rr;
            const ny = rr < 1e-3 ? 1 : qy / rr;
            x = cx + nx * aP;
            y = cy + ny * aP;
            const vn = (ux - vcx) * nx + (uy - vcy) * ny;
            if (vn < 0) { ux -= vn * nx; uy -= vn * ny; }
          }
        }

        vx[i] = ux;
        vy[i] = uy;
        px[i] = x;
        py[i] = y;

        /* respawn（完整重設歷史，避免畫出橫跨畫面的線） */
        if (y > respawnBottom || x < -120 || x > respawnRight || y < -600) {
          seedParticle(i, false);
          continue;
        }

        /* 平滑後的速度比決定色相 */
        qv[i] += (Math.sqrt(ux * ux + uy * uy) / v0e - qv[i]) * K_Q;

        /* 神經突觸式閃光 */
        if (rand() < FIRE_P) {
          fire[i] = 1;
        } else {
          const f = fire[i] * FIRE_DECAY;
          fire[i] = f < 0.01 ? 0 : f;
        }

        const slot = i * L + head;
        hx[slot] = x;
        hy[slot] = y;
      }
    }

    /* ───────────── rendering ───────────── */
    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      /* 游標光暈 */
      if (influence > 0.02 && haloGradient) {
        const speed = Math.sqrt(vcx * vcx + vcy * vcy);
        const r = 1.5 * curA;
        ctx.globalAlpha = Math.min(1, (0.05 + Math.min(speed / 4000, 0.07)) * influence);
        ctx.setTransform(dpr * r, 0, 0, dpr * r, dpr * cx, dpr * cy);
        ctx.fillStyle = haloGradient;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      /* classify */
      groupCount.fill(0);
      for (let i = 0; i < active; i++) {
        const qq = qv[i];
        let b = qq < 1.25 ? 0 : qq < 1.85 ? 1 : 2;
        if (fire[i] > 0.35 && b < 2) b++;
        const g = (pz[i] < 0.62 ? 0 : 3) + b;
        groupList[g][groupCount[g]++] = i;
      }

      /* 軌跡：群組 × 年齡區段，每組一次 stroke */
      for (let g = 0; g < 6; g++) {
        const cnt = groupCount[g];
        if (cnt === 0) continue;
        const list = groupList[g];
        for (let ab = 0; ab < AGE_BUCKETS; ab++) {
          const k0 = ab * SEGS_PER_BUCKET;
          const k1 = k0 + SEGS_PER_BUCKET;
          ctx.strokeStyle = strokeStyles[g * AGE_BUCKETS + ab];
          ctx.lineWidth = strokeWidths[g * AGE_BUCKETS + ab];
          ctx.beginPath();
          for (let j = 0; j < cnt; j++) {
            const i = list[j];
            const segs = len[i] - 1;
            if (k0 >= segs) continue;
            const base = i * L;
            const kEnd = Math.min(k1, segs);
            let idx = (head - k0 + L) % L;
            ctx.moveTo(hx[base + idx], hy[base + idx]);
            for (let k = k0; k < kEnd; k++) {
              idx = idx === 0 ? L - 1 : idx - 1;
              ctx.lineTo(hx[base + idx], hy[base + idx]);
            }
          }
          ctx.stroke();
        }
      }

      /* 白熱的頭部火花 */
      const prevHead = head === 0 ? L - 1 : head - 1;
      ctx.lineWidth = HEAD_WIDTH;
      for (let depth = 0; depth < 2; depth++) {
        ctx.strokeStyle = headStyles[depth];
        ctx.beginPath();
        for (let b = 1; b < 3; b++) {
          const g = depth * 3 + b;
          const cnt = groupCount[g];
          const list = groupList[g];
          for (let j = 0; j < cnt; j++) {
            const i = list[j];
            if (b === 1 && fire[i] <= 0.5) continue;
            const base = i * L;
            ctx.moveTo(hx[base + head], hy[base + head]);
            ctx.lineTo(hx[base + prevHead], hy[base + prevHead]);
          }
        }
        ctx.stroke();
      }

      /* bloom：縮小 1/4 的副本，由 CSS 模糊 */
      bctx.clearRect(0, 0, bw, bh);
      bctx.drawImage(main, 0, 0, bw, bh);
    }

    /* ───────────── lifecycle helpers ───────────── */
    function presim(seconds) {
      const n = Math.round(seconds / STEP);
      for (let s = 0; s < n; s++) simulate();
    }

    function rebuildStatic() {
      // 減少動態：固定游標、預先模擬後只畫一張
      seedAll();
      active = 0;
      applyCount(true);
      pointerActive = true;
      pointerX = w * 0.4;
      pointerY = h * 0.45;
      tgtX = pointerX; tgtY = pointerY;
      cx = pcx = pointerX;
      cy = pcy = pointerY;
      vcx = 0; vcy = 0;
      influence = 1;
      prevSrc = 2;
      aCount = 0;
      pAlive.fill(0);
      presim(3);
      render();
    }

    function resize() {
      const rect = root.getBoundingClientRect();
      const nw = Math.max(1, rect.width || window.innerWidth);
      const nh = Math.max(1, rect.height || window.innerHeight);
      let d = Math.min(window.devicePixelRatio || 1, 2);
      if (nw * nh * d * d > 4.5e6) d = Math.sqrt(4.5e6 / (nw * nh));
      if (nw === w && nh === h && d === dpr) return;

      w = nw; h = nh; dpr = d;
      main.width = Math.max(1, Math.round(w * dpr));
      main.height = Math.max(1, Math.round(h * dpr));
      bw = Math.max(1, Math.ceil(w / 4));
      bh = Math.max(1, Math.ceil(h / 4));
      bloom.width = bw;
      bloom.height = bh;
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'medium';

      if (!initialised) return;

      if (reduced) { rebuildStatic(); return; }
      // 保留流場，只回收超出範圍的線
      for (let i = 0; i < active; i++) {
        if (px[i] < -120 || px[i] > w + 120 || py[i] > h + 40) seedParticle(i, false);
      }
      applyCount(true);
      render();
    }

    /* ───────────── input ───────────── */
    function onLeave() {
      if (!pointerActive) return;
      pointerActive = false;
      idleSince = liveTime;
      idleDelay = 4;
    }
    function onMove(e) {
      const r = root.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      // 游標在區塊之外（例如頁面其他地方）就視為離開，改由自動導航接手
      if (x < 0 || y < 0 || x > r.width || y > r.height) { onLeave(); return; }
      pointerX = x;
      pointerY = y;
      pointerActive = true;
    }
    function onUp(e) { if (e.pointerType !== 'mouse') onLeave(); }

    /* ───────────── main loop ───────────── */
    function frame(now) {
      if (disposed) return;
      const dtRaw = Math.max(0, now - last);
      last = now;
      acc += Math.min(0.05, dtRaw / 1000);

      const t0 = performance.now();
      let n = 0;
      while (acc >= STEP && n < 3) { simulate(); acc -= STEP; n++; }
      if (n === 3) acc = 0;
      if (n > 0) render();
      const work = performance.now() - t0;

      /* 自適應畫質（dpr 執行中不變） */
      if (dtRaw > 0 && dtRaw < 100) {
        frameEma += (dtRaw - frameEma) * 0.05;
        workEma += (work - workEma) * 0.05;
      }
      if (frameEma > 20) { slowFrames++; fastFrames = 0; }
      else if (frameEma < 18.5 && workEma < 12) { fastFrames++; slowFrames = 0; }
      else { slowFrames = 0; fastFrames = 0; }
      if (slowFrames >= 60 && quality > 0.4) {
        quality = Math.max(0.4, quality - 0.1);
        slowFrames = 0;
        applyCount(false);
      } else if (fastFrames >= 180 && quality < 1) {
        quality = Math.min(1, quality + 0.05);
        fastFrames = 0;
        applyCount(false);
      }

      raf = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(raf);
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    // 分頁隱藏或區塊不在畫面內時暫停
    function syncRunning() {
      if (!live || disposed) return;
      if (document.hidden || !inView) { stop(); } else if (!raf) { start(); }
    }

    /* ───────────── init ───────────── */
    resize();
    buildStyles();
    seedAll();
    applyCount(true);
    cx = pcx = tgtX = w * 0.5;
    cy = pcy = tgtY = h * 0.5;

    const ro = new ResizeObserver(resize);
    ro.observe(root);
    let io = null;

    if (reduced) {
      initialised = true;
      rebuildStatic();
    } else {
      presim(2.5);
      render();
      initialised = true;
      live = true;
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onMove, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onLeave, { passive: true });
      window.addEventListener('blur', onLeave);
      document.documentElement.addEventListener('pointerleave', onLeave);
      document.addEventListener('visibilitychange', syncRunning);
      io = new IntersectionObserver((entries) => {
        inView = entries[0].isIntersecting;
        syncRunning();
      });
      io.observe(root);
      start();
    }

    return {
      // 修改選項後呼叫（例如換顏色、粒子數）
      update(next) {
        Object.assign(props, next || {});
        if (disposed || !initialised) return;
        buildStyles();
        if (reduced) rebuildStatic(); else applyCount(false);
      },
      destroy() {
        disposed = true;
        live = false;
        stop();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onLeave);
        window.removeEventListener('blur', onLeave);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', syncRunning);
        ro.disconnect();
        if (io) io.disconnect();
        haloGradient = null;
        root.remove();
      }
    };
  }

  global.DataRain = { mount: mount };

  // 首頁：自動掛到 .hero（限制在區塊內，不是全螢幕）
  const hero = document.querySelector('.hero');
  if (hero) global.DataRain.mount(hero, { fullscreen: false });
})(window);
