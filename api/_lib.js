const crypto = require('crypto');

const DAY_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE = 'fc_session';
const ANON_COOKIE = 'fc_anon';
const GUEST_LIMIT = 3;
const FREE_LIMIT = 10;

const memory = global.__FILECLEANER_MEMORY__ || (global.__FILECLEANER_MEMORY__ = new Map());

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || process.env.APP_URL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = allowedOrigins();
  const canEcho = origin && (!allowed.length || allowed.includes(origin));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', canEcho ? origin : '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === 'string') return resolve(Buffer.from(req.body));
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index < 0) return cookies;
    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function appendCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', value);
  res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(value) : [existing, value]);
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'Secure'];
  parts.push(options.httpOnly === false ? '' : 'HttpOnly');
  parts.push(options.sameSite || 'SameSite=None');
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  return parts.filter(Boolean).join('; ');
}

function clearCookie(name) {
  return cookie(name, '', { maxAge: 0 });
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sessionSecret() {
  return process.env.SESSION_SECRET || 'dev-only-change-me';
}

function signPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyPayload(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function kv(args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return memoryKv(args);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!response.ok) throw new Error(`KV command failed: ${response.status}`);
  const data = await response.json();
  return data.result;
}

function pruneMemory() {
  const now = Date.now();
  for (const [key, item] of memory.entries()) {
    if (item.expiresAt && item.expiresAt <= now) memory.delete(key);
  }
}

function memoryKv(args) {
  pruneMemory();
  const [command, key, value, flag, ttl] = args;
  const cmd = String(command).toUpperCase();
  if (cmd === 'GET') return memory.has(key) ? memory.get(key).value : null;
  if (cmd === 'SET') {
    memory.set(key, { value, expiresAt: String(flag).toUpperCase() === 'EX' ? Date.now() + Number(ttl) * 1000 : null });
    return 'OK';
  }
  if (cmd === 'DEL') {
    memory.delete(key);
    return 1;
  }
  if (cmd === 'EXPIRE') {
    const item = memory.get(key);
    if (!item) return 0;
    item.expiresAt = Date.now() + Number(value) * 1000;
    return 1;
  }
  if (cmd === 'INCRBY') {
    const current = memory.has(key) ? Number(memory.get(key).value || 0) : 0;
    const next = current + Number(value || 0);
    const existing = memory.get(key);
    memory.set(key, { value: String(next), expiresAt: existing ? existing.expiresAt : null });
    return next;
  }
  throw new Error(`Unsupported memory KV command: ${cmd}`);
}

async function getJsonKey(key, fallback = null) {
  const raw = await kv(['GET', key]);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

async function setJsonKey(key, value, ttlSeconds) {
  const args = ['SET', key, JSON.stringify(value)];
  if (ttlSeconds) args.push('EX', ttlSeconds);
  return kv(args);
}

async function getUser(email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;
  return getJsonKey(`user:${clean}`, { email: clean, plan: 'free' });
}

async function saveUser(user) {
  const clean = normalizeEmail(user.email);
  const next = Object.assign({ email: clean, plan: 'free' }, user, { email: clean, updatedAt: new Date().toISOString() });
  await setJsonKey(`user:${clean}`, next);
  return next;
}

function isPro(user) {
  return user && user.plan === 'pro' && (!user.subscriptionStatus || ['active', 'trialing'].includes(user.subscriptionStatus));
}

function quotaFor(viewer) {
  if (viewer.pro) return null;
  return viewer.authenticated ? FREE_LIMIT : GUEST_LIMIT;
}

async function getViewer(req, res) {
  const cookies = parseCookies(req);
  const payload = verifyPayload(cookies[SESSION_COOKIE]);
  if (payload && payload.email) {
    const user = await getUser(payload.email);
    return { authenticated: true, identity: `user:${user.email}`, email: user.email, user, pro: isPro(user) };
  }
  let anonId = cookies[ANON_COOKIE];
  if (!anonId) {
    anonId = crypto.randomUUID();
    appendCookie(res, cookie(ANON_COOKIE, anonId, { maxAge: 60 * 60 * 24 * 365 }));
  }
  return { authenticated: false, identity: `anon:${anonId}`, email: null, user: null, pro: false };
}

async function usageStatus(viewer) {
  const limit = quotaFor(viewer);
  const used = Number(await kv(['GET', `usage:${today()}:${viewer.identity}`]) || 0);
  return {
    authenticated: viewer.authenticated,
    email: viewer.email,
    plan: viewer.pro ? 'pro' : viewer.authenticated ? 'free' : 'guest',
    limit,
    used,
    remaining: limit == null ? null : Math.max(0, limit - used),
    canBatch: viewer.pro,
    pro: viewer.pro
  };
}

async function consumeUsage(viewer, count) {
  const amount = Math.max(1, Math.min(Number(count || 1), 500));
  if (!viewer.pro && amount > 1) {
    return { ok: false, status: 402, code: 'batch_requires_pro', message: 'Batch processing is included with Pro.' };
  }
  const limit = quotaFor(viewer);
  if (limit == null) return { ok: true, status: await usageStatus(viewer) };
  const key = `usage:${today()}:${viewer.identity}`;
  const used = Number(await kv(['GET', key]) || 0);
  if (used + amount > limit) {
    return { ok: false, status: 429, code: 'daily_limit_reached', message: `Daily limit reached. ${viewer.authenticated ? 'Upgrade to Pro for unlimited images.' : 'Sign in for 10 images per day.'}` };
  }
  const next = Number(await kv(['INCRBY', key, amount]));
  if (next === amount) await kv(['EXPIRE', key, DAY_SECONDS * 2]);
  return { ok: true, status: await usageStatus(viewer) };
}

async function sendLoginCode(email, code) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { sent: false };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Your File Cleaner sign-in code',
      html: `<p>Your File Cleaner sign-in code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`
    })
  });
  if (!response.ok) throw new Error(`Email send failed: ${response.status}`);
  return { sent: true };
}

async function stripeRequest(path, params) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error && data.error.message ? data.error.message : `Stripe error: ${response.status}`);
  return data;
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function verifyStripeSignature(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(signature.split(',').map((part) => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const signed = `${parts.t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return safeEqual(parts.v1, expected);
}

module.exports = {
  SESSION_COOKIE,
  ANON_COOKIE,
  DAY_SECONDS,
  setCors,
  json,
  readJson,
  readRawBody,
  parseCookies,
  appendCookie,
  cookie,
  clearCookie,
  signPayload,
  verifyPayload,
  normalizeEmail,
  validEmail,
  kv,
  getJsonKey,
  setJsonKey,
  getUser,
  saveUser,
  isPro,
  getViewer,
  usageStatus,
  consumeUsage,
  sendLoginCode,
  stripeRequest,
  appUrl,
  verifyStripeSignature
};
