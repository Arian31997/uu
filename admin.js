'use strict';
/* Velora Admin Panel — server-authorized. No credentials stored here. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- i18n ---------- */
let lang = localStorage.getItem('velora_lang') || 'fa';
if (!I18N[lang]) lang = 'fa';
const t = (k) => (I18N[lang] && I18N[lang][k]) ?? (I18N.fa[k] ?? k);
const money = (n) => (lang === 'fa' ? Number(n).toLocaleString('fa-IR') : Number(n).toLocaleString('en-US')) + ' ' + t('t_irr');
const faDigits = (s) => (lang === 'fa' ? String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(s));
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB',
      { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return '—'; }
}
function applyI18n() {
  const cfg = I18N[lang];
  document.documentElement.lang = cfg.lang;
  document.documentElement.dir = cfg.dir;
  document.body.classList.toggle('ltr', cfg.dir === 'ltr');
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('#langSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  if (isAdmin) renderAll();
}
$('#langSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lang]');
  if (!b) return;
  lang = I18N[b.dataset.lang] ? b.dataset.lang : 'fa';
  localStorage.setItem('velora_lang', lang);
  applyI18n();
});

function toast(m) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = m;
  $('#toasts').append(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
}

/* ---------- api ---------- */
let csrf = null;
let isAdmin = false;
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (data.csrfToken) csrf = data.csrfToken;
  if (res.status === 401 && isAdmin) { setLoggedOut(); }
  if (!res.ok) {
    const e = new Error((data.error && data.error.message) || 'Request failed');
    e.code = data.error && data.error.code;
    e.status = res.status;
    throw e;
  }
  return data;
}
function friendly(e, fallback) {
  const map = {
    invalid_credentials: t('e_cred'), invalid_email: t('e_email'), weak_password: t('e_pass'),
    email_taken: t('e_email_taken'), too_many_attempts: t('e_throttle'),
    forbidden: t('e_forbidden'), unauthorized: t('e_auth'), csrf_invalid: t('e_csrf'),
    invalid_name: t('e_generic'), invalid_price: t('e_generic'), invalid_stock: t('e_generic'),
    image_too_large: t('img_hint'), invalid_image: t('img_hint'),
  };
  return map[e.code] || e.message || fallback;
}

/* ---------- auth gate ---------- */
function setLoggedIn(email) {
  isAdmin = true;
  $('#loginView').classList.add('hidden');
  $('#panelView').classList.remove('hidden');
  $('#adminEmail').textContent = email;
  localStorage.setItem('velora_admin_hint', '1');
}
function setLoggedOut() {
  isAdmin = false;
  localStorage.removeItem('velora_admin_hint');
  $('#panelView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
  $('#aPass').value = '';
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#aErr');
  err.textContent = '';
  const email = $('#aEmail').value.trim();
  const password = $('#aPass').value;
  if (!email || !password) { err.textContent = t('e_fields'); return; }
  const btn = $('#loginForm button[type=submit]');
  btn.disabled = true;
  try {
    const d = await api('/api/admin/login', { method: 'POST', body: { email, password } });
    setLoggedIn(d.email);
    await renderAll();
  } catch (ex) {
    err.textContent = friendly(ex, t('e_generic'));
  } finally { btn.disabled = false; }
});

$('#logoutBtn').onclick = async () => {
  if (!confirm(t('t_confirm_logout'))) return;
  try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  setLoggedOut();
};

/* ---------- tabs ---------- */
$$('.side-btn[data-tab]').forEach((b) => {
  b.onclick = () => {
    $$('.side-btn[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('.apane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
    $('#ticketDetail').classList.add('hidden');
  };
});

/* ---------- data ---------- */
let stats = null, orders = [], tickets = [], products = [], users = [];

async function loadStats() {
  try { stats = await api('/api/admin/stats'); } catch { stats = null; }
}
async function loadOrders(status) {
  const d = await api('/api/admin/orders' + (status && status !== 'all' ? '?status=' + status : ''));
  orders = d.orders;
}
async function loadTickets(status) {
  const d = await api('/api/admin/tickets' + (status && status !== 'all' ? '?status=' + status : ''));
  tickets = d.tickets;
}
async function loadProducts() {
  const d = await api('/api/products');
  products = d.products;
}
async function loadUsers() {
  const d = await api('/api/admin/users');
  users = d.users;
}

async function renderAll() {
  if (!isAdmin) return;
  await Promise.all([loadStats(), loadOrders(), loadTickets(), loadProducts()]);
  renderStats(); renderOrders(); renderTickets(); renderProducts();
  $('#badgeTickets').textContent = faDigits(stats ? stats.openTickets : 0);
  $('#badgeOrders').textContent = faDigits(stats ? stats.orders : 0);
  if ($('#pane-users').classList.contains('active')) { await loadUsers(); renderUsers(); }
}

/* stats */
function renderStats() {
  if (!stats) return;
  const s = stats;
  const cards = [
    ['&#128101;', t('a_users'), faDigits(s.users), t('t_st_open') + ': ' + faDigits(s.activeUsers)],
    ['&#127873;', t('a_items'), faDigits(s.products), t('t_st_open') + ': ' + faDigits(s.enabledProducts) + ' / ' + t('t_out_of_stock') + ': ' + faDigits(s.outOfStock)],
    ['&#128230;', t('a_orders'), faDigits(s.orders), t('t_total') + ': ' + money(s.revenue)],
    ['&#128172;', t('a_tickets'), faDigits(s.tickets), t('t_st_open') + ': ' + faDigits(s.openTickets) + ' / ' + t('t_st_pending') + ': ' + faDigits(s.pendingTickets)],
    ['&#128274;', t('a_session'), faDigits(s.activeSessions), t('t_joined') + ': ' + fmtDate(s.lastLoginAt)],
  ];
  $('#statCards').innerHTML = cards.map(([ico, label, val, sub]) => `<div class="card stat">
    <div class="f-ico">${ico}</div><h4>${esc(label)}</h4><div class="big">${esc(val)}</div>
    <small class="muted">${esc(sub)}</small></div>`).join('');

  $('#recentOrders').innerHTML = orders.slice(0, 5).map(orderRow).join('') || `<p class="muted">${esc(t('t_no_data'))}</p>`;
  $('#recentTickets').innerHTML = tickets.slice(0, 5).map(ticketRow).join('') || `<p class="muted">${esc(t('t_no_data'))}</p>`;
}

/* orders */
function orderRow(o) {
  return `<div class="lrow">
    <div class="lrow-main">
      <b>${esc(o.itemName)}</b>
      <small class="muted">${esc(o.username)} &lt;${esc(o.email)}&gt; &middot; ${esc(fmtDate(o.createdAt))} &middot; ${esc(money(o.price))}</small>
    </div>
    <div class="lrow-side">
      <span class="chip ${esc(o.status)}">${esc(t('t_st_' + o.status))}</span>
      <select data-orderstatus="${esc(o.id)}">
        ${['paid', 'processing', 'completed', 'cancelled', 'refunded'].map((s) =>
          `<option value="${s}" ${s === o.status ? 'selected' : ''}>${esc(t('t_st_' + s))}</option>`).join('')}
      </select>
    </div></div>`;
}
function renderOrders() {
  $('#adminOrderList').innerHTML = orders.length
    ? orders.map(orderRow).join('')
    : `<p class="muted">${esc(t('t_no_data'))}</p>`;
}
$('#oFilter').onchange = async (e) => { await loadOrders(e.target.value); renderOrders(); };

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-orderstatus]');
  if (!sel) return;
  const id = sel.dataset.orderstatus;
  if (!confirm(t('a_confirm_status'))) { await loadOrders(); renderOrders(); return; }
  try {
    const d = await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: sel.value } });
    const i = orders.findIndex((x) => x.id === d.order.id);
    if (i >= 0) orders[i] = d.order;
    toast(t('a_saved'));
    await Promise.all([loadStats(), loadProducts()]);
    renderStats(); renderProducts();
  } catch (ex) {
    toast(friendly(ex, t('e_generic')));
    await loadOrders();
    renderOrders();
  }
});

/* tickets */
function ticketRow(tk) {
  return `<div class="lrow clickable" data-ticket="${esc(tk.id)}">
    <div class="lrow-main">
      <b>${esc(tk.subject)}</b>
      <small class="muted">${esc(tk.username)} &lt;${esc(tk.email)}&gt; &middot; ${esc(fmtDate(tk.updatedAt))} &middot; ${esc(faDigits((tk.messages || []).length))}</small>
    </div>
    <span class="chip ${esc(tk.status)}">${esc(t('t_st_' + tk.status))}</span></div>`;
}
function renderTickets() {
  $('#adminTicketList').innerHTML = tickets.length
    ? tickets.map(ticketRow).join('')
    : `<p class="muted">${esc(t('t_no_data'))}</p>`;
}
$('#tFilter').onchange = async (e) => { await loadTickets(e.target.value); renderTickets(); };

document.addEventListener('click', async (e) => {
  const row = e.target.closest('[data-ticket]');
  if (!row || e.target.closest('select,button,input,textarea')) return;
  await openTicket(row.dataset.ticket);
});

async function openTicket(id) {
  let d;
  try { d = await api(`/api/admin/tickets/${encodeURIComponent(id)}`); } catch { return toast(friendly({}, t('e_generic'))); }
  const tk = d.ticket;
  const box = $('#ticketDetail');
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="store-head">
      <h3>${esc(tk.subject)}</h3>
      <div class="row-inline">
        <select id="tkStatus">
          ${['open', 'pending', 'closed'].map((s) => `<option value="${s}" ${s === tk.status ? 'selected' : ''}>${esc(t('t_st_' + s))}</option>`).join('')}
        </select>
        <button class="btn small ghost" id="tkClose">&#215;</button>
      </div>
    </div>
    <p class="muted">${esc(tk.username)} &lt;${esc(tk.email)}&gt; &middot; ${esc(fmtDate(tk.createdAt))} &middot; <span class="chip ${esc(tk.status)}">${esc(t('t_st_' + tk.status))}</span></p>
    <div class="msgs">${(tk.messages || []).map((m) => `<div class="msg ${esc(m.from)}">
      <small>${esc(m.from === 'admin' ? t('t_admin') : tk.username)} · ${esc(fmtDate(m.at))}</small>
      <p>${esc(m.body)}</p></div>`).join('')}</div>
    <label><span>${esc(t('t_reply'))}</span><textarea id="tkReply" rows="3" maxlength="4000"></textarea></label>
    <button class="btn primary" id="tkSend">${esc(t('t_send'))}</button>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  $('#tkClose').onclick = () => box.classList.add('hidden');
  $('#tkStatus').onchange = async (ev) => {
    if (!confirm(t('a_confirm_status'))) { await loadTickets($('#tFilter').value); return openTicket(id); }
    try {
      await api(`/api/admin/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: ev.target.value } });
      toast(t('a_saved'));
      await Promise.all([loadTickets($('#tFilter').value), loadStats()]);
      renderTickets(); renderStats();
      openTicket(id);
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
  };
  $('#tkSend').onclick = async () => {
    const body = $('#tkReply').value.trim();
    if (body.length < 2) return;
    if (!confirm(t('a_confirm_reply'))) return;
    try {
      await api(`/api/admin/tickets/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body } });
      $('#tkReply').value = '';
      toast(t('a_saved'));
      await Promise.all([loadTickets($('#tFilter').value), loadStats()]);
      renderTickets(); renderStats();
      openTicket(id);
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
  };
}

/* products */
let editingId = null;
function productRow(p) {
  return `<div class="lrow">
    <div class="lrow-main">
      <b>${esc(p.name)}</b>
      <small class="muted">${esc(p.cat)} · ${esc(p.rare)} · ${esc(money(p.price))} · ${esc(t('t_stock'))}: ${esc(faDigits(p.stock))} ${p.available ? '' : '(' + esc(t('t_unavailable')) + ')'}</small>
    </div>
    <div class="lrow-side">
      <span class="chip ${p.available ? 'completed' : 'cancelled'}">${esc(p.available ? t('t_left') + ' ' + faDigits(p.stock) : t('t_out_of_stock'))}</span>
      <button class="btn small ghost" data-pedit="${esc(p.id)}">${esc(t('a_edit'))}</button>
      <button class="btn small ghost" data-ptoggle="${esc(p.id)}" data-enabled="${p.available ? '1' : '0'}">${esc(p.available ? t('t_unavailable') : t('t_st_open'))}</button>
      <button class="btn small ghost danger" data-pdel="${esc(p.id)}">${esc(t('a_delete'))}</button>
    </div></div>`;
}
function renderProducts() {
  $('#adminProductList').innerHTML = products.length
    ? products.map(productRow).join('')
    : `<p class="muted">${esc(t('t_no_data'))}</p>`;
}

function fillForm(p) {
  editingId = p.id;
  $('#pfName').value = p.name;
  $('#pfCat').value = p.cat;
  $('#pfDesc').value = p.description;
  $('#pfPrice').value = p.price;
  $('#pfStock').value = p.stock;
  $('#pfRare').value = p.rare;
  $('#pfImage').value = '';
  $('#pfCancel').classList.remove('hidden');
  $('#pfErr').textContent = '';
  $('#productForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetForm() {
  editingId = null;
  $('#productForm').reset();
  $('#pfStock').value = '1';
  $('#pfCancel').classList.add('hidden');
  $('#pfErr').textContent = '';
}
$('#pfCancel').onclick = resetForm;

async function readImage(input, maxBytes) {
  const file = input.files[0];
  if (!file) return '';
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('img');
  if (file.size > maxBytes) throw new Error('big');
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

$('#productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#pfErr');
  err.textContent = '';
  const payload = {
    name: $('#pfName').value.trim(),
    cat: $('#pfCat').value,
    description: $('#pfDesc').value.trim(),
    price: $('#pfPrice').value,
    stock: $('#pfStock').value,
    rare: $('#pfRare').value,
    enabled: true,
  };
  if (payload.name.length < 3) return err.textContent = t('a_item_name');
  if (payload.description.length < 3) return err.textContent = t('a_item_desc');
  if (!/^\d+$/.test(String(payload.price)) || Number(payload.price) < 1) return err.textContent = t('t_price');
  if (!/^\d+$/.test(String(payload.stock))) return err.textContent = t('t_stock');
  try {
    const img = await readImage($('#pfImage'), 512 * 1024);
    if (img) payload.image = img;
    if (editingId) await api(`/api/admin/products/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: payload });
    else await api('/api/admin/products', { method: 'POST', body: payload });
    resetForm();
    toast(t('a_saved'));
    await Promise.all([loadProducts(), loadStats()]);
    renderProducts(); renderStats();
  } catch (ex) {
    err.textContent = ex.message === 'img' || ex.message === 'big' ? t('img_hint') : friendly(ex, t('e_generic'));
  }
});

document.addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-pedit]');
  if (edit) {
    const p = products.find((x) => x.id === edit.dataset.pedit);
    if (p) fillForm({
      id: p.id, name: p.name, cat: p.cat, description: p.description,
      price: p.price, stock: p.stock, rare: p.rare,
    });
    return;
  }
  const toggle = e.target.closest('[data-ptoggle]');
  if (toggle) {
    const id = toggle.dataset.ptoggle;
    const p = products.find((x) => x.id === id);
    try {
      const d = await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled: toggle.dataset.enabled === '1' ? false : true } });
      const i = products.findIndex((x) => x.id === d.product.id);
      if (i >= 0) products[i] = d.product;
      toast(t('a_saved'));
      await loadStats(); renderStats(); renderProducts();
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
    return;
  }
  const del = e.target.closest('[data-pdel]');
  if (del) {
    if (!confirm(t('a_confirm_del'))) return;
    const id = del.dataset.pdel;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      products = products.filter((x) => x.id !== id);
      toast(t('a_saved'));
      await loadStats(); renderStats(); renderProducts();
    } catch (ex) { toast(friendly(ex, t('e_generic'))); }
  }
});

/* users */
function renderUsers() {
  $('#adminUserList').innerHTML = users.length
    ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>${esc(t('f_username'))}</th><th>${esc(t('f_email'))}</th><th>${esc(t('f_phone'))}</th><th>${esc(t('a_orders_count'))}</th><th>${esc(t('t_status'))}</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td>${esc(u.username)}</td><td dir="ltr">${esc(u.email)}</td><td dir="ltr">${esc(u.phone || '—')}</td>
        <td>${esc(faDigits(u.orders))}</td>
        <td><span class="chip ${u.status === 'active' ? 'completed' : 'cancelled'}">${esc(u.status === 'active' ? t('t_st_open') : t('t_banned'))}</span></td>
        <td><button class="btn small ghost ${u.status === 'active' ? 'danger' : ''}" data-usertoggle="${esc(u.id)}" data-status="${esc(u.status)}">${esc(u.status === 'active' ? t('a_ban') : t('a_unban'))}</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : `<p class="muted">${esc(t('t_no_data'))}</p>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-usertoggle]');
  if (!b) return;
  if (!confirm(t('a_confirm_status'))) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(b.dataset.usertoggle)}`, {
      method: 'PATCH', body: { status: b.dataset.status === 'active' ? 'banned' : 'active' },
    });
    toast(t('a_saved'));
    await loadUsers(); await loadStats();
    renderUsers(); renderStats();
  } catch (ex) { toast(friendly(ex, t('e_generic'))); }
});

/* settings */
$('#stEmailSave').onclick = async () => {
  const err = $('#stErr');
  err.textContent = '';
  try {
    const d = await api('/api/admin/settings', { method: 'PATCH', body: { email: $('#stEmail').value.trim() } });
    $('#adminEmail').textContent = d.email;
    $('#stEmail').value = d.email;
    toast(t('a_saved'));
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};
$('#stPassSave').onclick = async () => {
  const err = $('#spErr');
  err.textContent = '';
  try {
    await api('/api/admin/settings', { method: 'PATCH', body: { currentPassword: $('#stCur').value, newPassword: $('#stNew').value } });
    $('#stCur').value = ''; $('#stNew').value = '';
    toast(t('t_pass_changed'));
  } catch (ex) { err.textContent = friendly(ex, t('e_generic')); }
};

/* session expiry watchdog */
let lastPing = Date.now();
setInterval(async () => {
  if (!isAdmin) return;
  if (document.hidden) return;
  try {
    const d = await api('/api/admin/stats');
    stats = d;
    $('#sessionInfo').textContent = t('a_session') + ': ' + fmtDate(new Date().toISOString());
  } catch (e) {
    if (e.code === 'unauthorized' || e.code === 'forbidden') setLoggedOut();
  }
}, 60_000);

/* ---------- boot ---------- */
(async function boot() {
  applyI18n();
  try {
    const d = await api('/api/auth/me');
    csrf = d.csrfToken;
    if (d.role === 'admin') {
      setLoggedIn('admin');
      $('#stEmail').value = '';
      await renderAll();
      $('#sessionInfo').textContent = t('a_session');
    }
  } catch { /* not admin / server down */ }
})();