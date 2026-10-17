/* کالانو — منطق فروشگاه (جاوااسکریپت خالص، بدون فریم‌ورک)
   مسیریابی با hash، سبد خرید و سفارش‌ها در localStorage ذخیره می‌شوند. */
(function () {
  'use strict';

  const { categories, products, slides } = window.SHOP;
  const DEFAULTS = window.SHOP.settings;
  const DEMO_COUPONS = window.SHOP.coupons;   // فقط در حالت نمایشی (بدون سرور)
  const DEMO_OTP = '12345';
  const API = { on: false };                   // وقتی سایت با سرور اجرا شود true می‌شود
  let CFG = Object.assign({}, DEFAULTS, { features: {} });
  let FREE_SHIP, SHIP_NORMAL, SHIP_EXPRESS, MAX_PER_ITEM;
  const N = () => esc(CFG.storeName);   // نام فروشگاه برای درج در HTML

  /* ---------- ابزارها ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const fd = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);   // فقط تبدیل رقم‌ها، بدون جداکننده (برای تلفن و کد)
  const toEn = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const norm = (s) => toEn(String(s)).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const final = (p) => p.off ? Math.round(p.price * (1 - p.off / 100) / 1000) * 1000 : p.price;
  const byId = (id) => products.find((p) => p.id === Number(id));
  const catOf = (id) => categories.find((c) => c.id === id);
  const hueOf = (p) => (catOf(p.cat) || { hue: 160 }).hue;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('kalano.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kalano.' + k, JSON.stringify(v)); } catch (e) { /* حافظه در دسترس نیست */ } }
  };

  const S = {
    cart: store.get('cart', []),           // [{id, color, qty}]
    wish: store.get('wish', []),           // [id]
    user: store.get('user', null),         // {phone, name}
    orders: store.get('orders', []),
    reviews: store.get('reviews', {}),     // {id: [review]}
    recent: store.get('recent', []),
    coupon: null,
    ship: 'normal',
    pay: 'online',
    co: store.get('address', {})
  };
  const save = (k) => store.set(k, S[k]);

  /* ---------- آیکون‌ها ---------- */
  const ICON = {
    search: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.3-4.3"/>',
    cart: '<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9Z"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    filter: '<path d="M4 5h16l-6 8v5l-4 2v-7Z"/>',
    store: '<path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
  };
  const ic = (n, fill) => '<svg viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>';
  $$('[data-ic]').forEach((el) => { el.innerHTML = ic(el.dataset.ic); });

  /* ---------- قطعات مشترک ---------- */
  const stars = (r) => '<span class="stars num">' + ic('star') + fa(r.toFixed(1)) + '</span>';
  const tome = '<small>تومان</small>';

  function priceBlock(p) {
    if (!p.stock) return '<span class="out">ناموجود</span>';
    return (p.off ? '<span class="off-badge num">' + fa(p.off) + '٪</span>' : '') +
      '<span class="price"><span class="now num">' + fa(final(p)) + tome + '</span>' +
      (p.off ? '<span class="was num">' + fa(p.price) + '</span>' : '') + '</span>';
  }

  function thumb(p, cls) {
    return '<div class="' + (cls || 'thumb') + '" style="--h:' + hueOf(p) + '">' +
      (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy">' : '<span aria-hidden="true">' + p.emoji + '</span>') + '</div>';
  }

  function card(p) {
    const w = S.wish.includes(p.id);
    return '<article class="card">' +
      '<a href="#/p/' + p.id + '" data-go="p/' + p.id + '" aria-label="' + esc(p.title) + '">' + thumb(p) + '</a>' +
      '<button class="wish' + (w ? ' on' : '') + '" type="button" data-wish="' + p.id + '" aria-label="افزودن به علاقه‌مندی‌ها" aria-pressed="' + w + '">' + ic('heart', w) + '</button>' +
      (p.stock && p.age <= 30 ? '<span class="tag-new">جدید</span>' : '') +
      '<a class="title" href="#/p/' + p.id + '" data-go="p/' + p.id + '">' + esc(p.title) + '</a>' +
      '<div class="meta"><span>' + esc(p.brand) + '</span>' + (p.reviews ? stars(p.rating) : '<span class="no-rate">بدون امتیاز</span>') + '</div>' +
      (p.stock > 0 && p.stock <= 5 ? '<span class="stock-low num">تنها ' + fa(p.stock) + ' عدد در انبار باقی مانده</span>' : '') +
      '<div class="price-row">' + priceBlock(p) + '</div>' +
      '</article>';
  }

  function toast(msg, action) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span>' + msg + '</span>' + (action ? '<a href="#/' + action.go + '" data-go="' + action.go + '">' + action.label + '</a>' : '');
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function updateBadges() {
    const n = S.cart.reduce((a, l) => a + l.qty, 0);
    $('#cartBadge').textContent = n ? fa(n) : '';
    $('#cartBadge2').textContent = n ? fa(n) : '';
    $('#wishBadge').textContent = S.wish.length ? fa(S.wish.length) : '';
    $('#accTxt').textContent = S.user ? (S.user.name || 'حساب کاربری') : 'ورود | ثبت‌نام';
  }

  /* ---------- سبد خرید ---------- */
  const lineKey = (l) => l.id + '|' + l.color;
  function addToCart(id, color) {
    const p = byId(id);
    if (!p || !p.stock) return;
    color = color || 0;
    const l = S.cart.find((x) => x.id === p.id && x.color === color);
    const max = Math.min(p.stock, MAX_PER_ITEM);
    if (l) {
      if (l.qty >= max) { toast('حداکثر تعداد قابل سفارش این کالا ' + fa(max) + ' عدد است'); return; }
      l.qty++;
    } else S.cart.push({ id: p.id, color: color, qty: 1 });
    save('cart'); updateBadges();
    toast('به سبد خرید اضافه شد', { go: 'cart', label: 'مشاهده سبد' });
  }
  function changeQty(key, d) {
    const i = S.cart.findIndex((l) => lineKey(l) === key);
    if (i < 0) return;
    const l = S.cart[i]; const p = byId(l.id);
    const max = Math.min(p.stock, MAX_PER_ITEM);
    l.qty += d;
    if (l.qty > max) { l.qty = max; toast('حداکثر تعداد قابل سفارش این کالا ' + fa(max) + ' عدد است'); }
    if (l.qty <= 0) S.cart.splice(i, 1);
    save('cart'); updateBadges();
  }
  function cartLines() { return S.cart.map((l) => ({ l: l, p: byId(l.id) })).filter((x) => x.p); }
  function totals() {
    const lines = cartLines();
    const list = lines.reduce((a, x) => a + x.p.price * x.l.qty, 0);
    const payable = lines.reduce((a, x) => a + final(x.p) * x.l.qty, 0);
    const coupon = S.coupon ? Math.min(Math.round(payable * S.coupon.pct / 100 / 1000) * 1000, S.coupon.cap) : 0;
    const ship = !lines.length ? 0 : S.ship === 'express' ? SHIP_EXPRESS : (payable >= FREE_SHIP ? 0 : SHIP_NORMAL);
    return { lines, count: lines.reduce((a, x) => a + x.l.qty, 0), list, payable, itemDisc: list - payable, coupon, ship, total: payable - coupon + ship };
  }
  function toggleWish(id) {
    id = Number(id);
    const i = S.wish.indexOf(id);
    if (i >= 0) { S.wish.splice(i, 1); toast('از علاقه‌مندی‌ها حذف شد'); } else { S.wish.push(id); toast('به علاقه‌مندی‌ها اضافه شد', { go: 'wish', label: 'مشاهده' }); }
    save('wish'); updateBadges();
    $$('[data-wish="' + id + '"]').forEach((b) => { const on = S.wish.includes(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.innerHTML = ic('heart', on); });
  }

  /* ---------- مسیریابی ---------- */
  let current = null;
  let timers = [];
  const app = $('#app');

  function parseHash() { try { return decodeURIComponent(location.hash.replace(/^#\/?/, '')); } catch (e) { return ''; } }
  function go(path) {
    render(path);
    try { if (parseHash() !== path) location.hash = '/' + path; } catch (e) { /* محیط بدون hash */ }
  }
  window.addEventListener('hashchange', () => { const p = parseHash(); if (p !== current) render(p); });

  function render(path, keepScroll) {
    current = path;
    timers.forEach(clearInterval); timers = [];
    closeMega(); hideSuggest(); document.body.style.overflow = '';
    if (!path.startsWith('s/')) qInput.value = '';
    const [head, ...rest] = path.split('/');
    const arg = rest.join('/');
    let html, title = 'فروشگاه ' + CFG.storeName;
    switch (head) {
      case '': html = homeView(); break;
      case 'cats': html = catsView(); title = 'دسته‌بندی کالاها'; break;
      case 'c': { const c = catOf(arg); if (!c) { html = notFound(); break; } html = listing(path, { title: c.name, base: products.filter((p) => p.cat === c.id), lockCat: true, crumbs: [[c.name]] }); title = c.name; break; }
      case 's': { const q = norm(arg); qInput.value = arg; html = listing(path, { title: 'نتایج جستجو برای «' + esc(arg) + '»', base: search(q), crumbs: [['جستجو']], sort: 'rel' }); title = 'جستجو: ' + arg; break; }
      case 'brand': html = listing(path, { title: 'محصولات ' + esc(arg), base: products.filter((p) => p.brand === arg), crumbs: [['برند ' + esc(arg)]] }); title = arg; break;
      case 'offers': html = listing(path, { title: 'پیشنهاد شگفت‌انگیز', base: products.filter((p) => p.off >= 10), crumbs: [['پیشنهاد شگفت‌انگیز']], sort: 'off' }); title = 'پیشنهاد شگفت‌انگیز'; break;
      case 'best': html = listing(path, { title: 'پرفروش‌ترین‌ها', base: products.slice(), crumbs: [['پرفروش‌ترین‌ها']], sort: 'best' }); title = 'پرفروش‌ترین‌ها'; break;
      case 'new': html = listing(path, { title: 'جدیدترین‌ها', base: products.slice(), crumbs: [['جدیدترین‌ها']], sort: 'new' }); title = 'جدیدترین‌ها'; break;
      case 'p': { const p = byId(arg); if (!p) { html = notFound(); break; } html = productView(p); title = p.title; break; }
      case 'cart': html = cartView(); title = 'سبد خرید'; break;
      case 'checkout': html = checkoutView(); title = 'تکمیل سفارش'; break;
      case 'done': html = doneView(arg); title = 'سفارش ثبت شد'; break;
      case 'wish': html = wishView(); title = 'علاقه‌مندی‌ها'; break;
      case 'account': html = accountView(); title = CFG.storeName + 'ی من'; break;
      default: html = notFound();
    }
    app.innerHTML = html;
    document.title = title === 'فروشگاه ' + CFG.storeName ? title : title + ' | ' + CFG.storeName;
    $$('.bottom-nav a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (['cats', 'cart', 'account'].includes(head) ? head : (head === '' ? '' : null))));
    if (!keepScroll) window.scrollTo(0, 0);
    after(head);
  }

  function after(head) {
    if (head === '') startHero();
    if ($('.countdown')) { tick(); timers.push(setInterval(tick, 1000)); }
  }

  function notFound() {
    return '<div class="wrap"><div class="empty"><div class="big">🔍</div><h3>صفحه‌ای که دنبالش بودید پیدا نشد</h3><p>ممکن است آدرس اشتباه باشد یا کالا حذف شده باشد.</p><a class="btn btn-primary" href="#/" data-go="">بازگشت به صفحه اصلی</a></div></div>';
  }

  /* ---------- صفحه اصلی ---------- */
  function homeView() {
    const offers = products.filter((p) => p.off >= 12 && p.stock).sort((a, b) => b.off - a.off).slice(0, 10);
    const best = products.filter((p) => p.stock).sort((a, b) => b.sold - a.sold).slice(0, 12);
    const fresh = products.slice().sort((a, b) => a.age - b.age).slice(0, 12);
    const recent = S.recent.map(byId).filter(Boolean).slice(0, 10);
    const brands = Array.from(new Set(products.map((p) => p.brand))).filter((b) => !b.startsWith('کالانو')).slice(0, 12);

    return '<div class="wrap">' +
      '<section class="hero" aria-roledescription="carousel">' +
        slides.map((s, i) => '<div class="slide' + (i ? '' : ' on') + '" style="--h:' + s.hue + '">' +
          '<div><h1>' + s.title + '</h1><p>' + s.text + '</p><a class="btn btn-primary" href="#/' + s.go + '" data-go="' + s.go + '">' + s.cta + '</a></div>' +
          '<div class="art" aria-hidden="true">' + s.emoji + '</div></div>').join('') +
        '<div class="hero-dots">' + slides.map((s, i) => '<button type="button" data-slide="' + i + '" class="' + (i ? '' : 'on') + '" aria-label="اسلاید ' + fa(i + 1) + '"></button>').join('') + '</div>' +
        '<div class="hero-arrows"><button type="button" data-slide-step="1" aria-label="اسلاید بعد">' + ic('right') + '</button><button type="button" data-slide-step="-1" aria-label="اسلاید قبل">' + ic('left') + '</button></div>' +
      '</section>' +

      '<section class="services" aria-label="مزایای خرید">' +
        [['truck', 'ارسال سریع', 'تحویل اکسپرس در تهران'], ['shield', 'ضمانت اصالت', 'تضمین اصل بودن کالا'], ['refresh', '۷ روز بازگشت', 'بدون پرسش و هزینه'], ['cash', 'پرداخت در محل', 'نقدی یا کارتخوان'], ['headset', 'پشتیبانی ۲۴ ساعته', 'هر روز هفته']]
          .map((s) => '<div class="service"><span class="ic">' + ic(s[0]) + '</span><div><b>' + s[1] + '</b><span>' + s[2] + '</span></div></div>').join('') +
      '</section>' +

      '<section class="offers" aria-label="پیشنهاد شگفت‌انگیز">' +
        '<div class="offers-intro"><h2>پیشنهاد<br>شگفت‌انگیز</h2><span class="pct" aria-hidden="true">٪</span><div class="countdown num" aria-label="زمان باقی‌مانده"></div><a href="#/offers" data-go="offers">مشاهده همه ←</a></div>' +
        '<div class="rail">' + offers.map(card).join('') + '<a class="more-card" href="#/offers" data-go="offers">مشاهده همه<br>پیشنهادها ←</a></div>' +
      '</section>' +

      '<section class="section"><div class="sec-head"><h2>خرید بر اساس دسته‌بندی</h2></div><div class="cats">' +
        categories.map((c) => '<a class="cat" href="#/c/' + c.id + '" data-go="c/' + c.id + '"><span class="circle" style="--h:' + c.hue + '" aria-hidden="true">' + c.icon + '</span>' + c.name + '</a>').join('') +
      '</div></section>' +

      '<section class="banners">' +
        '<a class="banner" style="--h:45" href="#/c/market" data-go="c/market"><div><h3>زعفران و خشکبار ایرانی</h3><p>پسته رفسنجان و زعفران قائنات با ضمانت تازگی</p><span class="go">خرید از سوپرمارکت ←</span></div><span class="art" aria-hidden="true">🌸</span></a>' +
        '<a class="banner" style="--h:150" href="#/c/sport" data-go="c/sport"><div><h3>آماده سفر پاییزی</h3><p>چمدان، کیسه خواب و تجهیزات کوهنوردی</p><span class="go">ورزش و سفر ←</span></div><span class="art" aria-hidden="true">🏕️</span></a>' +
      '</section>' +

      '<section class="section"><div class="sec-head"><h2>پرفروش‌ترین کالاها</h2><a href="#/best" data-go="best">مشاهده همه ←</a></div><div class="rail plain">' + best.map(card).join('') + '</div></section>' +

      (recent.length ? '<section class="section"><div class="sec-head"><h2>بازدیدهای اخیر شما</h2></div><div class="rail plain">' + recent.map(card).join('') + '</div></section>' : '') +

      '<section class="section"><div class="sec-head"><h2>تازه‌های ' + N() + '</h2><a href="#/new" data-go="new">مشاهده همه ←</a></div><div class="grid">' + fresh.map(card).join('') + '</div></section>' +

      '<section class="section"><div class="sec-head"><h2>محبوب‌ترین برندها</h2></div><div class="brands">' +
        brands.map((b) => '<a class="brand-chip" href="#/brand/' + encodeURIComponent(b) + '" data-go="brand/' + esc(b) + '">' + esc(b) + '</a>').join('') +
      '</div></section>' +
    '</div>';
  }

  let slideIdx = 0;
  function showSlide(i) {
    const s = $$('.slide'); if (!s.length) return;
    slideIdx = (i + s.length) % s.length;
    s.forEach((el, j) => el.classList.toggle('on', j === slideIdx));
    $$('.hero-dots button').forEach((el, j) => el.classList.toggle('on', j === slideIdx));
  }
  function startHero() {
    slideIdx = 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timers.push(setInterval(() => showSlide(slideIdx + 1), 5500));
  }

  function tick() {
    const now = new Date(); const end = new Date(now); end.setHours(24, 0, 0, 0);
    let s = Math.max(0, Math.floor((end - now) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60;
    const pad = (n) => fd(String(n).padStart(2, '0'));
    $$('.countdown').forEach((el) => { el.innerHTML = '<span>' + pad(h) + '</span>:<span>' + pad(m) + '</span>:<span>' + pad(s) + '</span>'; });
  }

  function catsView() {
    return '<div class="wrap"><div class="list-title" style="margin-top:16px"><h1>دسته‌بندی کالاها</h1></div><div class="panel" style="padding:6px 16px">' +
      categories.map((c) => '<div style="padding:14px 0;border-bottom:1px solid var(--line)"><a href="#/c/' + c.id + '" data-go="c/' + c.id + '" style="display:flex;align-items:center;gap:12px;font-weight:700">' +
        '<span class="circle" style="--h:' + c.hue + ';width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:hsl(var(--h) var(--tile-s) var(--tile-l))">' + c.icon + '</span>' + c.name +
        '<span style="margin-inline-start:auto;color:var(--brand);font-size:12px">همه کالاها ←</span></a>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">' + c.subs.map((s) => '<a href="#/c/' + c.id + '" data-go="c/' + c.id + '" style="font-size:12px;padding:4px 10px;border-radius:20px;background:var(--sunken);color:var(--muted)">' + s + '</a>').join('') + '</div></div>').join('') +
      '</div></div>';
  }

  /* ---------- جستجو ---------- */
  function search(q) {
    if (!q) return [];
    const words = q.split(' ');
    return products
      .map((p) => {
        const hay = norm(p.title + ' ' + p.brand + ' ' + catOf(p.cat).name + ' ' + Object.values(p.specs).join(' '));
        const hits = words.filter((w) => hay.includes(w)).length;
        const t = norm(p.title).includes(q) ? 3 : 0;
        return { p, score: hits === words.length ? hits + t : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.p.sold - a.p.sold)
      .map((x) => x.p);
  }

  const qInput = $('#q'); const sug = $('#suggest');
  let sugIdx = -1;
  function hideSuggest() { sug.hidden = true; sugIdx = -1; }
  function showSuggest() {
    const raw = qInput.value.trim(); const q = norm(raw);
    if (!q) {
      const popular = ['هدفون', 'سامسونگ', 'زعفران', 'لپ‌تاپ', 'کتاب'];
      sug.innerHTML = '<div class="s-label">جستجوهای پرطرفدار</div>' + popular.map((w) => '<a href="#/s/' + w + '" data-go="s/' + w + '"><span class="s-emo" style="background:var(--sunken)">' + ic('search') + '</span><span class="s-title">' + w + '</span></a>').join('');
      sug.hidden = false; return;
    }
    const res = search(q).slice(0, 6);
    const cats = categories.filter((c) => norm(c.name).includes(q)).slice(0, 2);
    let html = '';
    if (cats.length) html += '<div class="s-label">دسته‌بندی‌ها</div>' + cats.map((c) => '<a href="#/c/' + c.id + '" data-go="c/' + c.id + '"><span class="s-emo" style="background:hsl(' + c.hue + ' var(--tile-s) var(--tile-l))">' + c.icon + '</span><span class="s-title">' + c.name + '</span></a>').join('');
    if (res.length) html += '<div class="s-label">کالاها</div>' + res.map((p) => '<a href="#/p/' + p.id + '" data-go="p/' + p.id + '"><span class="s-emo" style="background:hsl(' + hueOf(p) + ' var(--tile-s) var(--tile-l))">' + p.emoji + '</span><span class="s-title">' + esc(p.title) + '</span></a>').join('');
    html += '<a href="#/s/' + encodeURIComponent(raw) + '" data-go="s/' + esc(raw) + '"><span class="s-emo" style="background:var(--sunken)">' + ic('search') + '</span><span class="s-title">مشاهده همه نتایج برای «' + esc(raw) + '»</span></a>';
    sug.innerHTML = html; sug.hidden = false; sugIdx = -1;
  }
  qInput.addEventListener('focus', showSuggest);
  qInput.addEventListener('input', showSuggest);
  qInput.addEventListener('keydown', (e) => {
    const items = $$('a', sug);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.classList.toggle('active', i === sugIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sugIdx >= 0 && items[sugIdx]) { go(items[sugIdx].dataset.go); }
      else if (qInput.value.trim()) go('s/' + qInput.value.trim());
      qInput.blur();
    } else if (e.key === 'Escape') { hideSuggest(); qInput.blur(); }
  });

  /* ---------- لیست کالاها و فیلترها ---------- */
  let L = null;
  const SORTS = [['rel', 'مرتبط‌ترین'], ['best', 'پرفروش‌ترین'], ['new', 'جدیدترین'], ['cheap', 'ارزان‌ترین'], ['exp', 'گران‌ترین'], ['off', 'بیشترین تخفیف'], ['rate', 'محبوب‌ترین']];

  function listing(key, cfg) {
    if (!L || L.key !== key) {
      L = { key, cfg, sort: cfg.sort || 'rel', cats: new Set(), brands: new Set(), min: '', max: '', avail: false, disc: false, drawer: false };
    }
    return listingHTML();
  }

  function applyFilters(skipBrand) {
    return L.cfg.base.filter((p) =>
      (!L.cats.size || L.cats.has(p.cat)) &&
      (skipBrand || !L.brands.size || L.brands.has(p.brand)) &&
      (L.min === '' || final(p) >= Number(L.min)) &&
      (L.max === '' || final(p) <= Number(L.max)) &&
      (!L.avail || p.stock > 0) &&
      (!L.disc || p.off > 0));
  }

  function sorted(list) {
    const f = {
      rel: (a, b) => 0, best: (a, b) => b.sold - a.sold, new: (a, b) => a.age - b.age, cheap: (a, b) => final(a) - final(b),
      exp: (a, b) => final(b) - final(a), off: (a, b) => b.off - a.off, rate: (a, b) => b.rating - a.rating || b.reviews - a.reviews
    }[L.sort];
    const relDefault = L.sort === 'rel' && L.cfg.sort !== 'rel' ? (a, b) => b.sold * b.rating - a.sold * a.rating : f;
    return list.slice().sort((a, b) => (b.stock > 0) - (a.stock > 0) || relDefault(a, b));
  }

  function listingHTML() {
    const cfg = L.cfg;
    const list = sorted(applyFilters());
    const forBrands = applyFilters(true);
    const brandCount = {};
    forBrands.forEach((p) => { brandCount[p.brand] = (brandCount[p.brand] || 0) + 1; });
    L.brands.forEach((b) => { if (!(b in brandCount)) brandCount[b] = 0; });
    const catsIn = Array.from(new Set(cfg.base.map((p) => p.cat))).map(catOf);
    const active = L.cats.size + L.brands.size + (L.min !== '' ? 1 : 0) + (L.max !== '' ? 1 : 0) + L.avail + L.disc;

    if (!cfg.base.length) {
      return '<div class="wrap"><div class="crumbs"><a href="#/" data-go="">' + N() + '</a> / ' + cfg.crumbs.map((c) => c[0]).join(' / ') + '</div>' +
        '<div class="empty panel"><div class="big">🔎</div><h3>کالایی با این مشخصات پیدا نکردیم</h3><p>املای کلمه را بررسی کنید یا از کلمات عمومی‌تر استفاده کنید.</p><a class="btn btn-primary" href="#/" data-go="">بازگشت به صفحه اصلی</a></div></div>';
    }

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/" data-go="">' + N() + '</a><span>/</span>' + cfg.crumbs.map((c) => '<span>' + c[0] + '</span>').join('<span>/</span>') + '</div>' +
      '<div class="list-title"><h1>' + cfg.title + '</h1></div>' +
      '<div class="listing">' +
        '<aside class="filters panel' + (L.drawer ? ' open' : '') + '" aria-label="فیلترها">' +
          '<h3>فیلترها' + (active ? ' <button type="button" data-clear>حذف فیلترها (' + fa(active) + ')</button>' : '') + '</h3>' +
          (!cfg.lockCat && catsIn.length > 1 ? '<div class="f-group"><b>دسته‌بندی</b>' + catsIn.map((c) => '<label><input type="checkbox" data-f="cat" value="' + c.id + '"' + (L.cats.has(c.id) ? ' checked' : '') + '>' + c.name + '</label>').join('') + '</div>' : '') +
          '<div class="f-group"><b>برند</b>' + Object.keys(brandCount).sort((a, b) => brandCount[b] - brandCount[a]).map((b) => '<label><input type="checkbox" data-f="brand" value="' + esc(b) + '"' + (L.brands.has(b) ? ' checked' : '') + '>' + esc(b) + '<span class="count num">' + fa(brandCount[b]) + '</span></label>').join('') + '</div>' +
          '<div class="f-group"><b>محدوده قیمت (تومان)</b><div class="price-inputs">' +
            '<label class="field">از<input id="fMin" class="num" inputmode="numeric" data-f="min" value="' + (L.min !== '' ? fa(L.min) : '') + '" placeholder="۰"></label>' +
            '<label class="field">تا<input id="fMax" class="num" inputmode="numeric" data-f="max" value="' + (L.max !== '' ? fa(L.max) : '') + '" placeholder="هر قیمتی"></label></div></div>' +
          '<div class="f-group"><label class="switch">فقط کالاهای موجود<input id="fAvail" type="checkbox" data-f="avail"' + (L.avail ? ' checked' : '') + '></label>' +
          '<label class="switch">فقط کالاهای تخفیف‌دار<input id="fDisc" type="checkbox" data-f="disc"' + (L.disc ? ' checked' : '') + '></label></div>' +
          '<div class="f-apply"><button class="btn btn-primary btn-block" type="button" data-drawer="0">مشاهده ' + fa(list.length) + ' کالا</button></div>' +
        '</aside>' +
        '<section style="min-width:0">' +
          '<div class="sortbar panel">' +
            '<button class="btn btn-ghost filter-toggle" type="button" data-drawer="1" style="height:36px;padding:0 12px">' + ic('filter').replace('<svg', '<svg width="16" height="16"') + 'فیلتر' + (active ? ' (' + fa(active) + ')' : '') + '</button>' +
            '<span class="lbl">مرتب‌سازی:</span>' +
            SORTS.map((s) => '<button type="button" data-sort="' + s[0] + '" class="' + (L.sort === s[0] ? 'on' : '') + '">' + s[1] + '</button>').join('') +
            '<span class="total num">' + fa(list.length) + ' کالا</span>' +
          '</div>' +
          (list.length ? '<div class="grid">' + list.map(card).join('') + '</div>'
            : '<div class="empty panel"><div class="big">🧐</div><h3>با این فیلترها کالایی پیدا نشد</h3><p>چند فیلتر را بردارید تا نتایج بیشتری ببینید.</p><button class="btn btn-ghost" type="button" data-clear>حذف همه فیلترها</button></div>') +
        '</section>' +
      '</div></div>';
  }
  function rerenderListing() { app.innerHTML = listingHTML(); }

  /* ---------- صفحه محصول ---------- */
  let pdp = { id: null, color: 0, view: 0, rate: 5 };
  function describe(p) {
    if (p.description) return p.description;
    const c = catOf(p.cat);
    const s = Object.entries(p.specs).slice(0, 3).map(([k, v]) => k + ' ' + v).join('، ');
    return p.title + ' از برند ' + p.brand + ' یکی از محبوب‌ترین کالاهای دسته ' + c.name + ' در ' + N() + ' است. ' +
      'از مهم‌ترین ویژگی‌های این محصول می‌توان به ' + s + ' اشاره کرد. ' +
      'این کالا با ضمانت اصالت و ۷ روز مهلت بازگشت عرضه می‌شود و تاکنون بیش از ' + fa(p.sold) + ' نفر آن را خریده‌اند.';
  }
  const RV = {};   // دیدگاه‌های دریافتی از سرور
  function allReviews(p) {
    if (!API.on) return (S.reviews[p.id] || []).concat(window.SHOP.reviews[p.id] || []);
    if (!RV[p.id]) {
      RV[p.id] = [];
      api('/api/products/' + p.id + '/reviews').then((r) => {
        RV[p.id] = r.reviews.map((x) => ({ name: x.name, rate: x.rate, text: x.text, buy: x.buyer, date: new Date(x.createdAt).toLocaleDateString('fa-IR') }));
        if (current === 'p/' + p.id && RV[p.id].length) render(current, true);
      }).catch(() => {});
    }
    return RV[p.id];
  }

  function productView(p) {
    if (pdp.id !== p.id) pdp = { id: p.id, color: 0, view: 0, rate: 5 };
    S.recent = [p.id].concat(S.recent.filter((x) => x !== p.id)).slice(0, 12); save('recent');
    const c = catOf(p.cat);
    const w = S.wish.includes(p.id);
    const revs = allReviews(p);
    const related = products.filter((x) => x.cat === p.cat && x.id !== p.id).sort((a, b) => b.sold - a.sold).slice(0, 10);
    const keySpecs = Object.entries(p.specs).slice(0, 4);
    const dist = [5, 4, 3, 2, 1].map((n) => { const base = { 5: .62, 4: .24, 3: .08, 2: .04, 1: .02 }[n]; return [n, Math.round(base * 100)]; });
    const hueShift = [0, 25, -25];

    return '<div class="wrap">' +
      '<div class="crumbs"><a href="#/" data-go="">' + N() + '</a><span>/</span><a href="#/c/' + c.id + '" data-go="c/' + c.id + '">' + c.name + '</a><span>/</span><a href="#/brand/' + encodeURIComponent(p.brand) + '" data-go="brand/' + esc(p.brand) + '">' + esc(p.brand) + '</a></div>' +
      '<div class="panel">' +
        '<div class="pdp">' +
          '<div class="gallery">' +
            '<div class="main" style="--h:' + (hueOf(p) + hueShift[pdp.view]) + '">' +
              '<button class="wish' + (w ? ' on' : '') + '" type="button" data-wish="' + p.id + '" aria-pressed="' + w + '" aria-label="افزودن به علاقه‌مندی‌ها">' + ic('heart', w) + '</button>' +
              (p.img ? '<img src="' + esc(p.img) + '" alt="">' : '<span aria-hidden="true">' + p.emoji + '</span>') + '</div>' +
            '<div class="thumbs">' + hueShift.map((h, i) => '<button type="button" data-view="' + i + '" class="' + (pdp.view === i ? 'on' : '') + '" style="--h:' + (hueOf(p) + h) + '" aria-label="تصویر ' + fa(i + 1) + '">' + p.emoji + '</button>').join('') + '</div>' +
          '</div>' +
          '<div class="pdp-info">' +
            '<a class="brandline" href="#/brand/' + encodeURIComponent(p.brand) + '" data-go="brand/' + esc(p.brand) + '">' + esc(p.brand) + '</a>' +
            '<h1>' + esc(p.title) + '</h1>' +
            '<div class="rateline">' + (p.reviews ? stars(p.rating) + '<span class="num">(' + fa(p.reviews + (S.reviews[p.id] || []).length) + ' امتیاز)</span>' : '<span class="no-rate">هنوز امتیازی ثبت نشده</span>') + '<a href="#" data-scroll="reviews">' + fa(revs.length) + ' دیدگاه</a><span class="num">' + fa(p.sold) + ' فروش موفق</span></div>' +
            (p.colors.length ? '<b style="font-size:14px">رنگ: ' + p.colors[pdp.color].name + '</b><div class="colors">' + p.colors.map((cl, i) => '<button type="button" class="color-opt' + (pdp.color === i ? ' on' : '') + '" data-color="' + i + '"><i style="background:' + cl.hex + '"></i>' + cl.name + '</button>').join('') + '</div>' : '') +
            '<b style="font-size:14px;display:block;margin-bottom:8px">ویژگی‌ها</b>' +
            '<ul class="key-specs">' + keySpecs.map(([k, v]) => '<li><span>' + k + '</span>' + v + '</li>').join('') + '</ul>' +
          '</div>' +
          buyBox(p) +
        '</div>' +
        '<div class="tabs" role="tablist"><a href="#" class="on" data-scroll="intro">معرفی</a><a href="#" data-scroll="specs">مشخصات</a><a href="#" data-scroll="reviews">دیدگاه‌ها <span class="num">(' + fa(revs.length) + ')</span></a></div>' +
        '<div class="tab-body" id="sec-intro"><h3>معرفی</h3><p>' + esc(describe(p)) + '</p></div>' +
        '<div class="tab-body" id="sec-specs" style="border-top:1px solid var(--line)"><h3>مشخصات</h3><div style="overflow-x:auto"><table class="specs-table"><tbody>' +
          '<tr><th>برند</th><td>' + esc(p.brand) + '</td></tr>' +
          Object.entries(p.specs).map(([k, v]) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>').join('') +
          (p.colors.length ? '<tr><th>رنگ‌های موجود</th><td>' + p.colors.map((x) => x.name).join('، ') + '</td></tr>' : '') +
        '</tbody></table></div></div>' +
        '<div class="tab-body" id="sec-reviews" style="border-top:1px solid var(--line)"><h3>امتیاز و دیدگاه کاربران</h3><div class="reviews">' +
          '<div class="review-sum"><div style="display:flex;align-items:baseline;gap:6px"><span class="avg num">' + fa(p.rating.toFixed(1)) + '</span><span style="color:var(--muted)">از ۵</span></div>' +
            '<div style="font-size:12px;color:var(--muted);margin:4px 0 12px" class="num">از مجموع ' + fa(p.reviews) + ' امتیاز</div>' +
            dist.map(([n, v]) => '<div class="bar-row num"><span>' + fa(n) + '</span><span class="bar"><i style="width:' + v + '%"></i></span><span>' + fa(v) + '٪</span></div>').join('') +
            '<form id="reviewForm" style="display:flex;flex-direction:column;gap:10px;margin-top:16px;border-top:1px solid var(--line);padding-top:14px">' +
              '<b style="font-size:13px">دیدگاه خود را بنویسید</b>' +
              '<div class="star-pick" role="radiogroup" aria-label="امتیاز">' + [5, 4, 3, 2, 1].map((n) => '<button type="button" data-rate="' + n + '" class="' + (n <= pdp.rate ? 'on' : '') + '" aria-label="' + fa(n) + ' ستاره">★</button>').join('') + '</div>' +
              '<label class="field">نام شما<input id="rvName" required maxlength="30" value="' + esc(S.user && S.user.name ? S.user.name : '') + '"></label>' +
              '<label class="field">متن دیدگاه<textarea id="rvText" rows="3" required minlength="10" maxlength="500" placeholder="نظر خود را درباره کیفیت، قیمت و کاربرد این کالا بنویسید"></textarea></label>' +
              '<button class="btn btn-ghost" type="submit">ثبت دیدگاه</button></form>' +
          '</div>' +
          '<div>' + (revs.length ? revs.map((r) => '<div class="review"><div class="r-head"><span class="r-rate num">' + fa(r.rate) + '</span><b style="color:var(--fg)">' + esc(r.name) + '</b><span class="num">' + esc(r.date) + '</span>' + (r.buy ? '<span class="buyer">خریدار این محصول</span>' : '') + '</div><p>' + esc(r.text) + '</p></div>').join('')
            : '<div class="empty" style="padding:24px"><h3>هنوز دیدگاهی ثبت نشده</h3><p>اولین نفری باشید که درباره این کالا نظر می‌دهد.</p></div>') + '</div>' +
        '</div></div>' +
      '</div>' +
      (related.length ? '<section class="section"><div class="sec-head"><h2>کالاهای مشابه</h2><a href="#/c/' + c.id + '" data-go="c/' + c.id + '">مشاهده همه ←</a></div><div class="rail plain">' + related.map(card).join('') + '</div></section>' : '') +
      mobileBuy(p) +
    '</div>';
  }

  function cartQtyFor(p) { const l = S.cart.find((x) => x.id === p.id && x.color === pdp.color); return l ? l.qty : 0; }

  function buyBox(p) {
    const q = cartQtyFor(p);
    return '<aside class="buybox" id="buybox">' +
      '<div class="seller"><span class="av">' + esc(CFG.storeName.charAt(0)) + '</span><div><b>فروشگاه ' + N() + '</b><div style="font-size:11px;color:var(--muted)">عملکرد عالی • ۹۸٪ رضایت خریداران</div></div></div>' +
      '<div class="perk">' + ic('shield') + 'گارانتی اصالت و سلامت فیزیکی کالا</div>' +
      '<div class="perk">' + ic('truck') + (p.stock ? 'موجود در انبار ' + N() + '، ارسال از امروز' : 'در حال حاضر موجود نیست') + '</div>' +
      '<div class="perk">' + ic('refresh') + '۷ روز ضمانت بازگشت کالا</div>' +
      (p.stock ? '<div class="bigprice">' + (p.off ? '<span class="off-badge num">' + fa(p.off) + '٪</span>' : '<span></span>') +
        '<div class="price"><span class="now num">' + fa(final(p)) + ' ' + tome + '</span>' + (p.off ? '<span class="was num">' + fa(p.price) + '</span>' : '') + '</div></div>' +
        (p.stock <= 5 ? '<span style="color:var(--danger);font-size:12px;font-weight:600" class="num">تنها ' + fa(p.stock) + ' عدد در انبار باقی مانده</span>' : '') +
        (q ? qtyCtl(p.id + '|' + pdp.color, q) + '<div class="in-cart">در سبد شما <a href="#/cart" data-go="cart">مشاهده سبد خرید</a></div>'
          : '<button class="btn btn-primary btn-block" type="button" data-add="' + p.id + '">افزودن به سبد خرید</button>')
        : '<div class="out" style="margin:0">این کالا فعلاً موجود نیست</div><button class="btn btn-ghost btn-block" type="button" data-notify="' + p.id + '">موجود شد خبرم کن</button>') +
    '</aside>';
  }

  function mobileBuy(p) {
    if (!p.stock) return '';
    const q = cartQtyFor(p);
    return '<div class="buybox-mobile" id="buyMobile">' +
      (q ? qtyCtl(p.id + '|' + pdp.color, q) : '<button class="btn btn-primary" type="button" data-add="' + p.id + '">افزودن به سبد</button>') +
      '<div class="price"><span class="now num">' + fa(final(p)) + tome + '</span>' + (p.off ? '<span class="was num">' + fa(p.price) + '</span>' : '') + '</div></div>' +
      '<div class="mbuy-spacer"></div>';
  }

  function qtyCtl(key, q) {
    return '<div class="qty"><button type="button" data-inc="' + key + '" aria-label="افزایش">' + ic('plus') + '</button><span class="num">' + fa(q) + '</span>' +
      '<button type="button" data-dec="' + key + '" aria-label="کاهش">' + (q === 1 ? ic('trash') : ic('minus')) + '</button></div>';
  }

  function refreshBuy() {
    const p = byId(pdp.id); if (!p) return;
    const bb = $('#buybox'); if (bb) bb.outerHTML = buyBox(p);
    const bm = $('#buyMobile'); if (bm) { const sp = bm.nextElementSibling; if (sp && sp.classList.contains('mbuy-spacer')) sp.remove(); bm.outerHTML = mobileBuy(p); }
  }

  /* ---------- سبد خرید ---------- */
  function cartView() {
    const t = totals();
    if (!t.lines.length) {
      const sugg = products.filter((p) => p.stock && p.off >= 15).slice(0, 8);
      return '<div class="wrap"><div class="empty panel" style="margin-top:16px"><div class="big">🛒</div><h3>سبد خرید شما خالی است</h3><p>می‌توانید برای مشاهده محصولات بیشتر به صفحات زیر بروید.</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a class="btn btn-primary" href="#/offers" data-go="offers">پیشنهاد شگفت‌انگیز</a><a class="btn btn-ghost" href="#/best" data-go="best">پرفروش‌ترین‌ها</a></div></div>' +
        '<section class="section"><div class="sec-head"><h2>شاید بپسندید</h2></div><div class="rail plain">' + sugg.map(card).join('') + '</div></section></div>';
    }
    return '<div class="wrap"><div class="cart-layout">' +
      '<section class="panel cart-list"><h2>سبد خرید <span class="num" style="color:var(--muted);font-weight:500;font-size:13px">(' + fa(t.count) + ' کالا)</span><button type="button" data-clear-cart>حذف همه</button></h2>' +
        t.lines.map(({ l, p }) => {
          const color = p.colors[l.color];
          return '<div class="cart-item"><a href="#/p/' + p.id + '" data-go="p/' + p.id + '">' + thumb(p) + '</a><div style="min-width:0">' +
            '<a class="title" href="#/p/' + p.id + '" data-go="p/' + p.id + '">' + esc(p.title) + '</a>' +
            '<div class="attrs">' + (color ? '<span><i style="background:' + color.hex + '"></i>' + color.name + '</span>' : '') + '<span>گارانتی اصالت و سلامت فیزیکی کالا</span><span>ارسال توسط ' + N() + '</span></div>' +
            '<div class="bottom">' + qtyCtl(lineKey(l), l.qty) +
            '<div class="price">' + (p.off ? '<span class="save num">' + fa((p.price - final(p)) * l.qty) + ' تومان تخفیف</span>' : '') + '<span class="now num" style="display:block">' + fa(final(p) * l.qty) + tome + '</span></div></div>' +
          '</div></div>';
        }).join('') +
      '</section>' +
      summaryHTML(t, 'cart') +
    '</div></div>';
  }

  function summaryHTML(t, mode) {
    const left = Math.max(0, FREE_SHIP - t.payable);
    return '<aside class="panel summary" id="summary">' +
      '<div class="sum-row"><span>قیمت کالاها <span class="num">(' + fa(t.count) + ')</span></span><b class="num">' + fa(t.list) + ' تومان</b></div>' +
      (t.itemDisc ? '<div class="sum-row disc"><span>سود شما از خرید</span><b class="num">' + fa(t.itemDisc) + ' تومان</b></div>' : '') +
      (t.coupon ? '<div class="sum-row disc"><span>کد تخفیف ' + esc(S.coupon ? S.coupon.code : '') + '</span><b class="num">' + fa(t.coupon) + ' تومان</b></div>' : '') +
      '<div class="sum-row"><span>هزینه ارسال</span><b class="num">' + (mode === 'cart' ? (t.payable >= FREE_SHIP ? 'رایگان' : 'در مرحله بعد') : (t.ship ? fa(t.ship) + ' تومان' : 'رایگان')) + '</b></div>' +
      '<div class="sum-row total"><span>' + (mode === 'cart' ? 'جمع سبد خرید' : 'مبلغ قابل پرداخت') + '</span><b class="num">' + fa(mode === 'cart' ? t.payable - t.coupon : t.total) + ' تومان</b></div>' +
      (left ? '<div class="ship-progress num">فقط <b>' + fa(left) + ' تومان</b> تا ارسال رایگان باقی مانده<div class="bar"><i style="width:' + Math.min(100, t.payable / FREE_SHIP * 100) + '%"></i></div></div>'
        : '<div class="ship-progress">ارسال عادی این سفارش <b>رایگان</b> است</div>') +
      '<form class="coupon" id="couponForm"><input id="couponIn" placeholder="کد تخفیف" value="' + (S.coupon ? esc(S.coupon.code) : '') + '" aria-label="کد تخفیف"' + (S.coupon ? ' disabled' : '') + '>' +
        (S.coupon ? '<button class="btn btn-ghost" type="button" data-rm-coupon>حذف</button>' : '<button class="btn btn-ghost" type="submit">اعمال</button>') + '</form>' +
      (API.on ? '' : '<span class="hint">برای آزمایش، کد KALANO10 را وارد کنید.</span>') +
      (mode === 'cart' ? '<button class="btn btn-primary btn-block" type="button" data-checkout>ادامه و ثبت سفارش</button>'
        : '<button class="btn btn-primary btn-block" type="submit" form="checkoutForm">' + (S.pay === 'cod' ? 'ثبت سفارش' : 'پرداخت و ثبت سفارش') + '</button>') +
      '<span class="hint">کالاهای موجود در سبد شما رزرو نشده‌اند؛ برای ثبت سفارش مراحل بعدی را تکمیل کنید.</span>' +
    '</aside>';
  }

  function refreshSummary(mode) { const s = $('#summary'); if (s) s.outerHTML = summaryHTML(totals(), mode); }

  /* ---------- تکمیل سفارش ---------- */
  const PROVINCES = ['تهران', 'اصفهان', 'خراسان رضوی', 'فارس', 'آذربایجان شرقی', 'البرز', 'خوزستان', 'مازندران', 'گیلان', 'کرمان', 'قم', 'یزد', 'سایر استان‌ها'];

  function checkoutView() {
    const t = totals();
    if (!t.lines.length) return cartView();
    if (!S.user) { setTimeout(() => openLogin('checkout'), 0); }
    const onlineOk = !API.on || CFG.features.onlinePayment;
    if (!onlineOk) S.pay = 'cod';
    const a = S.co;
    const f = (id, label, attrs, full) => '<label class="field' + (full ? ' full' : '') + '">' + label + '<input id="' + id + '" name="' + id + '" value="' + esc(a[id] || '') + '" ' + (attrs || '') + '><span class="err" data-err="' + id + '"></span></label>';
    return '<div class="wrap">' +
      '<div class="steps"><span class="on">سبد خرید</span><span class="on">زمان و شیوه ارسال</span><span>پرداخت</span></div>' +
      '<div class="cart-layout"><div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
        '<form id="checkoutForm" novalidate style="display:flex;flex-direction:column;gap:12px">' +
          '<section class="panel co-section"><h2>آدرس تحویل سفارش</h2><div class="form-grid">' +
            f('name', 'نام و نام خانوادگی تحویل‌گیرنده', 'required autocomplete="name"') +
            f('phone', 'شماره موبایل', 'required inputmode="tel" autocomplete="tel" placeholder="۰۹۱۲۳۴۵۶۷۸۹"') +
            '<label class="field">استان<select id="province" name="province">' + PROVINCES.map((p) => '<option' + (a.province === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
            f('city', 'شهر', 'required') +
            f('address', 'نشانی کامل (خیابان، کوچه، پلاک، واحد)', 'required', true) +
            f('postal', 'کد پستی ۱۰ رقمی', 'required inputmode="numeric"') +
          '</div></section>' +
          '<section class="panel co-section"><h2>شیوه ارسال</h2>' +
            '<label class="choice"><input type="radio" name="ship" value="normal"' + (S.ship === 'normal' ? ' checked' : '') + '><div><b>ارسال عادی</b><span>تحویل ۲ تا ۴ روز کاری • رایگان برای خرید بالای ' + fa(FREE_SHIP) + ' تومان</span></div><span class="c-price num">' + (t.payable >= FREE_SHIP ? 'رایگان' : fa(SHIP_NORMAL) + ' تومان') + '</span></label>' +
            '<label class="choice"><input type="radio" name="ship" value="express"' + (S.ship === 'express' ? ' checked' : '') + '><div><b>ارسال اکسپرس</b><span>تحویل امروز یا فردا (فقط تهران و کرج)</span></div><span class="c-price num">' + fa(SHIP_EXPRESS) + ' تومان</span></label>' +
          '</section>' +
          '<section class="panel co-section"><h2>شیوه پرداخت</h2>' +
            (onlineOk ? '<label class="choice"><input type="radio" name="pay" value="online"' + (S.pay === 'online' ? ' checked' : '') + '><div><b>پرداخت اینترنتی' + (CFG.features.paymentMode === 'fake' || CFG.features.paymentMode === 'sandbox' ? ' <span class="tag-test">آزمایشی</span>' : '') + '</b><span>با همه کارت‌های بانکی عضو شتاب، از طریق درگاه امن زرین‌پال</span></div></label>' : '') +
            '<label class="choice"><input type="radio" name="pay" value="cod"' + (S.pay === 'cod' ? ' checked' : '') + '><div><b>پرداخت در محل</b><span>پرداخت نقدی یا با کارتخوان هنگام تحویل</span></div></label>' +
          '</section>' +
        '</form>' +
        '<section class="panel co-section"><h2>مرسوله شما <span class="num" style="font-weight:500;color:var(--muted);font-size:13px">(' + fa(t.count) + ' کالا)</span></h2><div class="order" style="padding:0"><div class="o-items">' +
          t.lines.map(({ p, l }) => '<span style="--h:' + hueOf(p) + '" title="' + esc(p.title) + '">' + p.emoji + '</span>' + (l.qty > 1 ? '<b class="num" style="align-self:flex-end;font-size:12px">×' + fa(l.qty) + '</b>' : '')).join('') +
        '</div></div></section>' +
      '</div>' + summaryHTML(t, 'checkout') + '</div></div>';
  }

  function validateCheckout() {
    const v = (id) => ($('#' + id) ? $('#' + id).value.trim() : '');
    const data = { name: v('name'), phone: toEn(v('phone')), province: v('province'), city: v('city'), address: v('address'), postal: toEn(v('postal')) };
    const errs = {};
    if (data.name.length < 3) errs.name = 'نام و نام خانوادگی را کامل وارد کنید.';
    if (!/^09\d{9}$/.test(data.phone)) errs.phone = 'شماره موبایل باید ۱۱ رقم باشد و با ۰۹ شروع شود.';
    if (data.city.length < 2) errs.city = 'نام شهر را وارد کنید.';
    if (data.address.length < 10) errs.address = 'نشانی را کامل‌تر بنویسید (حداقل ۱۰ حرف).';
    if (!/^\d{10}$/.test(data.postal)) errs.postal = 'کد پستی باید ۱۰ رقم باشد.';
    $$('[data-err]').forEach((el) => { el.textContent = errs[el.dataset.err] || ''; });
    return { ok: !Object.keys(errs).length, data, errs };
  }

  function placeOrder() {
    if (!S.user) { openLogin('checkout'); return; }
    const r = validateCheckout();
    if (!r.ok) { const first = Object.keys(r.errs)[0]; $('#' + first).focus(); toast('لطفاً اطلاعات آدرس را کامل کنید'); return; }
    S.co = r.data; store.set('address', S.co);

    if (API.on) {
      const btn = $('button[form="checkoutForm"]');
      if (btn) { btn.disabled = true; btn.textContent = 'در حال ثبت سفارش…'; }
      api('/api/orders', {
        items: S.cart.map((l) => ({ id: l.id, color: l.color, qty: l.qty })),
        coupon: S.coupon ? S.coupon.code : null, ship: S.ship, pay: S.pay, address: r.data
      }).then((res) => {
        S.cart = []; S.coupon = null; save('cart'); updateBadges();
        if (res.payUrl) { toast('در حال انتقال به درگاه پرداخت…'); location.href = res.payUrl; return; }
        loadCatalog().catch(() => {});
        go('done/' + res.order.code);
      }).catch((e) => {
        toast(e.message);
        if (e.status === 409) loadCatalog().then(() => render('checkout', true)).catch(() => {});
        else refreshSummary('checkout');
      });
      return;
    }

    const t = totals();
    const code = 'KL-' + toEn(String(Date.now()).slice(-7));
    S.orders.unshift({
      code, status: 'processing', createdAt: Date.now(), total: t.total, count: t.count, ship: S.ship, payMethod: S.pay,
      items: t.lines.map(({ p, l }) => ({ id: p.id, emoji: p.emoji, qty: l.qty, color: p.colors[l.color] || null, price: final(p) })), address: r.data
    });
    save('orders');
    S.cart = []; S.coupon = null; save('cart'); updateBadges();
    go('done/' + code);
  }

  /* وضعیت‌های سفارش: [برچسب، نوع نشانگر] */
  const STATUS = {
    pending_payment: ['در انتظار پرداخت', 'warn'], processing: ['در حال پردازش', 'ok'], shipped: ['ارسال شده', 'ok'],
    delivered: ['تحویل داده شده', 'ok'], cancelled: ['لغو شده', 'bad'], payment_failed: ['پرداخت ناموفق', 'bad']
  };
  const ORD = {};
  const loadingBox = () => '<div class="wrap"><div class="empty"><div class="spinner" aria-hidden="true"></div><p>در حال بارگذاری…</p></div></div>';
  const errorBox = (msg, needLogin) => '<div class="wrap"><div class="empty panel" style="margin-top:16px"><div class="big">⚠️</div><h3>' + esc(msg) + '</h3>' +
    (needLogin ? '<button class="btn btn-primary" type="button" data-login>ورود به حساب</button>' : '<a class="btn btn-primary" href="#/" data-go="">بازگشت به فروشگاه</a>') + '</div></div>';

  function asyncInto(route, promise, renderFn) {
    promise.then((data) => { if (current === route) app.innerHTML = renderFn(data); })
      .catch((e) => { if (current === route) app.innerHTML = errorBox(e.message, e.status === 401); });
    return loadingBox();
  }

  function doneView(code) {
    if (API.on) return asyncInto('done/' + code, api('/api/orders/' + encodeURIComponent(code)), (o) => { ORD[o.code] = o; return orderResultHTML(o); });
    const o = S.orders.find((x) => x.code === code);
    if (!o) return notFound();
    return orderResultHTML(Object.assign({ status: 'processing', payMethod: o.pay }, o));
  }

  function orderResultHTML(o) {
    const failed = o.status === 'payment_failed' || o.status === 'cancelled';
    const waiting = o.status === 'pending_payment';
    const icon = failed ? '<div class="check bad">' + ic('x') + '</div>' : waiting ? '<div class="check warn">' + ic('clock') + '</div>' : '<div class="check">' + ic('check') + '</div>';
    const title = o.status === 'payment_failed' ? 'پرداخت انجام نشد' : o.status === 'cancelled' ? 'این سفارش لغو شده است' : waiting ? 'سفارش در انتظار پرداخت است' : 'سفارش شما با موفقیت ثبت شد';
    return '<div class="wrap"><div class="panel done">' + icon + '<h1>' + title + '</h1>' +
      (o.status === 'payment_failed' ? '<p style="color:var(--muted)">اگر مبلغی از حساب شما کم شده باشد، حداکثر تا ۷۲ ساعت به حساب‌تان برمی‌گردد.</p>' : '') +
      '<p style="color:var(--muted);margin:0">کد سفارش:</p><div class="code num">' + esc(o.code) + '</div>' +
      (o.refId ? '<p class="num" style="margin:0 0 6px">کد رهگیری پرداخت: <b>' + fd(o.refId) + '</b></p>' : '') +
      '<p style="color:var(--muted);margin:0 0 18px" class="num">مبلغ ' + fa(o.total) + ' تومان • ' + (o.payMethod === 'cod' ? 'پرداخت در محل' : 'پرداخت اینترنتی') + ' • ' + (o.ship === 'express' ? 'ارسال اکسپرس' : 'ارسال عادی') + '</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        (failed && o.items ? '<button class="btn btn-primary" type="button" data-reorder="' + esc(o.code) + '">برگرداندن کالاها به سبد خرید</button>' : '<a class="btn btn-primary" href="#/account" data-go="account">پیگیری سفارش</a>') +
        '<a class="btn btn-ghost" href="#/" data-go="">ادامه خرید</a></div></div></div>';
  }

  function reorder(code) {
    const o = ORD[code] || S.orders.find((x) => x.code === code);
    if (!o) return;
    let added = 0;
    for (const it of o.items) {
      const p = byId(it.id);
      if (!p || !p.stock) continue;
      const color = it.color ? Math.max(0, p.colors.findIndex((c) => c.hex === it.color.hex)) : 0;
      const l = S.cart.find((x) => x.id === p.id && x.color === color);
      const qty = Math.min(it.qty, p.stock, MAX_PER_ITEM);
      if (l) l.qty = Math.min(l.qty + qty, p.stock, MAX_PER_ITEM); else S.cart.push({ id: p.id, color, qty });
      added++;
    }
    save('cart'); updateBadges();
    if (added) { toast('کالاها به سبد خرید برگشتند'); go('cart'); } else toast('کالاهای این سفارش دیگر موجود نیستند');
  }

  /* ---------- علاقه‌مندی و حساب کاربری ---------- */
  function wishView() {
    const list = S.wish.map(byId).filter(Boolean);
    return '<div class="wrap"><div class="list-title" style="margin-top:16px"><h1>علاقه‌مندی‌ها</h1><span class="num" style="color:var(--muted)">' + fa(list.length) + ' کالا</span></div>' +
      (list.length ? '<div class="grid">' + list.map(card).join('') + '</div>'
        : '<div class="empty panel"><div class="big">🤍</div><h3>لیست علاقه‌مندی‌های شما خالی است</h3><p>با زدن آیکون قلب روی هر کالا، آن را اینجا ذخیره کنید.</p><a class="btn btn-primary" href="#/" data-go="">گشتن در فروشگاه</a></div>') + '</div>';
  }

  function ordersHTML(orders) {
    if (!orders.length) return '<div class="empty panel"><div class="big">📦</div><h3>هنوز سفارشی ثبت نکرده‌اید</h3><a class="btn btn-primary" href="#/" data-go="">شروع خرید</a></div>';
    return orders.map((o) => {
      const st = STATUS[o.status] || STATUS.processing;
      return '<div class="panel order"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span class="pill ' + st[1] + '">' + st[0] + '</span>' +
        '<span class="num" style="font-size:12px;color:var(--muted)">' + (o.createdAt ? new Date(o.createdAt).toLocaleDateString('fa-IR') : esc(o.date || '')) + '</span></div>' +
        '<div class="o-head num"><span>کد سفارش <b><a href="#/done/' + esc(o.code) + '" data-go="done/' + esc(o.code) + '">' + esc(o.code) + '</a></b></span><span>مبلغ <b>' + fa(o.total) + ' تومان</b></span><span>' + fa(o.count) + ' کالا</span><span>' + (o.ship === 'express' ? 'ارسال اکسپرس' : 'ارسال عادی') + '</span>' +
        (o.refId ? '<span>کد رهگیری <b>' + fd(o.refId) + '</b></span>' : '') + '</div>' +
        '<div class="o-items">' + o.items.map((it) => {
          const p = byId(it.id);
          return '<a href="#/p/' + it.id + '" data-go="p/' + it.id + '" title="' + esc(it.title || (p ? p.title : '')) + '"><span style="--h:' + (p ? hueOf(p) : 20) + '">' + (it.emoji || (p ? p.emoji : '📦')) + '</span></a>';
        }).join('') + '</div></div>';
    }).join('');
  }

  function accountView() {
    if (!S.user) {
      return '<div class="wrap"><div class="empty panel" style="margin-top:16px"><div class="big">👤</div><h3>وارد حساب کاربری شوید</h3><p>برای دیدن سفارش‌ها، آدرس‌ها و علاقه‌مندی‌ها وارد شوید.</p><button class="btn btn-primary" type="button" data-login>ورود | ثبت‌نام</button></div></div>';
    }
    if (API.on) {
      api('/api/orders').then((r) => { r.orders.forEach((o) => { ORD[o.code] = o; }); const box = $('#ordersBox'); if (box && current === 'account') box.innerHTML = ordersHTML(r.orders); })
        .catch((e) => { const box = $('#ordersBox'); if (box) box.innerHTML = '<div class="empty panel"><h3>' + esc(e.message) + '</h3></div>'; });
    }
    return '<div class="wrap"><div class="account">' +
      '<aside class="panel acc-side"><div class="who"><span class="av">' + esc((S.user.name || CFG.storeName).charAt(0)) + '</span><div><b>' + esc(S.user.name || 'کاربر ' + CFG.storeName) + '</b><div class="num" style="font-size:12px;color:var(--muted)">' + fd(S.user.phone) + '</div></div></div>' +
        '<a href="#/account" data-go="account">' + ic('store').replace('<svg', '<svg width="18" height="18"') + 'سفارش‌ها</a>' +
        '<a href="#/wish" data-go="wish">' + ic('heart').replace('<svg', '<svg width="18" height="18"') + 'علاقه‌مندی‌ها</a>' +
        '<a href="#/cart" data-go="cart">' + ic('cart').replace('<svg', '<svg width="18" height="18"') + 'سبد خرید</a>' +
        '<button type="button" data-logout style="color:var(--danger)">خروج از حساب</button>' +
      '</aside>' +
      '<section style="min-width:0"><div class="list-title"><h1>سفارش‌های من</h1></div><div id="ordersBox">' +
        (API.on ? '<div class="empty"><div class="spinner" aria-hidden="true"></div></div>' : ordersHTML(S.orders)) +
      '</div></section></div></div>';
  }

  /* ---------- ورود با کد یکبار مصرف ---------- */
  function openLogin(next) {
    if ($('#loginModal')) return;
    const root = $('#modalRoot');
    root.innerHTML = '<div class="overlay" id="loginModal" role="dialog" aria-modal="true" aria-labelledby="lgTitle"><form class="modal" id="loginForm" novalidate>' +
      '<button class="x" type="button" data-close-modal aria-label="بستن">×</button>' +
      '<div class="logo"><span class="logo-mark">' + N() + '</span><span class="logo-dot"></span></div>' +
      '<div id="lgStep1"><h2 id="lgTitle">ورود | ثبت‌نام</h2><p style="margin:6px 0 12px">سلام! لطفاً شماره موبایل خود را وارد کنید.</p>' +
        '<label class="field">شماره موبایل<input id="lgPhone" inputmode="tel" class="num" placeholder="۰۹۱۲۳۴۵۶۷۸۹" autocomplete="tel" style="direction:ltr;text-align:right"></label>' +
        '<label class="field" style="margin-top:10px">نام (اختیاری)<input id="lgName" maxlength="30" autocomplete="name"></label></div>' +
      '<div id="lgStep2" hidden><h2>کد تأیید را وارد کنید</h2><p id="lgSent" style="margin:6px 0 12px"></p><label class="field">کد ۵ رقمی<input id="lgCode" inputmode="numeric" maxlength="5" autocomplete="one-time-code" class="otp"></label>' +
        '<p class="hint" id="lgHint" style="margin-top:6px"></p><button type="button" class="link-btn" id="lgBack">ویرایش شماره موبایل</button></div>' +
      '<span class="err" id="lgErr" role="alert"></span>' +
      '<button class="btn btn-primary btn-block" type="submit" id="lgSubmit">ادامه</button>' +
      '<p class="hint" style="text-align:center">ورود شما به معنای پذیرش شرایط ' + N() + ' و قوانین حریم خصوصی است.</p>' +
      '</form></div>';
    const form = $('#loginForm'); const btn = $('#lgSubmit'); const err = $('#lgErr');
    let step = 1;
    setTimeout(() => $('#lgPhone') && $('#lgPhone').focus(), 30);
    const busy = (on, label) => { btn.disabled = on; btn.textContent = label; };
    const toStep = (n) => {
      step = n; err.textContent = '';
      $('#lgStep1').hidden = n !== 1; $('#lgStep2').hidden = n !== 2;
      btn.textContent = n === 1 ? 'ادامه' : 'تأیید و ورود';
      setTimeout(() => $(n === 1 ? '#lgPhone' : '#lgCode').focus(), 30);
    };
    $('#lgBack').addEventListener('click', () => toStep(1));
    const success = (user) => {
      S.user = user; save('user'); updateBadges(); closeModal();
      toast('خوش آمدید! با موفقیت وارد شدید');
      if (!S.co.phone) S.co.phone = S.user.phone;
      if (!S.co.name && S.user.name) S.co.name = S.user.name;
      if (next) go(next); else if (current === 'account' || current.startsWith('done/')) render(current, true);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ph = toEn($('#lgPhone').value.trim());
      if (step === 1) {
        if (!/^09\d{9}$/.test(ph)) { err.textContent = 'شماره موبایل باید ۱۱ رقم باشد و با ۰۹ شروع شود.'; return; }
        let hint = 'نسخه نمایشی: کد تأیید همیشه ' + fd(DEMO_OTP) + ' است.';
        if (API.on) {
          busy(true, 'در حال ارسال کد…');
          try {
            const r = await api('/api/auth/request', { phone: ph });
            hint = r.devCode ? 'حالت توسعه (پیامک تنظیم نشده): کد شما ' + fd(r.devCode) + ' است.' : 'کد تا ۲ دقیقه معتبر است.';
          } catch (ex) { busy(false, 'ادامه'); err.textContent = ex.message; return; }
        }
        $('#lgSent').textContent = 'کد تأیید به شماره ' + fd(ph) + ' ارسال شد.';
        $('#lgHint').textContent = hint;
        toStep(2);
        btn.disabled = false;
        return;
      }
      const code = toEn($('#lgCode').value.trim());
      if (!/^\d{4,6}$/.test(code)) { err.textContent = 'کد تأیید را کامل وارد کنید.'; return; }
      if (!API.on) {
        if (code !== DEMO_OTP) { err.textContent = 'کد واردشده درست نیست. در نسخه نمایشی کد ' + fd(DEMO_OTP) + ' است.'; return; }
        success({ phone: ph, name: $('#lgName').value.trim() });
        return;
      }
      busy(true, 'در حال بررسی…');
      try {
        const r = await api('/api/auth/verify', { phone: ph, code, name: $('#lgName').value.trim() });
        store.set('token', r.token);
        success(r.user);
      } catch (ex) { busy(false, 'تأیید و ورود'); err.textContent = ex.message; }
    });
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }

  /* ---------- منوی دسته‌بندی ---------- */
  const megaWrap = $('#megaWrap'), mega = $('#mega'), megaBtn = $('#megaBtn');
  function megaBody(cid) {
    const c = catOf(cid);
    const picks = products.filter((p) => p.cat === cid).sort((a, b) => b.sold - a.sold).slice(0, 3);
    return '<div class="mega-cats">' + categories.map((x) => '<a href="#/c/' + x.id + '" data-go="c/' + x.id + '" data-mega="' + x.id + '" class="' + (x.id === cid ? 'on' : '') + '"><span aria-hidden="true">' + x.icon + '</span>' + x.name + '</a>').join('') + '</div>' +
      '<div class="mega-body"><h4>' + c.name + '<a href="#/c/' + c.id + '" data-go="c/' + c.id + '">همه کالاهای این دسته ←</a></h4>' +
      '<div class="mega-subs">' + c.subs.map((s) => '<a href="#/c/' + c.id + '" data-go="c/' + c.id + '">' + s + '</a>').join('') + '</div>' +
      '<div class="mega-picks">' + picks.map((p) => '<a href="#/p/' + p.id + '" data-go="p/' + p.id + '" style="display:flex;gap:10px;align-items:center;width:240px;max-width:100%;font-size:12px"><span style="--h:' + hueOf(p) + ';width:52px;height:52px;flex:none;border-radius:10px;display:grid;place-items:center;font-size:26px;background:hsl(var(--h) var(--tile-s) var(--tile-l))">' + p.emoji + '</span><span style="min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' + esc(p.title) + '</span></a>').join('') + '</div></div>';
  }
  function openMega() { mega.innerHTML = megaBody(categories[0].id); mega.hidden = false; megaBtn.setAttribute('aria-expanded', 'true'); }
  function closeMega() { mega.hidden = true; megaBtn.setAttribute('aria-expanded', 'false'); }
  megaWrap.addEventListener('mouseenter', () => { if (window.matchMedia('(hover: hover)').matches) openMega(); });
  megaWrap.addEventListener('mouseleave', closeMega);
  megaBtn.addEventListener('click', () => { if (mega.hidden) openMega(); else if (!window.matchMedia('(hover: hover)').matches) closeMega(); });
  mega.addEventListener('mouseover', (e) => {
    const a = e.target.closest('[data-mega]');
    if (a && !a.classList.contains('on')) mega.innerHTML = megaBody(a.dataset.mega);
  });

  /* ---------- رویدادهای سراسری ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('.search')) hideSuggest();
    const el = t.closest('[data-go],[data-add],[data-wish],[data-inc],[data-dec],[data-sort],[data-clear],[data-drawer],[data-color],[data-view],[data-scroll],[data-rate],[data-slide],[data-slide-step],[data-checkout],[data-clear-cart],[data-rm-coupon],[data-login],[data-logout],[data-close-modal],[data-notify],[data-reorder]');
    if (!el) { if (t.id === 'loginModal') closeModal(); return; }
    const d = el.dataset;

    if ('go' in d) { e.preventDefault(); qInput.blur(); go(d.go); return; }
    if (d.add) { addToCart(d.add, current && current.startsWith('p/') ? pdp.color : 0); if (current.startsWith('p/')) refreshBuy(); return; }
    if (d.wish) { e.preventDefault(); toggleWish(d.wish); return; }
    if (d.inc || d.dec) {
      changeQty(d.inc || d.dec, d.inc ? 1 : -1);
      if (current === 'cart') render('cart', true); else if (current.startsWith('p/')) refreshBuy();
      return;
    }
    if (d.sort) { L.sort = d.sort; rerenderListing(); return; }
    if ('clear' in d) { Object.assign(L, { cats: new Set(), brands: new Set(), min: '', max: '', avail: false, disc: false }); rerenderListing(); return; }
    if (d.drawer) { L.drawer = d.drawer === '1'; const f = $('.filters'); if (f) f.classList.toggle('open', L.drawer); document.body.style.overflow = L.drawer ? 'hidden' : ''; return; }
    if (d.color) { pdp.color = Number(d.color); render(current, true); return; }
    if (d.view) { pdp.view = Number(d.view); render(current, true); return; }
    if (d.scroll) {
      e.preventDefault();
      const s = $('#sec-' + d.scroll); if (s) window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY - 180, behavior: 'smooth' });
      $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.scroll === d.scroll));
      return;
    }
    if (d.rate) { pdp.rate = Number(d.rate); $$('.star-pick button').forEach((b) => b.classList.toggle('on', Number(b.dataset.rate) <= pdp.rate)); return; }
    if (d.slide) { showSlide(Number(d.slide)); return; }
    if (d.slideStep) { showSlide(slideIdx + Number(d.slideStep)); return; }
    if ('checkout' in d) { if (!S.user) openLogin('checkout'); else go('checkout'); return; }
    if ('clearCart' in d) { S.cart = []; save('cart'); updateBadges(); render('cart', true); toast('سبد خرید خالی شد'); return; }
    if ('rmCoupon' in d) { S.coupon = null; refreshSummary(current === 'cart' ? 'cart' : 'checkout'); return; }
    if ('login' in d) { openLogin(); return; }
    if ('logout' in d) {
      if (API.on) { api('/api/auth/logout', {}).catch(() => {}); store.set('token', null); }
      S.user = null; save('user'); updateBadges(); render('account', true); toast('از حساب خارج شدید'); return;
    }
    if (d.reorder) { reorder(d.reorder); return; }
    if ('closeModal' in d) { closeModal(); return; }
    if (d.notify) { toast('وقتی این کالا موجود شد به شما خبر می‌دهیم'); return; }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f && L) {
      const f = t.dataset.f;
      if (f === 'cat') t.checked ? L.cats.add(t.value) : L.cats.delete(t.value);
      if (f === 'brand') t.checked ? L.brands.add(t.value) : L.brands.delete(t.value);
      if (f === 'min' || f === 'max') { const v = toEn(t.value).replace(/[^\d]/g, ''); L[f] = v === '' ? '' : Number(v); }
      if (f === 'avail' || f === 'disc') L[f] = t.checked;
      rerenderListing();
      return;
    }
    if (t.name === 'ship') { S.ship = t.value; refreshSummary('checkout'); return; }
    if (t.name === 'pay') { S.pay = t.value; refreshSummary('checkout'); return; }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.closest('#checkoutForm') && t.name && t.type !== 'radio') S.co[t.name] = t.value;
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'couponForm') {
      e.preventDefault();
      const code = $('#couponIn').value.trim().toUpperCase();
      const mode = current === 'cart' ? 'cart' : 'checkout';
      if (!code) { toast('کد تخفیف را وارد کنید'); return; }
      const apply = (c) => { S.coupon = c; toast('کد تخفیف اعمال شد: ' + fa(c.pct) + '٪ تخفیف تا سقف ' + fa(c.cap) + ' تومان'); refreshSummary(mode); };
      if (API.on) api('/api/coupons/check', { code }).then(apply).catch((ex) => toast(ex.message));
      else if (DEMO_COUPONS[code]) apply({ code, pct: DEMO_COUPONS[code].pct, cap: DEMO_COUPONS[code].cap });
      else toast('این کد تخفیف معتبر نیست');
    } else if (f.id === 'checkoutForm') {
      e.preventDefault(); placeOrder();
    } else if (f.id === 'reviewForm') {
      e.preventDefault();
      const name = $('#rvName').value.trim(), text = $('#rvText').value.trim();
      if (name.length < 2 || text.length < 10) { toast('نام و متن دیدگاه (حداقل ۱۰ حرف) را وارد کنید'); return; }
      if (API.on) {
        if (!S.user) { openLogin(); toast('برای ثبت دیدگاه ابتدا وارد شوید'); return; }
        const pid = pdp.id;
        api('/api/products/' + pid + '/reviews', { name, text, rate: pdp.rate })
          .then(() => { delete RV[pid]; toast('دیدگاه شما ثبت شد. ممنون از همراهی‌تان'); if (current === 'p/' + pid) render(current, true); })
          .catch((ex) => toast(ex.message));
        return;
      }
      (S.reviews[pdp.id] = S.reviews[pdp.id] || []).unshift({ name, text, rate: pdp.rate, date: new Date().toLocaleDateString('fa-IR'), buy: S.orders.some((o) => o.items.some((i) => i.id === pdp.id)) });
      save('reviews'); render(current, true); toast('دیدگاه شما ثبت شد. ممنون از همراهی‌تان');
    } else if (f.id === 'newsletter') {
      e.preventDefault(); toast('ایمیل شما ثبت شد. تخفیف‌های ویژه را برایتان می‌فرستیم'); f.reset();
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMega(); } });

  $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* ---------- حالت تاریک ---------- */
  const root = document.documentElement;
  const savedTheme = store.get('theme', null);
  if (savedTheme) root.setAttribute('data-theme', savedTheme);
  $('#themeBtn').addEventListener('click', () => {
    const dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next); store.set('theme', next);
  });

  /* ---------- ارتباط با سرور ---------- */
  async function api(path, body, method) {
    const opt = { method: method || (body ? 'POST' : 'GET'), headers: { accept: 'application/json' } };
    if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const token = store.get('token', null);
    if (token) opt.headers.authorization = 'Bearer ' + token;
    let res;
    try { res = await fetch(path, opt); } catch (e) { throw new Error('ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { store.set('token', null); S.user = null; save('user'); updateBadges(); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'خطایی رخ داد. دوباره تلاش کنید.'), { status: res.status });
    return data;
  }

  async function loadCatalog() {
    const c = await api('/api/catalog');
    // متن‌هایی که از پنل مدیریت می‌آیند و در قالب‌ها مستقیم درج می‌شوند، همین‌جا امن (escape) می‌شوند
    c.categories.forEach((x) => { x.name = esc(x.name); x.icon = esc(x.icon); x.subs = x.subs.map(esc); });
    c.products.forEach((p) => {
      p.emoji = esc(p.emoji);
      p.colors.forEach((cl) => { cl.name = esc(cl.name); cl.hex = /^#[0-9a-f]{6}$/i.test(cl.hex) ? cl.hex : '#888888'; });
      p.specs = Object.fromEntries(Object.entries(p.specs).map(([k, v]) => [esc(k), esc(v)]));
    });
    categories.splice(0, categories.length, ...c.categories);
    products.splice(0, products.length, ...c.products);
  }

  /** نام فروشگاه، رنگ‌ها و هزینه‌های ارسال را از تنظیمات اعمال می‌کند */
  function applySettings() {
    FREE_SHIP = CFG.freeShip; SHIP_NORMAL = CFG.shipNormal; SHIP_EXPRESS = CFG.shipExpress; MAX_PER_ITEM = CFG.maxPerItem;
    $$('[data-store-name]').forEach((el) => { el.textContent = CFG.storeName; });
    $$('[data-store-phone]').forEach((el) => { el.textContent = CFG.phone; });
    $$('[data-demo-only]').forEach((el) => { el.hidden = API.on; });
    qInput.placeholder = 'جستجو در ' + CFG.storeName + '، مثلاً «هدفون» یا «سامسونگ»';
    let st = $('#themeVars');
    if (!st) { st = document.createElement('style'); st.id = 'themeVars'; document.head.appendChild(st); }
    const b = CFG.brandColor, a = CFG.accentColor, hex = /^#[0-9a-f]{6}$/i;
    if (!hex.test(b) || !hex.test(a) || (b.toLowerCase() === DEFAULTS.brandColor && a.toLowerCase() === DEFAULTS.accentColor)) { st.textContent = ''; return; }
    // وقتی رنگ اصلی عوض شود، زمینه و خطوط هم کمی به سمت همان رنگ می‌روند تا ظاهر یکدست بماند
    const light = '--bg:color-mix(in srgb,' + b + ' 4%,#fdfdfd);--sunken:color-mix(in srgb,' + b + ' 7%,#f9f9f9);--line:color-mix(in srgb,' + b + ' 15%,#e9e9e9);--brand:' + b + ';--brand-strong:color-mix(in srgb,' + b + ' 82%,black);--brand-soft:color-mix(in srgb,' + b + ' 12%,white);--saffron:' + a +
      ';--offers-a:color-mix(in srgb,' + b + ' 85%,#ffb000);--offers-b:color-mix(in srgb,' + b + ' 70%,#ff2d7a);--chart-bar:' + b + ';';
    const dark = '--bg:color-mix(in srgb,' + b + ' 5%,#111);--surface:color-mix(in srgb,' + b + ' 7%,#1a1a1a);--sunken:color-mix(in srgb,' + b + ' 5%,#151515);--line:color-mix(in srgb,' + b + ' 16%,#2b2b2b);--brand:color-mix(in srgb,' + b + ' 72%,white);--brand-strong:color-mix(in srgb,' + b + ' 55%,white);--brand-soft:color-mix(in srgb,' + b + ' 22%,#211816);' +
      '--saffron:color-mix(in srgb,' + a + ' 85%,white);--offers-a:color-mix(in srgb,' + b + ' 70%,#3a1208);--offers-b:color-mix(in srgb,' + b + ' 60%,#3a0820);';
    st.textContent = ':root{' + light + '}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + dark + '}}:root[data-theme="dark"]{' + dark + '}';
  }

  /* ---------- شروع ---------- */
  async function boot() {
    try {
      const r = await fetch('/api/settings', { headers: { accept: 'application/json' } });
      if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
        CFG = Object.assign({}, DEFAULTS, await r.json());
        API.on = true;
        await loadCatalog();
        if (store.get('token', null)) {
          try { S.user = (await api('/api/me')).user; } catch (e) { S.user = null; }
        } else S.user = null;
        save('user');
      }
    } catch (e) { /* بدون سرور: حالت نمایشی با داده‌های data.js */ }
    applySettings();
    updateBadges();
    render(parseHash());
  }
  boot();
})();
