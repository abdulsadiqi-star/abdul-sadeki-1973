/* پنل مدیریت فروشگاه — جاوااسکریپت خالص، متصل به /api/admin */
(function () {
  'use strict';

  /* ---------- ابزارها ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const fd = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const toEn = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (ms) => new Date(ms).toLocaleDateString('fa-IR');
  const dateTime = (ms) => new Date(ms).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
  const toman = (n) => fa(n) + ' تومان';
  const num = (v) => Number(toEn(v).replace(/[^\d]/g, '') || 0);
  const view = $('#view');
  const TOKEN = 'kalano.admin';
  const tok = { get() { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } }, set(v) { try { v ? localStorage.setItem(TOKEN, v) : localStorage.removeItem(TOKEN); } catch (e) { /* ignore */ } } };

  const ICON = {
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    box: '<path d="M4 8 12 4l8 4v8l-8 4-8-4Z"/><path d="m4 8 8 4 8-4M12 12v8"/>',
    cart: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
    tag: '<path d="M3 12V4h8l9 9-8 8Z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4Z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
    chat: '<path d="M4 5h16v11H9l-5 4Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
  };
  const ic = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>';

  const STATUS = {
    pending_payment: ['در انتظار پرداخت', 'warn'], processing: ['در حال پردازش', 'ok'], shipped: ['ارسال شده', 'ok'],
    delivered: ['تحویل داده شده', 'ok'], cancelled: ['لغو شده', 'bad'], payment_failed: ['پرداخت ناموفق', 'bad']
  };
  const pill = (s) => '<span class="pill ' + (STATUS[s] || ['', ''])[1] + '">' + (STATUS[s] || [s])[0] + '</span>';
  const PAGES = [
    ['dashboard', 'داشبورد', 'grid'], ['orders', 'سفارش‌ها', 'cart'], ['products', 'محصولات', 'box'], ['categories', 'دسته‌بندی‌ها', 'tag'],
    ['coupons', 'کدهای تخفیف', 'ticket'], ['reviews', 'دیدگاه‌ها', 'chat'], ['users', 'مشتریان', 'user'], ['settings', 'تنظیمات فروشگاه', 'gear']
  ];

  let CATS = [];
  let INTEG = {};
  let DEV_PW = false;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  async function api(path, body, method) {
    const opt = { method: method || (body ? 'POST' : 'GET'), headers: { accept: 'application/json' } };
    if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const t = tok.get();
    if (t) opt.headers.authorization = 'Bearer ' + t;
    let res;
    try { res = await fetch(path, opt); } catch (e) { throw new Error('ارتباط با سرور برقرار نشد.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { tok.set(null); showLogin(); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'خطایی رخ داد.'), { status: res.status });
    return data;
  }

  /* ---------- مودال و تأیید ---------- */
  function modal(html, wide) {
    $('#modalRoot').innerHTML = '<div class="overlay" id="ov"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="x" type="button" data-close aria-label="بستن">×</button>' + html + '</div></div>';
    const ov = $('#ov');
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) closeModal(); });
    const first = $('input, select, textarea, button:not(.x)', ov);
    if (first) setTimeout(() => first.focus(), 30);
    return ov;
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function confirmBox(msg, okLabel) {
    return new Promise((resolve) => {
      const ov = modal('<h2>مطمئن هستید؟</h2><p>' + esc(msg) + '</p><div class="row-inline" style="justify-content:flex-end">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-close>انصراف</button><button class="btn btn-danger btn-sm" type="button" id="okBtn">' + esc(okLabel || 'حذف') + '</button></div>');
      $('#okBtn', ov).addEventListener('click', () => { closeModal(); resolve(true); });
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) resolve(false); });
    });
  }

  /* ---------- ورود ---------- */
  function showLogin() {
    $('#shell').hidden = true; $('#noServer').hidden = true; $('#login').hidden = false;
    setTimeout(() => $('#adminPw').focus(), 30);
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); const err = $('#loginErr');
    btn.disabled = true; btn.textContent = 'در حال ورود…'; err.textContent = '';
    try {
      const r = await api('/api/admin/login', { password: $('#adminPw').value });
      tok.set(r.token); DEV_PW = r.devPassword;
      $('#adminPw').value = '';
      await enter();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false; btn.textContent = 'ورود';
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', {}); } catch (e) { /* ignore */ }
    tok.set(null); showLogin();
  });

  async function enter() {
    const me = await api('/api/admin/me');
    INTEG = me.integrations; DEV_PW = me.devPassword;
    CATS = (await api('/api/admin/categories')).categories;
    $('#login').hidden = true; $('#shell').hidden = false;
    $('#sideNav').innerHTML = PAGES.map((p) => '<a href="#' + p[0] + '" data-page="' + p[0] + '">' + ic(p[2]) + '<span>' + p[1] + '</span>' + (p[0] === 'orders' ? '<span class="count num" id="toShipCount" hidden></span>' : '') + '</a>').join('');
    route();
  }

  /* ---------- مسیریابی ---------- */
  window.addEventListener('hashchange', route);
  function route() {
    if ($('#shell').hidden) return;
    const page = (location.hash.slice(1) || 'dashboard').split('-')[0];
    const p = PAGES.find((x) => x[0] === page) || PAGES[0];
    $$('#sideNav a').forEach((a) => a.classList.toggle('on', a.dataset.page === p[0]));
    document.title = p[1] + ' | پنل مدیریت';
    view.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    closeModal();
    PAGE_FN[p[0]]().catch((e) => { view.innerHTML = '<div class="empty panel"><h3>' + esc(e.message) + '</h3></div>'; });
  }
  const head = (title, sub, actions) => '<div class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions || '') + '</div>';
  const devBanner = () => DEV_PW ? '<div class="notice warn">رمز پیش‌فرض <code>admin1234</code> فعال است. قبل از انتشار سایت، در فایل <code>.env</code> مقدار <code>ADMIN_PASSWORD</code> را تنظیم کنید.</div>' : '';

  /* =====================================================================
     داشبورد
     ===================================================================== */
  async function dashboard() {
    const s = await api('/api/admin/stats');
    const cnt = $('#toShipCount'); if (cnt) { cnt.hidden = !s.toShip; cnt.textContent = fa(s.toShip); }
    view.innerHTML = head('داشبورد', 'خلاصه‌ی وضعیت فروشگاه') + '<div class="stack">' + devBanner() +
      '<div class="kpis">' +
        kpi('فروش کل', toman(s.revenue), 'سفارش‌های پرداخت‌شده و در محل') +
        kpi('سفارش‌های امروز', fa(s.ordersToday), 'به‌جز پرداخت‌های ناموفق') +
        '<a href="#orders" class="panel kpi' + (s.toShip ? ' attn' : '') + '"><span>آماده ارسال</span><b>' + fa(s.toShip) + '</b><small>' + (s.toShip ? 'برای دیدن سفارش‌ها بزنید' : 'سفارشی منتظر نیست') + '</small></a>' +
        kpi('مشتریان', fa(s.customers), 'کاربران ثبت‌نام‌شده') +
        kpi('کالاهای فعال', fa(s.products), s.lowStock.length ? fa(s.lowStock.length) + ' کالا رو به اتمام' : 'موجودی همه کالاها کافی است') +
      '</div>' +
      '<section class="panel"><div class="panel-head"><h2>فروش ۱۴ روز اخیر</h2><span class="hint">مبالغ به تومان</span></div>' + salesChart(s.daily) + '</section>' +
      '<div class="cols">' +
        '<section class="panel"><div class="panel-head"><h2>آخرین سفارش‌ها</h2><a href="#orders">همه سفارش‌ها ←</a></div>' +
          (s.latest.length ? '<div class="table-wrap"><table class="t"><thead><tr><th>کد</th><th>مشتری</th><th class="num">مبلغ</th><th>وضعیت</th></tr></thead><tbody>' +
            s.latest.map((o) => '<tr><td class="num">' + esc(o.code) + '</td><td class="num">' + fd(o.userPhone) + '</td><td class="num">' + toman(o.total) + '</td><td>' + pill(o.status) + '</td></tr>').join('') +
          '</tbody></table></div>' : '<div class="empty" style="padding:28px"><p>هنوز سفارشی ثبت نشده است.</p></div>') +
        '</section>' +
        '<section class="panel"><div class="panel-head"><h2>کالاهای رو به اتمام</h2><a href="#products">مدیریت محصولات ←</a></div>' +
          (s.lowStock.length ? '<div class="table-wrap"><table class="t"><tbody>' + s.lowStock.map((p) => '<tr><td style="width:40px;font-size:22px">' + esc(p.emoji) + '</td><td class="title-cell"><b>' + esc(p.title) + '</b></td><td class="num"><span class="stock-badge low">' + (p.stock ? fa(p.stock) + ' عدد' : 'ناموجود') + '</span></td></tr>').join('') + '</tbody></table></div>'
            : '<div class="empty" style="padding:28px"><p>موجودی همه کالاها بیشتر از ۳ عدد است.</p></div>') +
        '</section>' +
      '</div></div>';
    bindChart(s.daily);
  }
  const kpi = (label, value, note) => '<div class="panel kpi"><span>' + label + '</span><b>' + value + '</b><small>' + note + '</small></div>';

  /* نمودار ستونی فروش روزانه؛ زمان از راست به چپ جریان دارد (قدیمی‌ترین روز سمت راست) */
  function niceCeil(v) {
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  const compact = (v) => v >= 1e6 ? fa(Math.round(v / 1e5) / 10) + ' م' : v >= 1e3 ? fa(Math.round(v / 1e3)) + ' هـ' : fa(v);
  const G = { W: 720, H: 230, padR: 52, padL: 8, padT: 14, padB: 28 };

  function salesChart(daily) {
    // عرض نمودار با عرض صفحه تنظیم می‌شود تا متن‌ها در موبایل ریز نشوند
    G.W = Math.round(Math.max(340, Math.min(720, view.clientWidth - 64)));
    const { W, H, padR, padL, padT, padB } = G;
    const every = W < 520 ? 3 : 2;
    const max = Math.max.apply(null, daily.map((d) => d.total));
    const top = niceCeil(max || 1000000);
    const plotW = W - padR - padL; const plotH = H - padT - padB;
    const step = plotW / daily.length; const bw = Math.min(26, step * 0.6);
    const y = (v) => padT + plotH * (1 - v / top);
    let svg = '';
    for (let i = 0; i <= 4; i++) {
      const v = top * i / 4; const yy = y(v);
      svg += '<line class="' + (i ? 'gl' : 'base') + '" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text x="' + (W - padR + 8) + '" y="' + (yy + 4) + '" text-anchor="start">' + compact(v) + '</text>';
    }
    daily.forEach((d, i) => {
      const cx = W - padR - step * (i + 0.5);
      const h = plotH * d.total / top;
      if (h > 0) {
        const x0 = cx - bw / 2; const x1 = cx + bw / 2; const yt = padT + plotH - h; const yb = padT + plotH; const r = Math.min(4, h, bw / 2);
        svg += '<path class="bar" data-i="' + i + '" d="M' + x0 + ' ' + yb + 'V' + (yt + r) + 'Q' + x0 + ' ' + yt + ' ' + (x0 + r) + ' ' + yt + 'H' + (x1 - r) + 'Q' + x1 + ' ' + yt + ' ' + x1 + ' ' + (yt + r) + 'V' + yb + 'Z"/>';
      }
      if ((daily.length - 1 - i) % every === 0) {
        svg += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + new Date(d.day).toLocaleDateString('fa-IR', { day: 'numeric', month: 'short' }) + '</text>';
      }
      svg += '<rect class="hit" data-i="' + i + '" x="' + (cx - step / 2) + '" y="' + padT + '" width="' + step + '" height="' + plotH + '"/>';
    });
    if (!max) svg += '<text class="empty-note" x="' + (padL + plotW / 2) + '" y="' + (padT + plotH / 2) + '" text-anchor="middle">هنوز فروشی در ۱۴ روز اخیر ثبت نشده است</text>';
    const total = daily.reduce((a, d) => a + d.total, 0); const count = daily.reduce((a, d) => a + d.count, 0);
    return '<div class="chart" id="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="نمودار فروش روزانه ۱۴ روز اخیر">' + svg + '</svg><div class="tip" id="tip" hidden></div></div>' +
      '<div class="chart-caption num"><span>جمع ۱۴ روز: <b>' + toman(total) + '</b> از ' + fa(count) + ' سفارش</span><span>«م» یعنی میلیون و «هـ» یعنی هزار تومان</span></div>' +
      '<details class="data-table"><summary>نمایش به صورت جدول</summary><div class="table-wrap"><table class="t"><thead><tr><th>روز</th><th class="num">تعداد سفارش</th><th class="num">مبلغ</th></tr></thead><tbody>' +
      daily.slice().reverse().map((d) => '<tr><td>' + date(d.day) + '</td><td class="num">' + fa(d.count) + '</td><td class="num">' + toman(d.total) + '</td></tr>').join('') + '</tbody></table></div></details>';
  }

  function bindChart(daily) {
    const chart = $('#chart'); if (!chart) return;
    const tip = $('#tip');
    const show = (i) => {
      const d = daily[i]; const hit = $('.hit[data-i="' + i + '"]', chart);
      chart.classList.add('hovering');
      $$('.bar', chart).forEach((b) => b.classList.toggle('on', b.dataset.i === String(i)));
      const cr = chart.getBoundingClientRect(); const hr = hit.getBoundingClientRect();
      const bar = $('.bar[data-i="' + i + '"]', chart);
      const topPx = bar ? bar.getBoundingClientRect().top : hr.bottom;
      tip.innerHTML = new Date(d.day).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' }) + '<br><b>' + toman(d.total) + '</b> • ' + fa(d.count) + ' سفارش';
      tip.hidden = false;
      const left = Math.min(Math.max(hr.left + hr.width / 2 - cr.left, 70), cr.width - 70);
      tip.style.left = left + 'px'; tip.style.top = (topPx - cr.top) + 'px';
    };
    const hide = () => { chart.classList.remove('hovering'); tip.hidden = true; };
    chart.addEventListener('mouseover', (e) => { const h = e.target.closest('.hit'); if (h) show(Number(h.dataset.i)); });
    chart.addEventListener('click', (e) => { const h = e.target.closest('.hit'); if (h) show(Number(h.dataset.i)); });
    chart.addEventListener('mouseleave', hide);
  }

  /* =====================================================================
     محصولات
     ===================================================================== */
  let PRODUCTS = [];
  const PF = { q: '', cat: '' };
  async function products() {
    PRODUCTS = (await api('/api/admin/products')).products;
    CATS = (await api('/api/admin/categories')).categories;
    view.innerHTML = head('محصولات', fa(PRODUCTS.length) + ' کالا', '<button class="btn btn-primary" type="button" id="addProduct">+ افزودن کالا</button>') +
      '<div class="toolbar"><input class="grow" id="pq" type="search" placeholder="جستجو در نام یا برند" value="' + esc(PF.q) + '" aria-label="جستجو">' +
      '<select id="pcat" aria-label="دسته‌بندی"><option value="">همه دسته‌ها</option>' + CATS.map((c) => '<option value="' + esc(c.id) + '"' + (PF.cat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<section class="panel"><div class="table-wrap" id="ptable"></div></section>';
    drawProducts();
    $('#pq').addEventListener('input', (e) => { PF.q = e.target.value; drawProducts(); });
    $('#pcat').addEventListener('change', (e) => { PF.cat = e.target.value; drawProducts(); });
    $('#addProduct').addEventListener('click', () => productForm(null));
  }
  function drawProducts() {
    const q = PF.q.trim();
    const list = PRODUCTS.filter((p) => (!PF.cat || p.cat === PF.cat) && (!q || p.title.includes(q) || p.brand.includes(q)));
    const catName = (id) => (CATS.find((c) => c.id === id) || { name: id }).name;
    const hue = (id) => (CATS.find((c) => c.id === id) || { hue: 20 }).hue;
    $('#ptable').innerHTML = list.length ? '<table class="t"><thead><tr><th></th><th>نام کالا</th><th>دسته</th><th class="num">قیمت</th><th class="num">تخفیف</th><th class="num">موجودی</th><th class="num">فروش</th><th>وضعیت</th><th></th></tr></thead><tbody>' +
      list.map((p) => '<tr class="' + (p.active ? '' : 'off') + '"><td><span class="thumb-sm" style="--h:' + hue(p.cat) + '">' + (p.img ? '<img src="' + esc(p.img) + '" alt="">' : esc(p.emoji)) + '</span></td>' +
        '<td class="title-cell"><b title="' + esc(p.title) + '">' + esc(p.title) + '</b><small>' + esc(p.brand) + ' • کد ' + fa(p.id) + '</small></td>' +
        '<td>' + esc(catName(p.cat)) + '</td><td class="num">' + toman(p.price) + '</td><td class="num">' + (p.off ? fa(p.off) + '٪' : '—') + '</td>' +
        '<td class="num"><span class="stock-badge' + (p.stock <= 3 ? ' low' : '') + '">' + fa(p.stock) + '</span></td><td class="num">' + fa(p.sold) + '</td>' +
        '<td>' + (p.active ? '<span class="pill ok">فعال</span>' : '<span class="pill bad">پنهان</span>') + '</td>' +
        '<td><div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-edit="' + p.id + '">ویرایش</button><button class="btn btn-danger btn-sm" type="button" data-del="' + p.id + '">حذف</button></div></td></tr>').join('') +
      '</tbody></table>' : '<div class="empty"><p>کالایی با این مشخصات پیدا نشد.</p></div>';
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => productForm(PRODUCTS.find((p) => p.id === Number(b.dataset.edit)))));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      const p = PRODUCTS.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmBox('کالای «' + p.title + '» برای همیشه حذف می‌شود. سفارش‌های قبلی آن دست نمی‌خورند.'))) return;
      try { await api('/api/admin/products/' + p.id, null, 'DELETE'); toast('کالا حذف شد'); products(); } catch (e) { toast(e.message); }
    }));
  }

  function productForm(p) {
    const isNew = !p;
    p = p || { title: '', cat: (CATS[0] || {}).id, brand: '', price: '', off: 0, stock: 0, emoji: '📦', img: null, colors: [], specs: {}, description: '', active: true };
    const colorRow = (c) => '<div class="row-inline" data-color-row><input type="color" value="' + esc(c.hex || '#888888') + '" aria-label="رنگ"><input type="text" value="' + esc(c.name || '') + '" placeholder="نام رنگ، مثلاً مشکی" aria-label="نام رنگ"><button class="btn btn-ghost btn-sm" type="button" data-rm>حذف</button></div>';
    const specRow = (k, v) => '<div class="row-inline" data-spec-row><input type="text" value="' + esc(k || '') + '" placeholder="عنوان، مثلاً وزن" aria-label="عنوان مشخصه"><input type="text" value="' + esc(v || '') + '" placeholder="مقدار، مثلاً ۲۰۰ گرم" aria-label="مقدار مشخصه"><button class="btn btn-ghost btn-sm" type="button" data-rm>حذف</button></div>';
    const ov = modal('<h2>' + (isNew ? 'افزودن کالای جدید' : 'ویرایش کالا') + '</h2>' +
      '<form id="pform" class="stack" novalidate>' +
        '<label class="field">نام کالا<input id="f_title" value="' + esc(p.title) + '" maxlength="200" required></label>' +
        '<div class="form-grid three">' +
          '<label class="field">دسته‌بندی<select id="f_cat">' + CATS.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === p.cat ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
          '<label class="field">برند<input id="f_brand" value="' + esc(p.brand) + '" maxlength="60"></label>' +
          '<label class="field">ایموجی (وقتی عکس ندارد)<input id="f_emoji" value="' + esc(p.emoji) + '" maxlength="8"></label>' +
          '<label class="field">قیمت (تومان)<input id="f_price" class="num" inputmode="numeric" value="' + (p.price ? fa(p.price) : '') + '"></label>' +
          '<label class="field">درصد تخفیف<input id="f_off" class="num" inputmode="numeric" value="' + fa(p.off) + '"></label>' +
          '<label class="field">موجودی انبار<input id="f_stock" class="num" inputmode="numeric" value="' + fa(p.stock) + '"></label>' +
        '</div>' +
        '<div class="field">عکس کالا<div class="img-pick"><span class="thumb-sm" id="imgPrev" style="--h:20">' + (p.img ? '<img src="' + esc(p.img) + '" alt="">' : esc(p.emoji)) + '</span>' +
          '<label class="btn btn-ghost btn-sm">انتخاب عکس<input type="file" id="f_file" accept="image/png,image/jpeg,image/webp" hidden></label>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="imgClear"' + (p.img ? '' : ' hidden') + '>حذف عکس</button><span class="hint">JPG، PNG یا WebP، حداکثر ۳ مگابایت</span></div></div>' +
        '<div><div class="sub-title">رنگ‌ها <button class="link-btn" type="button" id="addColor">+ افزودن رنگ</button></div><div class="rows" id="colors">' + p.colors.map(colorRow).join('') + '</div></div>' +
        '<div><div class="sub-title">مشخصات فنی <button class="link-btn" type="button" id="addSpec">+ افزودن ردیف</button></div><div class="rows" id="specs">' + Object.entries(p.specs).map((e) => specRow(e[0], e[1])).join('') + '</div></div>' +
        '<label class="field">توضیحات (اگر خالی بماند، متن معرفی خودکار ساخته می‌شود)<textarea id="f_desc" rows="4" maxlength="3000">' + esc(p.description) + '</textarea></label>' +
        '<label class="check-row"><input type="checkbox" id="f_active"' + (p.active ? ' checked' : '') + '> در فروشگاه نمایش داده شود</label>' +
        '<span class="err" id="pErr" role="alert"></span>' +
        '<div class="row-inline" style="justify-content:flex-end"><button class="btn btn-ghost" type="button" data-close>انصراف</button><button class="btn btn-primary" type="submit" id="pSave">' + (isNew ? 'افزودن کالا' : 'ذخیره تغییرات') + '</button></div>' +
      '</form>', true);

    let img = p.img;
    const prev = $('#imgPrev', ov);
    $('#addColor', ov).addEventListener('click', () => $('#colors', ov).insertAdjacentHTML('beforeend', colorRow({})));
    $('#addSpec', ov).addEventListener('click', () => $('#specs', ov).insertAdjacentHTML('beforeend', specRow()));
    ov.addEventListener('click', (e) => { const rm = e.target.closest('[data-rm]'); if (rm) rm.parentElement.remove(); });
    $('#imgClear', ov).addEventListener('click', () => { img = null; prev.textContent = $('#f_emoji', ov).value || '📦'; $('#imgClear', ov).hidden = true; });
    $('#f_file', ov).addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) { toast('حجم عکس باید کمتر از ۳ مگابایت باشد'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        prev.innerHTML = '<div class="spinner" style="width:22px;height:22px;margin:0"></div>';
        try {
          const r = await api('/api/admin/upload', { data: reader.result });
          img = r.url; prev.innerHTML = '<img src="' + esc(img) + '" alt="">'; $('#imgClear', ov).hidden = false;
        } catch (ex) { toast(ex.message); prev.innerHTML = img ? '<img src="' + esc(img) + '" alt="">' : esc(p.emoji); }
      };
      reader.readAsDataURL(file);
    });

    $('#pform', ov).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        title: $('#f_title', ov).value, cat: $('#f_cat', ov).value, brand: $('#f_brand', ov).value, emoji: $('#f_emoji', ov).value,
        price: num($('#f_price', ov).value), off: num($('#f_off', ov).value), stock: num($('#f_stock', ov).value), img,
        colors: $$('[data-color-row]', ov).map((r) => ({ hex: $('input[type=color]', r).value, name: $('input[type=text]', r).value.trim() })).filter((c) => c.name),
        specs: $$('[data-spec-row]', ov).map((r) => $$('input', r).map((i) => i.value.trim())).filter((x) => x[0] && x[1]),
        description: $('#f_desc', ov).value, active: $('#f_active', ov).checked
      };
      const btn = $('#pSave', ov); btn.disabled = true;
      try {
        await api('/api/admin/products' + (isNew ? '' : '/' + p.id), body, isNew ? 'POST' : 'PUT');
        closeModal(); toast(isNew ? 'کالا اضافه شد' : 'تغییرات ذخیره شد'); products();
      } catch (ex) { $('#pErr', ov).textContent = ex.message; btn.disabled = false; }
    });
  }

  /* =====================================================================
     سفارش‌ها
     ===================================================================== */
  const OF = { status: '', q: '' };
  let ORDERS = [];
  async function orders() {
    view.innerHTML = head('سفارش‌ها', 'وضعیت هر سفارش را از ستون «وضعیت» تغییر دهید') +
      '<div class="chips" id="ochips">' + [['', 'همه']].concat(Object.entries(STATUS).map((e) => [e[0], e[1][0]])).map((s) => '<button type="button" data-s="' + s[0] + '" class="' + (OF.status === s[0] ? 'on' : '') + '">' + s[1] + '</button>').join('') + '</div>' +
      '<div class="toolbar"><input class="grow" id="oq" type="search" placeholder="جستجو با کد سفارش یا شماره موبایل" value="' + esc(OF.q) + '" aria-label="جستجو"></div>' +
      '<section class="panel"><div class="table-wrap" id="otable"><div class="empty"><div class="spinner"></div></div></div></section>';
    $('#ochips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; OF.status = b.dataset.s; $$('#ochips button').forEach((x) => x.classList.toggle('on', x === b)); loadOrders(); });
    let t; $('#oq').addEventListener('input', (e) => { OF.q = e.target.value; clearTimeout(t); t = setTimeout(loadOrders, 300); });
    await loadOrders();
  }
  async function loadOrders() {
    const qs = new URLSearchParams(); if (OF.status) qs.set('status', OF.status); if (OF.q.trim()) qs.set('q', OF.q.trim());
    ORDERS = (await api('/api/admin/orders?' + qs)).orders;
    const box = $('#otable'); if (!box) return;
    box.innerHTML = ORDERS.length ? '<table class="t"><thead><tr><th>کد سفارش</th><th>مشتری</th><th>تاریخ</th><th class="num">مبلغ</th><th>پرداخت</th><th>وضعیت</th><th></th></tr></thead><tbody>' +
      ORDERS.map((o) => {
        const editable = ['processing', 'shipped', 'delivered'].includes(o.status);
        const sel = editable ? '<select class="inline-select" data-status="' + esc(o.code) + '" aria-label="وضعیت سفارش">' + ['processing', 'shipped', 'delivered', 'cancelled'].map((s) => '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + STATUS[s][0] + '</option>').join('') + '</select>'
          : pill(o.status) + (o.status === 'pending_payment' ? ' <button class="link-btn" type="button" data-cancel="' + esc(o.code) + '">لغو</button>' : '');
        return '<tr><td class="num"><b>' + esc(o.code) + '</b></td><td><div>' + esc(o.userName || o.address.name) + '</div><small class="muted num">' + fd(o.userPhone) + '</small></td>' +
          '<td class="num">' + dateTime(o.createdAt) + '</td><td class="num">' + toman(o.total) + '</td>' +
          '<td>' + (o.payMethod === 'cod' ? 'در محل' : 'اینترنتی' + (o.refId ? '<br><small class="muted num">رهگیری ' + fd(o.refId) + '</small>' : '')) + '</td>' +
          '<td>' + sel + '</td><td><button class="btn btn-ghost btn-sm" type="button" data-view="' + esc(o.code) + '">جزئیات</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty"><p>سفارشی با این شرایط پیدا نشد.</p></div>';
    $$('[data-status]', box).forEach((s) => s.addEventListener('change', () => setStatus(s.dataset.status, s.value)));
    $$('[data-cancel]', box).forEach((b) => b.addEventListener('click', () => setStatus(b.dataset.cancel, 'cancelled')));
    $$('[data-view]', box).forEach((b) => b.addEventListener('click', () => orderDetail(ORDERS.find((o) => o.code === b.dataset.view))));
  }
  async function setStatus(code, status) {
    if (status === 'cancelled' && !(await confirmBox('سفارش ' + code + ' لغو می‌شود و موجودی کالاهایش به انبار برمی‌گردد. این کار برگشت‌پذیر نیست.', 'لغو سفارش'))) { loadOrders(); return; }
    try { await api('/api/admin/orders/' + encodeURIComponent(code), { status }, 'PUT'); toast('وضعیت سفارش به «' + STATUS[status][0] + '» تغییر کرد'); } catch (e) { toast(e.message); }
    loadOrders();
  }
  function orderDetail(o) {
    const a = o.address;
    modal('<h2>سفارش <span class="num">' + esc(o.code) + '</span></h2><div>' + pill(o.status) + '</div>' +
      '<div class="table-wrap"><table class="t"><thead><tr><th>کالا</th><th class="num">تعداد</th><th class="num">قیمت واحد</th><th class="num">جمع</th></tr></thead><tbody>' +
      o.items.map((i) => '<tr><td class="title-cell"><b>' + esc(i.emoji) + ' ' + esc(i.title) + '</b>' + (i.color ? '<small>رنگ: ' + esc(i.color.name) + '</small>' : '') + '</td><td class="num">' + fa(i.qty) + '</td><td class="num">' + toman(i.price) + '</td><td class="num">' + toman(i.price * i.qty) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<div class="table-wrap"><table class="t"><tbody>' +
        '<tr><td class="muted">جمع کالاها</td><td class="num">' + toman(o.payable) + '</td></tr>' +
        (o.couponDisc ? '<tr><td class="muted">کد تخفیف ' + esc(o.coupon) + '</td><td class="num">' + toman(o.couponDisc) + '−</td></tr>' : '') +
        '<tr><td class="muted">ارسال ' + (o.ship === 'express' ? 'اکسپرس' : 'عادی') + '</td><td class="num">' + (o.shipCost ? toman(o.shipCost) : 'رایگان') + '</td></tr>' +
        '<tr><td><b>مبلغ نهایی</b></td><td class="num"><b>' + toman(o.total) + '</b></td></tr>' +
        '<tr><td class="muted">پرداخت</td><td>' + (o.payMethod === 'cod' ? 'در محل' : 'اینترنتی') + (o.refId ? ' • کد رهگیری <span class="num">' + fd(o.refId) + '</span>' : '') + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="notice info"><b>تحویل به:</b> ' + esc(a.name) + ' • <span class="num">' + fd(a.phone) + '</span><br>' + esc(a.province) + '، ' + esc(a.city) + '، ' + esc(a.address) + '<br>کد پستی: <span class="num">' + fd(a.postal) + '</span></div>', true);
  }

  /* =====================================================================
     دسته‌بندی‌ها
     ===================================================================== */
  async function categories() {
    CATS = (await api('/api/admin/categories')).categories;
    const row = (c) => '<tr data-cat="' + esc(c.id) + '"><td><span class="thumb-sm" style="--h:' + c.hue + '">' + esc(c.icon) + '</span></td>' +
      '<td><input class="inline-select" style="width:64px" data-k="icon" value="' + esc(c.icon) + '" aria-label="آیکون"></td>' +
      '<td><input class="inline-select" style="width:170px" data-k="name" value="' + esc(c.name) + '" aria-label="نام"></td>' +
      '<td><input class="inline-select num" style="width:70px" type="number" min="0" max="360" data-k="hue" value="' + c.hue + '" aria-label="رنگ (۰ تا ۳۶۰)"></td>' +
      '<td><input class="inline-select" style="width:280px" data-k="subs" value="' + esc(c.subs.join('، ')) + '" aria-label="زیردسته‌ها"></td>' +
      '<td class="num muted">' + fa(c.products) + '</td>' +
      '<td><div class="actions"><button class="btn btn-ghost btn-sm" type="button" data-save>ذخیره</button><button class="btn btn-danger btn-sm" type="button" data-del' + (c.products ? ' disabled title="این دسته کالا دارد"' : '') + '>حذف</button></div></td></tr>';
    view.innerHTML = head('دسته‌بندی‌ها', 'رنگ پس‌زمینه با عدد ۰ تا ۳۶۰ تعیین می‌شود (۰ قرمز، ۱۲۰ سبز، ۲۲۰ آبی)') +
      '<section class="panel pad stack"><b>افزودن دسته جدید</b><form id="catForm" class="form-grid three" novalidate>' +
        '<label class="field">شناسه انگلیسی (در آدرس صفحه)<input id="c_id" placeholder="مثلاً pets" style="direction:ltr"></label>' +
        '<label class="field">نام دسته<input id="c_name" placeholder="مثلاً حیوانات خانگی"></label>' +
        '<label class="field">آیکون (ایموجی)<input id="c_icon" placeholder="🐶"></label>' +
        '<label class="field">رنگ (۰ تا ۳۶۰)<input id="c_hue" type="number" min="0" max="360" value="160"></label>' +
        '<label class="field full">زیردسته‌ها (با ویرگول جدا کنید)<input id="c_subs" placeholder="غذای سگ، غذای گربه، اسباب‌بازی"></label>' +
        '<div><button class="btn btn-primary" type="submit">افزودن دسته</button></div></form></section>' +
      '<section class="panel" style="margin-top:16px"><div class="table-wrap"><table class="t"><thead><tr><th></th><th>آیکون</th><th>نام</th><th>رنگ</th><th>زیردسته‌ها</th><th class="num">کالا</th><th></th></tr></thead><tbody>' + CATS.map(row).join('') + '</tbody></table></div></section>';
    $('#catForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/categories', { id: $('#c_id').value, name: $('#c_name').value, icon: $('#c_icon').value, hue: Number($('#c_hue').value), subs: $('#c_subs').value });
        toast('دسته اضافه شد'); categories();
      } catch (ex) { toast(ex.message); }
    });
    $$('[data-cat]').forEach((tr) => {
      const id = tr.dataset.cat; const v = (k) => $('[data-k="' + k + '"]', tr).value;
      $('[data-save]', tr).addEventListener('click', async () => {
        try { await api('/api/admin/categories/' + encodeURIComponent(id), { name: v('name'), icon: v('icon'), hue: Number(v('hue')), subs: v('subs') }, 'PUT'); toast('دسته ذخیره شد'); categories(); } catch (ex) { toast(ex.message); }
      });
      $('[data-del]', tr).addEventListener('click', async () => {
        if (!(await confirmBox('دسته «' + v('name') + '» حذف می‌شود.'))) return;
        try { await api('/api/admin/categories/' + encodeURIComponent(id), null, 'DELETE'); toast('دسته حذف شد'); categories(); } catch (ex) { toast(ex.message); }
      });
    });
  }

  /* =====================================================================
     کدهای تخفیف
     ===================================================================== */
  async function coupons() {
    const list = (await api('/api/admin/coupons')).coupons;
    view.innerHTML = head('کدهای تخفیف', 'تخفیف به صورت درصدی از جمع کالاها و تا سقف مشخص حساب می‌شود') +
      '<section class="panel pad stack"><b>ساخت کد تخفیف</b><form id="cpForm" class="form-grid three" novalidate>' +
        '<label class="field">کد (حروف انگلیسی و عدد)<input id="cp_code" placeholder="YALDA20" style="direction:ltr;text-transform:uppercase"></label>' +
        '<label class="field">درصد تخفیف<input id="cp_pct" class="num" inputmode="numeric" placeholder="۲۰"></label>' +
        '<label class="field">سقف تخفیف (تومان)<input id="cp_cap" class="num" inputmode="numeric" placeholder="۵۰۰٬۰۰۰"></label>' +
        '<div><button class="btn btn-primary" type="submit">ساخت کد</button></div></form></section>' +
      '<section class="panel" style="margin-top:16px"><div class="table-wrap">' + (list.length ? '<table class="t"><thead><tr><th>کد</th><th class="num">درصد</th><th class="num">سقف</th><th class="num">دفعات استفاده</th><th>وضعیت</th><th></th></tr></thead><tbody>' +
        list.map((c) => '<tr class="' + (c.active ? '' : 'off') + '"><td class="num" style="direction:ltr;text-align:right"><b>' + esc(c.code) + '</b></td><td class="num">' + fa(c.pct) + '٪</td><td class="num">' + toman(c.cap) + '</td><td class="num">' + fa(c.uses) + '</td>' +
          '<td><label class="switch" style="justify-content:flex-start;gap:8px"><input type="checkbox" data-toggle="' + esc(c.code) + '"' + (c.active ? ' checked' : '') + '>' + (c.active ? 'فعال' : 'غیرفعال') + '</label></td>' +
          '<td><div class="actions"><button class="btn btn-danger btn-sm" type="button" data-del="' + esc(c.code) + '">حذف</button></div></td></tr>').join('') + '</tbody></table>'
        : '<div class="empty"><p>هنوز کد تخفیفی نساخته‌اید.</p></div>') + '</div></section>';
    $('#cpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/admin/coupons', { code: $('#cp_code').value, pct: num($('#cp_pct').value), cap: num($('#cp_cap').value) }); toast('کد تخفیف ساخته شد'); coupons(); } catch (ex) { toast(ex.message); }
    });
    $$('[data-toggle]').forEach((c) => c.addEventListener('change', async () => {
      try { await api('/api/admin/coupons/' + encodeURIComponent(c.dataset.toggle), { active: c.checked }, 'PUT'); coupons(); } catch (ex) { toast(ex.message); }
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('کد ' + b.dataset.del + ' حذف می‌شود.'))) return;
      try { await api('/api/admin/coupons/' + encodeURIComponent(b.dataset.del), null, 'DELETE'); toast('کد تخفیف حذف شد'); coupons(); } catch (ex) { toast(ex.message); }
    }));
  }

  /* =====================================================================
     دیدگاه‌ها
     ===================================================================== */
  async function reviews() {
    const list = (await api('/api/admin/reviews')).reviews;
    view.innerHTML = head('دیدگاه‌ها', 'دیدگاه‌های پنهان‌شده در صفحه کالا نمایش داده نمی‌شوند') +
      '<section class="panel"><div class="table-wrap">' + (list.length ? '<table class="t"><thead><tr><th>کالا</th><th>نویسنده</th><th class="num">امتیاز</th><th>متن</th><th>تاریخ</th><th>نمایش</th><th></th></tr></thead><tbody>' +
        list.map((r) => '<tr class="' + (r.approved ? '' : 'off') + '"><td class="title-cell"><b>' + esc(r.emoji) + ' ' + esc(r.product) + '</b></td>' +
          '<td>' + esc(r.name) + (r.buyer ? '<br><small style="color:var(--ok)">خریدار</small>' : '') + '</td><td class="num">' + fa(r.rate) + ' از ۵</td>' +
          '<td style="min-width:240px;max-width:420px">' + esc(r.text) + '</td><td class="num">' + date(r.createdAt) + '</td>' +
          '<td><label class="switch" style="justify-content:flex-start;gap:8px"><input type="checkbox" data-approve="' + r.id + '"' + (r.approved ? ' checked' : '') + '>' + (r.approved ? 'نمایش' : 'پنهان') + '</label></td>' +
          '<td><div class="actions"><button class="btn btn-danger btn-sm" type="button" data-del="' + r.id + '">حذف</button></div></td></tr>').join('') + '</tbody></table>'
        : '<div class="empty"><p>هنوز دیدگاهی ثبت نشده است.</p></div>') + '</div></section>';
    $$('[data-approve]').forEach((c) => c.addEventListener('change', async () => {
      try { await api('/api/admin/reviews/' + c.dataset.approve, { approved: c.checked }, 'PUT'); reviews(); } catch (ex) { toast(ex.message); }
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox('این دیدگاه برای همیشه حذف می‌شود.'))) return;
      try { await api('/api/admin/reviews/' + b.dataset.del, null, 'DELETE'); toast('دیدگاه حذف شد'); reviews(); } catch (ex) { toast(ex.message); }
    }));
  }

  /* =====================================================================
     مشتریان
     ===================================================================== */
  async function users() {
    const list = (await api('/api/admin/users')).users;
    view.innerHTML = head('مشتریان', fa(list.length) + ' مشتری ثبت‌نام کرده‌اند') +
      '<section class="panel"><div class="table-wrap">' + (list.length ? '<table class="t"><thead><tr><th>موبایل</th><th>نام</th><th class="num">تعداد سفارش</th><th class="num">مجموع خرید</th><th>تاریخ عضویت</th></tr></thead><tbody>' +
        list.map((u) => '<tr><td class="num">' + fd(u.phone) + '</td><td>' + (u.name ? esc(u.name) : '<span class="muted">—</span>') + '</td><td class="num">' + fa(u.orders) + '</td><td class="num">' + toman(u.spent) + '</td><td class="num">' + date(u.createdAt) + '</td></tr>').join('') +
        '</tbody></table>' : '<div class="empty"><p>هنوز مشتری‌ای ثبت‌نام نکرده است.</p></div>') + '</div></section>';
  }

  /* =====================================================================
     تنظیمات فروشگاه
     ===================================================================== */
  async function settings() {
    const r = await api('/api/admin/settings');
    const s = r.settings; INTEG = r.integrations;
    const PM = {
      live: ['فعال (پرداخت واقعی)', 'ok', 'درگاه زرین‌پال با مرچنت کد شما فعال است.'],
      sandbox: ['حالت آزمایشی زرین‌پال', 'warn', 'برای پرداخت واقعی، در فایل <code>.env</code> مقدار <code>ZARINPAL_SANDBOX=false</code> را تنظیم کنید.'],
      fake: ['شبیه‌ساز داخلی (توسعه)', 'warn', 'برای اتصال درگاه، مرچنت کد زرین‌پال را در فایل <code>.env</code> با نام <code>ZARINPAL_MERCHANT_ID</code> وارد کنید و سرور را دوباره اجرا کنید.'],
      off: ['غیرفعال', 'bad', 'فقط پرداخت در محل فعال است. مرچنت کد زرین‌پال را در <code>ZARINPAL_MERCHANT_ID</code> وارد کنید.']
    }[INTEG.paymentMode];
    view.innerHTML = head('تنظیمات فروشگاه', 'تغییرات بلافاصله روی سایت اعمال می‌شوند') + '<div class="stack">' + devBanner() +
      '<form id="setForm" class="panel pad stack" novalidate>' +
        '<b>اطلاعات و ظاهر</b><div class="form-grid">' +
          '<label class="field">نام فروشگاه<input id="s_name" value="' + esc(s.storeName) + '" maxlength="30"></label>' +
          '<label class="field">تلفن پشتیبانی<input id="s_phone" value="' + esc(s.phone) + '" maxlength="40"></label>' +
          '<label class="field">رنگ اصلی (دکمه‌ها و لوگو)<span class="row-inline"><input type="color" id="s_brand" value="' + esc(s.brandColor) + '"><input type="text" id="s_brandHex" value="' + esc(s.brandColor) + '" style="direction:ltr" aria-label="کد رنگ اصلی"></span></label>' +
          '<label class="field">رنگ مکمل (برچسب‌ها و پیشنهاد شگفت‌انگیز)<span class="row-inline"><input type="color" id="s_accent" value="' + esc(s.accentColor) + '"><input type="text" id="s_accentHex" value="' + esc(s.accentColor) + '" style="direction:ltr" aria-label="کد رنگ مکمل"></span></label>' +
        '</div>' +
        '<div class="swatches"><span class="hint">پیش‌نمایش:</span><button type="button" class="preview-btn" id="pvBtn">افزودن به سبد خرید</button><span class="preview-tag" id="pvTag">جدید</span><button type="button" class="link-btn" id="resetColors">بازگشت به رنگ‌های پیش‌فرض</button></div>' +
        '<b>ارسال و سفارش</b><div class="form-grid">' +
          '<label class="field">حداقل خرید برای ارسال رایگان (تومان)<input id="s_free" class="num" inputmode="numeric" value="' + fa(s.freeShip) + '"></label>' +
          '<label class="field">هزینه ارسال عادی (تومان)<input id="s_normal" class="num" inputmode="numeric" value="' + fa(s.shipNormal) + '"></label>' +
          '<label class="field">هزینه ارسال اکسپرس (تومان)<input id="s_express" class="num" inputmode="numeric" value="' + fa(s.shipExpress) + '"></label>' +
          '<label class="field">حداکثر تعداد هر کالا در یک سفارش<input id="s_max" class="num" inputmode="numeric" value="' + fa(s.maxPerItem) + '"></label>' +
        '</div>' +
        '<span class="err" id="sErr" role="alert"></span>' +
        '<div><button class="btn btn-primary" type="submit" id="sSave">ذخیره تنظیمات</button></div>' +
      '</form>' +
      '<section class="panel pad stack"><b>اتصال سرویس‌ها</b><div class="integ">' +
        '<div class="item"><div style="flex:1"><b>درگاه پرداخت زرین‌پال</b> ' + pill0(PM[0], PM[1]) + '<p>' + PM[2] + '</p></div></div>' +
        '<div class="item"><div style="flex:1"><b>پیامک کد ورود (کاوه‌نگار)</b> ' + (INTEG.sms ? pill0('فعال', 'ok') : pill0('غیرفعال', 'warn')) +
          '<p>' + (INTEG.sms ? 'کد ورود با پیامک برای مشتری ارسال می‌شود.' : 'کلید API کاوه‌نگار را در <code>KAVENEGAR_API_KEY</code> و نام قالب پیامک را در <code>KAVENEGAR_TEMPLATE</code> وارد کنید. تا آن زمان کد ورود در کنسول سرور چاپ می‌شود.') + '</p></div></div>' +
      '</div></section></div>';

    const pair = (picker, text) => {
      picker.addEventListener('input', () => { text.value = picker.value; preview(); });
      text.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) { picker.value = text.value; preview(); } });
    };
    const preview = () => {
      $('#pvBtn').style.background = $('#s_brand').value;
      $('#pvTag').style.background = $('#s_accent').value;
      $('#pvTag').style.color = '#3d2a00';
    };
    pair($('#s_brand'), $('#s_brandHex')); pair($('#s_accent'), $('#s_accentHex')); preview();
    $('#resetColors').addEventListener('click', () => {
      $('#s_brand').value = $('#s_brandHex').value = '#f2613f';
      $('#s_accent').value = $('#s_accentHex').value = '#ffc83d';
      preview();
    });
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#sSave'); btn.disabled = true; $('#sErr').textContent = '';
      try {
        const out = await api('/api/admin/settings', {
          storeName: $('#s_name').value, phone: $('#s_phone').value, brandColor: $('#s_brandHex').value.trim(), accentColor: $('#s_accentHex').value.trim(),
          freeShip: num($('#s_free').value), shipNormal: num($('#s_normal').value), shipExpress: num($('#s_express').value), maxPerItem: num($('#s_max').value)
        }, 'PUT');
        $$('[data-store-name]').forEach((el) => { el.textContent = out.settings.storeName; });
        toast('تنظیمات ذخیره شد و روی سایت اعمال شد');
      } catch (ex) { $('#sErr').textContent = ex.message; }
      btn.disabled = false;
    });
  }
  const pill0 = (label, kind) => '<span class="pill ' + kind + '">' + label + '</span>';

  const PAGE_FN = { dashboard, products, orders, categories, coupons, reviews, users, settings };

  /* ---------- شروع ---------- */
  (async function boot() {
    let ok = false;
    try {
      const r = await fetch('/api/settings', { headers: { accept: 'application/json' } });
      if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
        ok = true;
        const s = await r.json();
        $$('[data-store-name]').forEach((el) => { el.textContent = s.storeName; });
      }
    } catch (e) { /* سرور در دسترس نیست */ }
    if (!ok) { $('#noServer').hidden = false; return; }
    if (!tok.get()) { showLogin(); return; }
    try { await enter(); } catch (e) { showLogin(); }
  })();
})();
