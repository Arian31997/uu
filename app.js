'use strict';
/* Velora frontend — talks only to the server API. No credentials, no mock data. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- i18n ---------- */
const LS_LANG = 'velora_lang';
let lang = localStorage.getItem(LS_LANG) || 'fa';
if (!I18N[lang]) lang = 'fa';

const t = (key) => (I18N[lang] && I18N[lang][key]) ?? (I18N.fa[key] ?? key);

function applyI18n() {
  const cfg = I18N[lang];
  document.documentElement.lang = cfg.lang;
  document.documentElement.dir = cfg.dir;
  document.body.classList.toggle('ltr', cfg.dir === 'ltr');
  document.title = 'VELORA — ' + (lang === 'fa' ? 'ولورا' : 'Velora');
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('#langSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  renderStore();
  if (S.user) renderAccount();
  renderNotifications();
}
function setLang(l) {
  lang = I18N[l] ? l : 'fa';
  localStorage.setItem(LS_LANG, lang);
  applyI18n();
}
$('#langSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (b) setLang(b.dataset.lang);
});

/* ---------- toast + money/date ---------- */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
}
const money = (n) => (lang === 'fa'
  ? Number(n).toLocaleString('fa-IR')
  : Number(n).toLocaleString('en-US')) + ' ' + t('t_irr');
const faDigits = (s) => (lang === 'fa'
  ? String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
  : String(s));
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB',
      { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch { return '—'; }
}

/* ---------- api ---------- */
const S = { user: null, role: null, csrf: null, products: [], filters: { cat: 'all', search: '', min: null, max: null, sort: 'new' } };

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (S.csrf && method !== 'GET') headers['X-CSRF-Token'] = S.csrf;
  const res = await fetch(path, {
    method, headers, credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (data.csrfToken) S.csrf = data.csrfToken;
  if (!res.ok) {
    const e = new Error((data.error && data.error.message) || 'Request failed');
    e.code = data.error && data.error.code;
    e.status = res.status;
    throw e;
  }
  return data;
}

/* ---------- router ---------- */
const PAGES = ['home', 'store', 'auth', 'account', 'team', 'streamers'];
function routeName() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '').split('?')[0];
  if (PAGES.includes(raw)) return raw;
  return '404';
}
function go(name) { location.hash = '#/' + name; }

async function router() {
  const name = routeName();
  if (name === 'account' && !S.user) {
    toast(t('t_login_required'));
    go('auth'); return;
  }
  $$('.page').forEach((p) => p.classList.remove('active'));
  const el = $('#page-' + name);
  if (el) el.classList.add('active');
  $$('#mainNav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  $('#notifPanel').classList.add('hidden');

  if (name === 'store') await loadStore();
  if (name === 'account') await renderAccount();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
window.addEventListener('hashchange', router);

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav-go]');
  if (nav) { go(nav.dataset.navGo); return; }
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go.replace('#/', '')); return; }
  const tg = e.target.closest('[data-tabgo]');
  if (tg) {
    e.preventDefault();
    const tab = $$('.tab').find((x) => x.dataset.tab === tg.dataset.tabgo);
    if (tab) tab.click();
  }
});

$('#menuBtn').onclick = () => $('#mainNav').classList.toggle('open');
$('#accountBtn').onclick = () => go(S.user ? 'account' : 'auth');
$('#enterCityBtn').onclick = () => {
  if (!S.user) { toast(t('t_login_required')); go('auth'); return; }
  go('account');
};

/* ---------- notifications ---------- */
function renderNotifications() {
  const p = $('#notifPanel');
  const dot = $('#notifDot');
  if (S.user) {
    dot.classList.remove('hidden');
    p.innerHTML = `<b>${esc(t('t_notif_title'))}</b>
      <p class="muted">${esc(t('t_notif_1'))}, ${esc(S.user.username)} &#9824;</p>
      <p class="muted">${esc(t('t_notif_2'))}</p>`;
  } else {
    dot.classList.add('hidden');
    p.innerHTML = `<b>${esc(t('t_notif_title'))}</b><p class="muted">${esc(t('t_notif_login'))}</p>`;
  }
}
$('#notifBtn').onclick = () => $('#notifPanel').classList.toggle('hidden');
document.addEventListener('click', (e) => {
  if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) {
    $('#notifPanel').classList.add('hidden');
  }
});

/* ---------- auth page ---------- */
$$('.tab').forEach((tab) => {
  tab.onclick = () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === tab));
    const isReg = tab.dataset.tab === 'register';
    $('#registerForm').classList.toggle('hidden', !isReg);
    $('#loginForm').classList.toggle('hidden', isReg);
    $('#authTitle').textContent = t(isReg ? 'tab_register' : 'tab_login');
    $('.auth-foot').innerHTML = isReg
      ? `<span>${esc(t('auth_foot'))}</span> <a href="#/auth" data-tabgo="login">${esc(t('tab_login'))}</a>`
      : `<a href="#/auth" data-tabgo="register">${esc(t('tab_register'))}</a>`;
  };
});

const fa2en = (s) => String(s).replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#rErr');
  errBox.textContent = '';
  const username = $('#rUser').value.trim();
  const phone = fa2en($('#rPhone').value).replace(/[\s()-]/g, '');
  const email = $('#rEmail').value.trim().toLowerCase();
  const p1 = $('#rPass').value, p2 = $('#rPass2').value;
  const fail = (m) => { errBox.textContent = m; };
  if (!/^[A-Za-z0-9._-]{3,20}$/.test(username)) return fail(t('e_username'));
  if (!/^09\d{9}$/.test(phone)) return fail(t('e_phone'));
  if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email)) return fail(t('e_email'));
  if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/[0-9]/.test(p1)) return fail(t('e_pass'));
  if (p1 !== p2) return fail(t('e_pass2'));
  const btn = $('#registerForm button[type=submit]');
  btn.disabled = true;
  try {
    const d = await api('/api/auth/register', { method: 'POST', body: { username, phone, email, password: p1 } });
    S.user = d.user; S.role = 'user';
    toast(t('btn_create'));
    go('account');
  } catch (ex) {
    fail(friendly(ex, t('e_generic')));
  } finally { btn.disabled = false; }
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#lErr');
  errBox.textContent = '';
  const identifier = $('#lUser').value.trim();
  const password = $('#lPass').value;
  if (!identifier || !password) { errBox.textContent = t('e_fields'); return; }
  const btn = $('#loginForm button[type=submit]');
  btn.disabled = true;
  try {
    const d = await api('/api/auth/login', { method: 'POST', body: { identifier, password } });
    S.user = d.user; S.role = 'user';
    toast(d.user.username);
    go('account');
  } catch (ex) {
    errBox.textContent = friendly(ex, t('e_generic'));
  } finally { btn.disabled = false; }
});

function friendly(errObj, fallback) {
  const map = {
    invalid_credentials: t('e_cred'), invalid_username: t('e_username'), invalid_email: t('e_email'),
    invalid_phone: t('e_phone'), weak_password: t('e_pass'), invalid_password: t('e_pass'),
    username_taken: t('e_username_taken'), email_taken: t('e_email_taken'),
    account_banned: t('e_banned'), too_many_attempts: t('e_throttle'),
    unauthorized: t('e_auth'), forbidden: t('e_forbidden'), out_of_stock: t('e_stock'),
    item_disabled: t('e_disabled'), csrf_invalid: t('e_csrf'), csrf_missing: t('e_csrf'),
  };
  return map[errObj.code] || errObj.message || fallback;
}

/* ---------- store ---------- */
async function loadStore() {
  try {
    const f = S.filters;
    const q = new URLSearchParams();
    if (f.cat !== 'all') q.set('cat', f.cat);
    if (f.search) q.set('search', f.search);
    if (f.min != null) q.set('min', f.min);
    if (f.max != null) q.set('max', f.max);
    q.set('sort', f.sort);
    const d = await api('/api/products?' + q.toString());
    S.products = d.products;
  } catch {
    S.products = [];
  }
  renderStore();
}

/* Neon display text for an item: full phone number or plate code. */
function neonText(p) {
  const name = String(p.name || '');
  const digits = name.match(/\d[\d\s-]{5,}\d/);
  if (digits) return digits[0].replace(/\s+/g, ' ').trim();
  const plate = name.match(/\b[A-Z]{2,10}\b/);
  if (plate) return plate[0];
  return 'VELORA';
}

function productCard(p) {
  const status = p.available
    ? `<button class="btn primary small" data-buy="${esc(p.id)}">${esc(t('t_buy'))}</button>`
    : `<span class="sold out">${esc(t('t_out_of_stock'))}</span>`;
  const thumb = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}"/>`
    : `<div class="neon">${esc(neonText(p))}</div>`;
  return `<article class="p-card" data-cat="${esc(p.cat)}">
    <span class="rare">&#9824; ${esc(p.rare)}</span>
    <div class="p-visual" data-detail="${esc(p.id)}" role="button" tabindex="0">
      <div class="sub">&#8212; FOR SALE &#8212;</div>${thumb}
    </div>
    <div class="p-body">
      <h4>${esc(p.name)}</h4>
      <p class="muted clamp2">${esc(p.description)}</p>
      <div class="p-foot">
        ${status}
        <span class="p-price">${esc(faDigits(p.price))} <small>${esc(t('t_irr'))}</small></span>
      </div>
      <div class="p-meta"><span>${esc(t('t_left'))}: ${esc(faDigits(p.stock))}</span>
        <button class="linkish" data-detail="${esc(p.id)}">${esc(t('t_details'))} &rsaquo;</button></div>
    </div></article>`;
}

function renderStore() {
  const grid = $('#productGrid');
  if (!grid) return;
  const list = S.products || [];
  grid.innerHTML = list.map(productCard).join('');
  $('#storeEmpty').classList.toggle('hidden', list.length > 0);
  const f = S.filters;
  let n = 0;
  if (f.cat !== 'all') n++;
  if (f.search) n++;
  if (f.min != null && f.max != null) n++;
  const fc = $('#filterCount');
  if (fc) fc.textContent = faDigits(n);
}

function refreshFilters() {
  const f = S.filters;
  const boxes = $$('.priceF');
  f.min = null; f.max = null;
  for (const b of boxes) {
    if (b.checked) { const [a, z] = b.value.split('-').map(Number); f.min = a; f.max = z; }
  }
  loadStore();
}
$('#searchInp').addEventListener('input', (e) => { S.filters.search = e.target.value.trim(); loadStore(); });
$('#sortSel').addEventListener('change', (e) => { S.filters.sort = e.target.value; loadStore(); });
$$('input[name=cat]').forEach((r) => { r.onchange = () => { S.filters.cat = r.value; loadStore(); }; });
$$('.priceF').forEach((c) => { c.onchange = refreshFilters; });
$('#clearFilters').onclick = () => {
  S.filters = { cat: 'all', search: '', min: null, max: null, sort: 'new' };
  $('#searchInp').value = '';
  $('#sortSel').value = 'new';
  document.querySelector('input[name=cat][value=all]').checked = true;
  $$('.priceF').forEach((c) => { c.checked = false; });
  loadStore();
};

/* item details */
document.addEventListener('click', async (e) => {
  const detail = e.target.closest('[data-detail]');
  if (detail) {
    const id = detail.dataset.detail;
    try {
      const d = await api('/api/products/' + encodeURIComponent(id));
      openItem(d.product);
    } catch { toast(t('e_generic')); }
    return;
  }
  const buy = e.target.closest('[data-buy]');
  if (buy) await doBuy(buy.dataset.buy);
});
$('#itemClose').onclick = () => $('#itemModal').classList.add('hidden');
$('#itemModal').addEventListener('click', (e) => { if (e.target.id === 'itemModal') $('#itemModal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#itemModal').classList.add('hidden'); });

function openItem(p) {
  $('#itemDetail').innerHTML = `
    <div class="p-visual big">${p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}"/>`
      : `<div class="neon">${esc(neonText(p))}</div>`}</div>
    <span class="rare">&#9824; ${esc(p.rare)}</span>
    <h3>${esc(p.name)}</h3>
    <p class="muted">${esc(p.description)}</p>
    <dl class="kv">
      <div><dt>${esc(t('t_price'))}</dt><dd>${esc(money(p.price))}</dd></div>
      <div><dt>${esc(t('t_stock'))}</dt><dd>${esc(faDigits(p.stock))}</dd></div>
      <div><dt>${esc(t('t_rarity'))}</dt><dd>${esc(p.rare)}</dd></div>
      <div><dt>${esc(t('t_sku'))}</dt><dd dir="ltr">${esc(p.id)}</dd></div>
    </dl>
    ${p.available
      ? `<button class="btn primary full" data-buy="${esc(p.id)}">${esc(t('t_buy'))} &middot; ${esc(money(p.price))}</button>`
      : `<button class="btn ghost full" disabled>${esc(t('t_out_of_stock'))}</button>`}`;
  $('#itemModal').classList.remove('hidden');
}

async function doBuy(itemId) {
  if (!S.user) {
    toast(t('t_login_required'));
    location.hash = '#/auth';
    return;
  }
  try {
    const d = await api('/api/orders', { method: 'POST', body: { itemId } });
    $('#itemModal').classList.add('hidden');
    toast(t('t_buy_ok') + ' — ' + money(d.order.price));
    await loadStore();
    if (routeName() === 'account') await renderAccount();
  } catch (ex) {
    toast(friendly(ex, t('e_generic')));
    await loadStore();
  }
}

/* ---------- account ---------- */
$$('.side-btn[data-dash]').forEach((b) => {
  b.onclick = () => {
    $$('.side-btn[data-dash]').forEach((x) => x.classList.toggle('active', x === b));
    $$('.dash-pane').forEach((p) => p.classList.toggle('active', p.id === 'dash-' + b.dataset.dash));
  };
});
$$('.queueBtn').forEach((b) => {
  b.onclick = () => {
    if (!S.user) { toast(t('t_login_required')); go('auth'); return; }
    toast(t('t_q_added'));
  };
});

$('#logoutBtn').onclick = async () => {
  if (!confirm(t('t_confirm_logout'))) return;
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  S.user = null; S.role = null;
  toast(t('logout'));
  go('home');
};

async function renderAccount() {
  if (!S.user) return;
  let d;
  try { d = await api('/api/account'); }
  catch { toast(t('e_auth')); S.user = null; go('auth'); return; }
  S.user = d.user;

  $('#meName').textContent = d.user.username;
  $('#meRole').textContent = t('member');
  $('#meAvatar').innerHTML = d.user.avatar ? `<img src="${esc(d.user.avatar)}" alt=""/>` : esc(d.user.username.slice(0, 1).toUpperCase());

  const info = $('#accountInfo');
  info.innerHTML = [
    [t('f_username'), d.user.username], [t('f_email'), d.user.email],
    [t('f_phone'), d.user.phone || '—'], [t('t_status'), t(d.user.status === 'active' ? 't_st_open' : 't_st_closed')],
    [t('t_joined'), fmtDate(d.user.createdAt)], [t('t_total'), money(d.totals.spent)],
    [t('s_orders'), faDigits(d.totals.orders)], [t('s_items'), faDigits(d.totals.items)],
    [t('my_tickets'), faDigits(d.tickets.length)], [t('t_sku'), d.user.id],
  ].map(([k, val]) => `<div class="kv-row"><span>${esc(k)}</span><b>${esc(val)}</b></div>`).join('');

  $('#ordersList').innerHTML = d.orders.length
    ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>${esc(t('t_sku'))}</th><th>${esc(t('all_products'))}</th><th>${esc(t('t_amount'))}</th><th>${esc(t('t_status'))}</th><th>${esc(t('t_date'))}</th></tr></thead>
        <tbody>${d.orders.map((o) => `<tr>
          <td dir="ltr">${esc(o.id.slice(0, 8))}</td><td>${esc(o.itemName)}</td>
          <td>${esc(money(o.price))}</td><td><span class="chip ${esc(o.status)}">${esc(t('t_st_' + o.status))}</span></td>
          <td>${esc(fmtDate(o.createdAt))}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${esc(t('t_no_orders'))}</p>`;

  $('#itemsList').innerHTML = d.purchasedItems.length
    ? `<div class="grid2">${d.purchasedItems.map((it) => `<div class="mini-item">
        <div class="p-visual sm"><div class="neon">${esc(neonText({ name: it.name }))}</div></div>
        <b>${esc(it.name)}</b><small class="muted">${esc(money(it.price))} · ${esc(fmtDate(it.at))}</small></div>`).join('')}</div>`
    : `<p class="muted">${esc(t('t_no_items'))}</p>`;

  $('#ticketList').innerHTML = d.tickets.length
    ? d.tickets.map(ticketBlock).join('')
    : `<p class="muted">${esc(t('t_no_tickets'))}</p>`;

  $('#pUser').value = d.user.username;
  $('#pEmail').value = d.user.email;
  $('#pPhone').value = d.user.phone || '';
}

function ticketBlock(tk) {
  return `<div class="ticket">
    <div class="ticket-head">
      <b>${esc(tk.subject)}</b>
      <span class="chip ${esc(tk.status)}">${esc(t('t_st_' + tk.status))}</span>
    </div>
    <div class="msgs">${(tk.messages || []).map((m) => `
      <div class="msg ${esc(m.from)}">
        <small>${esc(m.from === 'admin' ? t('t_support_agent') : t('t_you'))} · ${esc(fmtDate(m.at))}</small>
        <p>${esc(m.body)}</p>
      </div>`).join('')}</div>
    <div class="ticket-actions">
      <input class="reply-in" data-ticket="${esc(tk.id)}" placeholder="${esc(t('t_reply'))}..." maxlength="4000"/>
      <button class="btn small primary" data-sendreply="${esc(tk.id)}">${esc(t('t_send'))}</button>
      ${tk.status === 'closed'
        ? `<button class="btn small ghost" data-ticketopen="${esc(tk.id)}">${esc(t('t_reopen'))}</button>`
        : `<button class="btn small ghost" data-ticketclose="${esc(tk.id)}">${esc(t('t_close'))}</button>`}
    </div></div>`;
}

$('#ticketSend').onclick = async () => {
  const err = $('#tErr');
  err.textContent = '';
  const subject = $('#tSubject').value.trim();
  const body = $('#tBody').value.trim();
  if (subject.length < 3 || body.length < 10) { err.textContent = t('t_ticket_empty'); return; }
  try {
    await api('/api/tickets', { method: 'POST', body: { subject, body } });
    $('#tSubject').value = ''; $('#tBody').value = '';
    toast(t('t_ticket_sent'));
    await renderAccount();
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};

document.addEventListener('click', async (e) => {
  const send = e.target.closest('[data-sendreply]');
  if (send) {
    const id = send.dataset.sendreply;
    const inp = $(`.reply-in[data-ticket="${CSS.escape(id)}"]`);
    const body = inp.value.trim();
    if (body.length < 2) return;
    try {
      await api(`/api/tickets/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body } });
      await renderAccount();
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
    return;
  }
  const close = e.target.closest('[data-ticketclose]');
  if (close) {
    try {
      await api(`/api/tickets/${encodeURIComponent(close.dataset.ticketclose)}/close`, { method: 'POST', body: {} });
      toast(t('t_st_closed')); await renderAccount();
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
    return;
  }
  const open = e.target.closest('[data-ticketopen]');
  if (open) {
    try {
      await api(`/api/tickets/${encodeURIComponent(open.dataset.ticketopen)}/reopen`, { method: 'POST', body: {} });
      toast(t('t_st_open')); await renderAccount();
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
  }
});

$('#profileSave').onclick = async () => {
  const err = $('#pErr');
  err.textContent = '';
  try {
    const d = await api('/api/account', {
      method: 'PATCH',
      body: { username: $('#pUser').value.trim(), email: $('#pEmail').value.trim(), phone: $('#pPhone').value },
    });
    S.user = d.user;
    toast(t('t_profile_saved'));
    await renderAccount();
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};

$('#passSave').onclick = async () => {
  const err = $('#cErr');
  err.textContent = '';
  try {
    await api('/api/account', {
      method: 'PATCH',
      body: { currentPassword: $('#cPass').value, newPassword: $('#nPass').value },
    });
    $('#cPass').value = ''; $('#nPass').value = '';
    toast(t('t_pass_changed'));
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};

$('#avatarSave').onclick = async () => {
  const err = $('#aErr');
  err.textContent = '';
  const file = $('#avatarInp').files[0];
  if (!file) { err.textContent = t('photo_hint'); return; }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { err.textContent = t('photo_hint'); return; }
  if (file.size > 256 * 1024) { err.textContent = t('photo_hint'); return; }
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result); fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  try {
    const d = await api('/api/account', { method: 'PATCH', body: { avatar: dataUrl } });
    S.user = d.user;
    toast(t('t_profile_saved'));
    await renderAccount();
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};

/* ---------- boot ---------- */
(async function boot() {
  $$('.auth-foot').forEach((f) => {
    f.innerHTML = `<span data-i18n="auth_foot">${esc(t('auth_foot'))}</span> <a href="#/auth" data-tabgo="login" data-i18n="tab_login">${esc(t('tab_login'))}</a>`;
  });
  applyI18n();
  try {
    const me = await api('/api/auth/me');
    S.csrf = me.csrfToken;
    S.user = me.user;
    S.role = me.role;
  } catch { /* server unreachable: stay on public pages */ }
  renderNotifications();
  await router();
})();