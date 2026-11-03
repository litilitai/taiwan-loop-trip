(function () {
  'use strict';

  // publishable key 本來就是設計給前端公開使用的；資料安全靠資料表的 RLS，
  // 這張表只允許匿名「新增」。切勿把 secret／service_role key 放進任何前端檔案。
  const SUPABASE_URL = 'https://dqtpcduxtndxdxzuyijg.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_M7rhK8R6Mg3Sqg2xyhy1Pw_8jLuy2Y1';

  const TIMEOUT_MS = 10000; // 超過就中止請求
  const SLOW_MS = 4000;     // 超過就提示「網路有點慢」

  const form = document.getElementById('signup-form');
  const btn = document.getElementById('signup-btn');
  const msg = document.getElementById('signup-msg');
  if (!form) return;

  const client = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
  const idleLabel = btn.textContent;
  let busy = false; // 送出中旗標：連點、連按 Enter 都只會送出一次

  function say(text, kind) {
    msg.textContent = text;
    msg.className = 'signup-msg ' + (kind || '');
  }

  function setBusy(on) {
    busy = on;
    btn.disabled = on;
    btn.classList.toggle('is-loading', on);
    btn.textContent = on ? '送出中…' : idleLabel;
    form.setAttribute('aria-busy', String(on));
    Array.prototype.forEach.call(form.elements, (el) => { if (el !== btn) el.readOnly = on; });
  }

  // 把各種失敗轉成使用者看得懂的訊息（細節留在 console 給開發者看）
  function explain(error, status, timedOut) {
    const text = String((error && error.message) || '');
    if (timedOut) return '連線逾時（超過 ' + TIMEOUT_MS / 1000 + ' 秒）。資料可能沒有送出，請檢查網路後再按一次「送出」。';
    if (error && error.code === '23514') return '姓名或 Email 格式不符，請修正後再試（姓名 1–50 字）。';
    if (status === 429) return '送出太頻繁，請稍等一分鐘再試。';
    if (error && (error.code === '42501' || status === 401 || status === 403)) return '目前無法送出（沒有權限），請稍後再試或聯絡網站管理員。';
    if (status >= 500) return '伺服器暫時忙碌，請稍後再試。';
    if (!status || /fetch|network|failed|load/i.test(text)) return '連不上伺服器，請檢查網路連線後再試。';
    return '送出失敗，請稍後再試。';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;

    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();

    if (!name) return say('請輸入姓名。', 'err');
    if (!email || !form.elements.email.checkValidity()) return say('Email 格式不正確。', 'err');
    if (!form.elements.consent.checked) return say('請先勾選同意個人資料使用說明。', 'err');
    if (!client) return say('無法載入連線元件，請檢查網路後重新整理頁面。', 'err');
    if (navigator.onLine === false) return say('目前沒有網路連線，連上網路後再試。', 'err');

    setBusy(true);
    say('送出中，請稍候…', 'pending');

    const ctrl = new AbortController();
    let timedOut = false;
    const timeoutTimer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    const slowTimer = setTimeout(() => say('網路有點慢，還在送出中…', 'pending'), SLOW_MS);

    let result;
    try {
      // 不加 .select()：匿名身分沒有讀取權限，只需要新增
      result = await client.from('signups').insert({ name: name, email: email }).abortSignal(ctrl.signal);
    } catch (err) {
      result = { error: err, status: 0 };
    } finally {
      clearTimeout(timeoutTimer);
      clearTimeout(slowTimer);
      setBusy(false);
    }

    if (result.error || timedOut) {
      console.error('signup failed', result.error);
      return say(explain(result.error, result.status, timedOut), 'err');
    }
    form.reset();
    say('已收到，謝謝你！', 'ok');
  });
})();
