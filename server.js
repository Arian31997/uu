'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const seed = require('./lib/seed');
const v = require('./lib/validate');
const cryptoLib = require('./lib/crypto');
const auth = require('./lib/auth');
const H = require('./lib/http');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const MAX_BODY = 900 * 1024;

seed.bootstrap();
const db = store.db();

// ---------------- helpers ----------------
const publicProduct = (p) => ({
  id: p.id, name: p.name, description: p.description, cat: p.cat,
  price: p.price, rare: p.rare, image: p.image, createdAt: p.createdAt,
  stock: p.enabled ? Math.max(0, (p.stock ?? 0) - (p.sold || 0)) : 0,
  available: !!p.enabled && (p.stock ?? 0) > (p.sold || 0),
});

const publicOrder = (o) => ({
  id: o.id, itemName: o.itemName, itemId: o.itemId, price: o.price,
  status: o.status, createdAt: o.createdAt, userId: o.userId,
  username: o.username || '', email: o.email || '',
});

const publicTicket = (t, { includeUser = false } = {}) => {
  const base = {
    id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt,
    updatedAt: t.updatedAt, userId: t.userId,
    messages: (t.messages || []).map((m) => ({ id: m.id, from: m.from, body: m.body, at: m.at })),
  };
  if (includeUser) Object.assign(base, { username: t.username || '', email: t.email || '' });
  return base;
};

function userStats(userId) {
  const orders = db.orders.filter((o) => o.userId === userId);
  const tickets = db.tickets.filter((t) => t.userId === userId);
  return {
    orders: orders.map(publicOrder).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tickets: tickets.map((t) => publicTicket(t)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    totals: {
      orders: orders.length,
      spent: orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.price, 0),
      items: orders.filter((o) => o.status === 'completed').length,
      openTickets: tickets.filter((t) => t.status === 'open').length,
    },
  };
}

// ---------------- routes ----------------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const rx = new RegExp(
    '^' + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  routes.push({ method, rx, keys, handler, ...opts });
};

// ============ AUTH ============
route('POST', '/api/auth/register', async (ctx) => {
  const b = ctx.body;
  // Validate first: malformed input must not consume the rate-limit budget.
  const username = v.username(b.username);
  const password = v.password(b.password);
  const email = v.email(b.email);
  const phone = v.phone(b.phone);
  auth.throttle('register:' + ctx.ip, 20, 15 * 60_000);
  const dbNow = db;
  if (dbNow.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw H.err(409, 'username_taken', 'This username is already taken');
  }
  if (dbNow.users.some((u) => u.email === email)) {
    throw H.err(409, 'email_taken', 'This email is already registered');
  }
  const user = {
    id: store.uid('u'), username, email, phone,
    passHash: cryptoLib.hashPassword(password),
    avatar: '', discord: '', steam: '',
    role: 'user', status: 'active', createdAt: store.nowISO(), lastLoginAt: store.nowISO(),
  };
  dbNow.users.push(user);
  const session = auth.createSession(dbNow, { userId: user.id, role: 'user' });
  ctx.setSession(session);
  return { user: auth.publicUser(user), stats: userStats(user.id) };
}, { csrf: true });

route('POST', '/api/auth/login', async (ctx) => {
  const identifier = v.str(ctx.body.identifier, { field: 'identifier', min: 3, max: 160 }).toLowerCase();
  const password = String(ctx.body.password || '');
  auth.throttle('login:' + ctx.ip, 25, 10 * 60_000);
  let user = db.users.find((u) => u.username.toLowerCase() === identifier || u.email === identifier);
  let ok = user ? cryptoLib.verifyPassword(password, user.passHash) : false;
  if (!ok) {
    // Uniform failure: never reveal whether the account exists.
    throw H.err(401, 'invalid_credentials', 'Incorrect username or password');
  }
  if (user.status === 'banned') throw H.err(403, 'account_banned', 'This account is suspended');
  user.lastLoginAt = store.nowISO();
  store.save(db);
  const session = auth.createSession(db, { userId: user.id, role: 'user' });
  ctx.setSession(session);
  return { user: auth.publicUser(user), stats: userStats(user.id) };
}, { csrf: true, throttle: { key: 'login-global', max: 300, windowMs: 10 * 60_000 } });

route('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.session) auth.destroySession(db, ctx.session.id);
  ctx.clearSession();
  return { ok: true };
}, { csrf: true });

route('GET', '/api/auth/me', async (ctx) => {
  if (!ctx.user) return { user: null, role: null, stats: null, csrfToken: ctx.ensureCsrf() };
  if (ctx.role === 'admin') return { user: null, role: 'admin', csrfToken: ctx.ensureCsrf() };
  return { user: auth.publicUser(ctx.user), role: 'user', stats: userStats(ctx.user.id), csrfToken: ctx.ensureCsrf() };
});

route('PATCH', '/api/account', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const b = ctx.body;
  if (b.username != null) {
    const username = v.username(b.username);
    if (username.toLowerCase() !== user.username.toLowerCase() &&
        db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw H.err(409, 'username_taken', 'This username is already taken');
    }
    user.username = username;
  }
  if (b.email != null) {
    const email = v.email(b.email);
    if (email !== user.email && db.users.some((u) => u.email === email)) {
      throw H.err(409, 'email_taken', 'This email is already registered');
    }
    user.email = email;
  }
  if (b.phone != null) user.phone = v.phone(b.phone);
  if (b.discord != null) user.discord = v.str(b.discord, { field: 'discord', max: 80 });
  if (b.steam != null) user.steam = v.str(b.steam, { field: 'steam', max: 120 });
  if (b.avatar != null) {
    user.avatar = b.avatar === '' ? '' : v.imageDataUrl(b.avatar, { field: 'avatar', maxBytes: 256 * 1024 }).dataUrl;
  }
  if (b.newPassword != null) {
    const current = String(b.currentPassword || '');
    if (!cryptoLib.verifyPassword(current, user.passHash)) {
      throw H.err(401, 'invalid_credentials', 'Current password is incorrect');
    }
    user.passHash = cryptoLib.hashPassword(v.password(b.newPassword));
  }
  store.save(db);
  return { user: auth.publicUser(user) };
}, { csrf: true });

// ============ STORE ============
route('GET', '/api/products', async (ctx) => {
  const q = ctx.query;
  let list = db.products.map(publicProduct);
  const cat = q.get('cat');
  if (cat && cat !== 'all') list = list.filter((p) => p.cat === cat);
  const search = (q.get('search') || '').trim().toLowerCase();
  if (search) list = list.filter((p) => (p.name + ' ' + p.description).toLowerCase().includes(search));
  const min = q.get('min'); const max = q.get('max');
  if (min) list = list.filter((p) => p.price >= Number(min));
  if (max) list = list.filter((p) => p.price <= Number(max));
  const sort = q.get('sort') || 'new';
  if (sort === 'cheap') list.sort((a, b) => a.price - b.price);
  else if (sort === 'expensive') list.sort((a, b) => b.price - a.price);
  else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { products: list, total: list.length };
});

route('GET', '/api/products/:id', async (ctx) => {
  const p = db.products.find((x) => x.id === ctx.params.id);
  if (!p) throw H.err(404, 'not_found', 'Item not found');
  return { product: publicProduct(p) };
});

route('POST', '/api/orders', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const itemId = v.id(ctx.body.itemId);
  const p = db.products.find((x) => x.id === itemId);
  if (!p) throw H.err(404, 'not_found', 'Item not found');
  if (!p.enabled) throw H.err(409, 'item_disabled', 'This item is currently unavailable');
  if ((p.stock ?? 0) <= (p.sold || 0)) throw H.err(409, 'out_of_stock', 'This item is out of stock');
  p.sold = (p.sold || 0) + 1;
  const order = {
    id: store.uid('o'),
    itemId: p.id, itemName: p.name, price: p.price,
    status: 'paid',
    userId: user.id, username: user.username, email: user.email,
    createdAt: store.nowISO(),
  };
  db.orders.push(order);
  store.save(db);
  return { order: publicOrder(order), stats: userStats(user.id) };
}, { csrf: true, throttle: { key: 'order', max: 20, windowMs: 60_000 } });

// ============ TICKETS (user) ============
route('GET', '/api/tickets', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  return {
    tickets: db.tickets.filter((t) => t.userId === user.id)
      .map((t) => publicTicket(t))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
});

route('GET', '/api/tickets/:id', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t || t.userId !== user.id) throw H.err(404, 'not_found', 'Ticket not found');
  return { ticket: publicTicket(t) };
});

route('POST', '/api/tickets', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const subject = v.str(ctx.body.subject, { field: 'subject', min: 3, max: 120 });
  const body = v.str(ctx.body.body, { field: 'body', min: 10, max: 4000 });
  const t = {
    id: store.uid('t'), userId: user.id, username: user.username, email: user.email,
    subject, status: 'open', createdAt: store.nowISO(), updatedAt: store.nowISO(),
    messages: [{ id: store.uid('m'), from: 'user', body, at: store.nowISO() }],
  };
  db.tickets.push(t);
  store.save(db);
  return { ticket: publicTicket(t), stats: userStats(user.id) };
}, { csrf: true, throttle: { key: 'ticket', max: 10, windowMs: 10 * 60_000 } });

route('POST', '/api/tickets/:id/reply', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t || t.userId !== user.id) throw H.err(404, 'not_found', 'Ticket not found');
  const body = v.str(ctx.body.body, { field: 'body', min: 2, max: 4000 });
  t.messages.push({ id: store.uid('m'), from: 'user', body, at: store.nowISO() });
  t.updatedAt = store.nowISO();
  if (t.status === 'closed') t.status = 'open';
  store.save(db);
  return { ticket: publicTicket(t) };
}, { csrf: true, throttle: { key: 'treply', max: 30, windowMs: 10 * 60_000 } });

route('POST', '/api/tickets/:id/reopen', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t || t.userId !== user.id) throw H.err(404, 'not_found', 'Ticket not found');
  if (t.status !== 'closed') throw H.err(409, 'invalid_status', 'Ticket is not closed');
  t.status = 'open';
  t.updatedAt = store.nowISO();
  store.save(db);
  return { ticket: publicTicket(t) };
}, { csrf: true });

route('POST', '/api/tickets/:id/close', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t || t.userId !== user.id) throw H.err(404, 'not_found', 'Ticket not found');
  t.status = 'closed';
  t.updatedAt = store.nowISO();
  store.save(db);
  return { ticket: publicTicket(t) };
}, { csrf: true });

// ============ ACCOUNT ============
route('GET', '/api/account', async (ctx) => {
  const user = auth.requireAuth(ctx.req);
  const s = userStats(user.id);
  return {
    user: auth.publicUser(user),
    totals: s.totals,
    orders: s.orders,
    tickets: s.tickets,
    purchasedItems: s.orders.filter((o) => o.status === 'completed').map((o) => ({ id: o.id, name: o.itemName, price: o.price, at: o.createdAt })),
    session: { expiresAt: ctx.session.expiresAt },
  };
});

// ============ ADMIN ============
route('POST', '/api/admin/login', async (ctx) => {
  auth.throttle('adminlogin:' + ctx.ip, 8, 15 * 60_000);
  const email = v.email(ctx.body.email);
  const password = String(ctx.body.password || '');
  if (!db.admin || !cryptoLib.verifyPassword(password, db.admin.passHash) ||
      email !== db.admin.email) {
    throw H.err(401, 'invalid_credentials', 'Incorrect email or password');
  }
  db.admin.lastLoginAt = store.nowISO();
  store.save(db);
  const session = auth.createSession(db, { userId: db.admin.id, role: 'admin' });
  ctx.setSession(session);
  return { role: 'admin', email: db.admin.email };
}, { csrf: true, throttle: { key: 'adminlogin-global', max: 40, windowMs: 15 * 60_000 } });

route('POST', '/api/admin/logout', async (ctx) => {
  auth.requireAdmin(ctx.req);
  auth.destroySession(db, ctx.session.id);
  ctx.clearSession();
  return { ok: true };
}, { csrf: true });

route('GET', '/api/admin/stats', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const revenue = db.orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.price, 0);
  return {
    users: db.users.length,
    activeUsers: db.users.filter((u) => u.status === 'active').length,
    products: db.products.length,
    enabledProducts: db.products.filter((p) => p.enabled).length,
    outOfStock: db.products.filter((p) => p.enabled && (p.stock || 0) <= (p.sold || 0)).length,
    orders: db.orders.length,
    revenue,
    tickets: db.tickets.length,
    openTickets: db.tickets.filter((t) => t.status === 'open').length,
    pendingTickets: db.tickets.filter((t) => t.status === 'pending').length,
    activeSessions: db.sessions.filter((s) => s.expiresAt > Date.now()).length,
    lastLoginAt: db.admin.lastLoginAt,
  };
});

// -- admin tickets --
route('GET', '/api/admin/tickets', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const status = ctx.query.get('status');
  let list = [...db.tickets];
  if (status && status !== 'all') list = list.filter((t) => t.status === status);
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { tickets: list.map((t) => publicTicket(t, { includeUser: true })) };
});

route('GET', '/api/admin/tickets/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t) throw H.err(404, 'not_found', 'Ticket not found');
  return { ticket: publicTicket(t, { includeUser: true }) };
});

route('POST', '/api/admin/tickets/:id/reply', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t) throw H.err(404, 'not_found', 'Ticket not found');
  const body = v.str(ctx.body.body, { field: 'body', min: 2, max: 4000 });
  t.messages.push({ id: store.uid('m'), from: 'admin', body, at: store.nowISO() });
  t.updatedAt = store.nowISO();
  if (t.status === 'open') t.status = 'pending';
  store.save(db);
  return { ticket: publicTicket(t, { includeUser: true }) };
}, { csrf: true });

route('PATCH', '/api/admin/tickets/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const t = db.tickets.find((x) => x.id === ctx.params.id);
  if (!t) throw H.err(404, 'not_found', 'Ticket not found');
  const status = v.oneOf(ctx.body.status, ['open', 'pending', 'closed'], 'status');
  t.status = status;
  t.updatedAt = store.nowISO();
  store.save(db);
  return { ticket: publicTicket(t, { includeUser: true }) };
}, { csrf: true });

// -- admin orders --
route('GET', '/api/admin/orders', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const status = ctx.query.get('status');
  let list = [...db.orders];
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { orders: list.map(publicOrder) };
});

route('GET', '/api/admin/orders/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const o = db.orders.find((x) => x.id === ctx.params.id);
  if (!o) throw H.err(404, 'not_found', 'Order not found');
  return { order: publicOrder(o) };
});

route('PATCH', '/api/admin/orders/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const o = db.orders.find((x) => x.id === ctx.params.id);
  if (!o) throw H.err(404, 'not_found', 'Order not found');
  const next = v.oneOf(ctx.body.status, ['paid', 'processing', 'completed', 'cancelled', 'refunded'], 'status');
  if (next === 'cancelled' && o.status !== 'cancelled') {
    const p = db.products.find((x) => x.id === o.itemId);
    if (p && o.status !== 'refunded') p.sold = Math.max(0, (p.sold || 0) - 1);
  }
  if (o.status === 'cancelled' && next !== 'cancelled' && next !== 'refunded') {
    const p = db.products.find((x) => x.id === o.itemId);
    if (p) p.sold = (p.sold || 0) + 1;
  }
  o.status = next;
  store.save(db);
  return { order: publicOrder(o) };
}, { csrf: true });

// -- admin products --
route('POST', '/api/admin/products', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const b = ctx.body;
  const image = b.image ? v.imageDataUrl(b.image, { field: 'image' }) : null;
  const p = {
    id: store.uid('p'),
    name: v.str(b.name, { field: 'name', min: 3, max: 80 }),
    description: v.str(b.description, { field: 'description', min: 3, max: 500 }),
    cat: v.oneOf(b.cat || 'other', ['plate', 'phone', 'other'], 'cat'),
    price: v.int(b.price, { field: 'price', min: 1, max: 100_000_000 }),
    rare: v.oneOf(b.rare || 'RARE', ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'], 'rare'),
    stock: v.int(b.stock ?? 1, { field: 'stock', min: 0, max: 100_000 }),
    sold: 0,
    enabled: v.bool(b.enabled, true) ? 1 : 0,
    image: image ? image.dataUrl : '',
    createdAt: store.nowISO(),
  };
  db.products.push(p);
  store.save(db);
  return { product: publicProduct(p) };
}, { csrf: true });

route('PATCH', '/api/admin/products/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const p = db.products.find((x) => x.id === ctx.params.id);
  if (!p) throw H.err(404, 'not_found', 'Item not found');
  const b = ctx.body;
  if (b.name != null) p.name = v.str(b.name, { field: 'name', min: 3, max: 80 });
  if (b.description != null) p.description = v.str(b.description, { field: 'description', min: 3, max: 500 });
  if (b.cat != null) p.cat = v.oneOf(b.cat, ['plate', 'phone', 'other'], 'cat');
  if (b.price != null) p.price = v.int(b.price, { field: 'price', min: 1, max: 100_000_000 });
  if (b.rare != null) p.rare = v.oneOf(b.rare, ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'], 'rare');
  if (b.stock != null) {
    p.stock = v.int(b.stock, { field: 'stock', min: 0, max: 100_000 });
    if (p.sold > p.stock) p.sold = p.stock;
  }
  if (b.enabled != null) p.enabled = v.bool(b.enabled) ? 1 : 0;
  if (b.image != null) p.image = b.image === '' ? '' : v.imageDataUrl(b.image, { field: 'image' }).dataUrl;
  store.save(db);
  return { product: publicProduct(p) };
}, { csrf: true });

route('DELETE', '/api/admin/products/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const id = ctx.params.id;
  const p = db.products.find((x) => x.id === id);
  if (!p) throw H.err(404, 'not_found', 'Item not found');
  db.products = db.products.filter((x) => x.id !== id);
  store.save(db);
  return { ok: true, id };
}, { csrf: true });

// -- admin users --
route('GET', '/api/admin/users', async (ctx) => {
  auth.requireAdmin(ctx.req);
  return { users: db.users.map((u) => ({ ...auth.publicUser(u), orders: db.orders.filter((o) => o.userId === u.id).length })) };
});

route('PATCH', '/api/admin/users/:id', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const u = db.users.find((x) => x.id === ctx.params.id);
  if (!u) throw H.err(404, 'not_found', 'User not found');
  if (ctx.body.status != null) u.status = v.oneOf(ctx.body.status, ['active', 'banned'], 'status');
  if (ctx.body.role != null) {
    const role = v.oneOf(ctx.body.role, ['user'], 'role');
    u.role = role;
  }
  store.save(db);
  if (u.status === 'banned') {
    db.sessions = db.sessions.filter((s) => s.userId !== u.id);
    store.save(db);
  }
  return { user: auth.publicUser(u) };
}, { csrf: true });

route('PATCH', '/api/admin/settings', async (ctx) => {
  auth.requireAdmin(ctx.req);
  const b = ctx.body;
  if (b.email != null) {
    const email = v.email(b.email);
    if (email !== db.admin.email && db.users.some((u) => u.email === email)) {
      throw H.err(409, 'email_taken', 'A user already uses this email');
    }
    db.admin.email = email;
  }
  if (b.newPassword != null) {
    const current = String(b.currentPassword || '');
    if (!cryptoLib.verifyPassword(current, db.admin.passHash)) {
      throw H.err(401, 'invalid_credentials', 'Current password is incorrect');
    }
    db.admin.passHash = cryptoLib.hashPassword(v.password(b.newPassword));
    // Invalidate every other session.
    const keep = ctx.session.id;
    db.sessions = db.sessions.filter((s) => s.id === keep || s.role !== 'admin');
  }
  store.save(db);
  return { email: db.admin.email, emailChanged: b.email != null, passwordChanged: b.newPassword != null };
}, { csrf: true });

// ---------------- static files ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

// Server-side files that must never be reachable over HTTP.
const DENY = new Set(['server.js', 'package.json', 'package-lock.json', '.gitignore', '.env']);
const DENY_DIRS = ['lib', 'data', 'tests', 'node_modules', '.git', 'src'];
const PUBLIC_FILES = new Set([
  'index.html', 'admin.html', '404.html', 'style.css', 'app.js', 'admin.js', 'i18n.js', 'favicon.ico',
]);

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.includes('\0')) { H.sendText(res, 400, 'Bad request'); return; }
  const parts = rel.split('/').filter(Boolean);
  const base = parts.length ? parts[parts.length - 1] : '';
  const topDir = parts.length > 1 ? parts[0] : '';
  if (DENY.has(base) || DENY_DIRS.includes(topDir) || (!PUBLIC_FILES.has(base) && !/^[\w.-]+\.(css|js|png|jpe?g|webp|svg|ico|woff2?|json)$/i.test(base))) {
    H.sendText(res, 404, 'Not found');
    return;
  }
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(path.resolve(ROOT))) { H.sendText(res, 404, 'Not found'); return; }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { notFound(res); return; }
    const ext = path.extname(file).toLowerCase();
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  const f = path.join(ROOT, '404.html');
  fs.readFile(f, (e, buf) => {
    if (e) { H.sendText(res, 404, 'Not found'); return; }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
  });
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') { H.sendText(res, 204, ''); return; }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { H.sendText(res, 405, 'Method not allowed'); return; }
    serveStatic(req, res, pathname);
    return;
  }

  const cookies = H.parseCookies(req.headers.cookie);
  auth.attachSession(req, db, cookies);
  req.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  const match = routes.find((r) => r.method === req.method && r.rx.test(pathname));
  if (!match) {
    const existsWrongMethod = routes.some((r) => r.rx.test(pathname));
    H.sendJSON(res, existsWrongMethod ? 405 : 404,
      { error: { code: existsWrongMethod ? 'method_not_allowed' : 'not_found', message: 'Not found' } });
    return;
  }

  const m = pathname.match(match.rx);
  const params = {};
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

  const ctx = {
    req, res, params, query: u.searchParams, body: {},
    ip: req.ip, session: req.session, user: req.user, role: req.role,
    csrfToken: cookies[auth.CSRF_COOKIE] || '',
    ensureCsrf() {
      if (!this.csrfToken) {
        this.csrfToken = cryptoLib.randomToken(24);
        H.setCookie(res, auth.CSRF_COOKIE, this.csrfToken, { httpOnly: false, sameSite: 'Strict' });
      }
      return this.csrfToken;
    },
    setSession(session) {
      H.setCookie(res, auth.SESSION_COOKIE, session.id, {
        maxAge: auth.SESSION_TTL_MS / 1000, sameSite: 'Strict',
        secure: req.headers['x-forwarded-proto'] === 'https',
      });
      this.csrfToken = cryptoLib.randomToken(24);
      H.setCookie(res, auth.CSRF_COOKIE, this.csrfToken, { httpOnly: false, sameSite: 'Strict' });
    },
    clearSession() {
      H.clearCookie(res, auth.SESSION_COOKIE, { sameSite: 'Strict' });
      H.clearCookie(res, auth.CSRF_COOKIE, { httpOnly: false, sameSite: 'Strict' });
    },
  };

  try {
    if (match.throttle) {
      auth.throttle(match.throttle.key + ':' + (ctx.ip || 'x'), match.throttle.max, match.throttle.windowMs);
    }
    if (match.csrf) auth.verifyCsrf(req, cookies);
    const body = await H.readBody(req, MAX_BODY);
    if (body && typeof body === 'object') ctx.body = body;
    ctx.ensureCsrf();
    const result = await match.handler(ctx);
    H.sendJSON(res, 200, { ...result, csrfToken: ctx.csrfToken });
  } catch (e) {
    if (e instanceof H.HttpError) {
      H.sendJSON(res, e.status, { error: { code: e.code, message: e.message }, csrfToken: ctx.csrfToken });
    } else {
      console.error('[velora] 500', e);
      H.sendJSON(res, 500, { error: { code: 'server_error', message: 'Unexpected server error' } });
    }
  }
});

auth.pruneSessions(db);
setInterval(() => auth.pruneSessions(store.db()), 10 * 60_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[velora] Velora server running at http://${HOST}:${PORT}`);
  console.log('[velora] Admin panel: /#/admin  (server-side auth required)');
});

module.exports = server;

