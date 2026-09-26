const crypto = require('crypto');

const DAY_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE = 'fc_session';
const GUEST_LIMIT = 3;
function development() {
  return !process.env.VERCEL && ['development', 'test'].includes(process.env.NODE_ENV);
}

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
  if (!allowed.length && development()) allowed.push(appUrl());
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (origin && !allowed.includes(origin)) {
    json(res, 403, { error: 'origin_not_allowed', message: 'Request origin is not allowed.' });
    return true;
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    json(res, 415, { error: 'json_required', message: 'Send an application/json request.' });
    return true;
  }
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
    if (name) { try { cookies[name] = decodeURIComponent(value); } catch (_) {} }
    return cookies;
  }, {});
}

function appendCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', value);
  res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(value) : [existing, value]);
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (!development()) parts.push('Secure');
  parts.push(options.httpOnly === false ? '' : 'HttpOnly');
  parts.push(options.sameSite || 'SameSite=Lax');
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
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32 && !secret.startsWith('replace-')) return secret;
  if (development()) return 'local-development-secret-not-for-deployment';
  throw new Error('Session configuration unavailable');
}

function signPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyPayload(token) {
  if (typeof token !== 'string' || token.split('.').length !== 2) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(encoded).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
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
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function kv(args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (development()) return memoryKv(args);
    throw new Error('Storage configuration unavailable');
  }
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
  if (data.error) throw new Error('Storage command failed');
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
  if (cmd === 'EVAL') {
    const script = key;
    const actualKey = args[3];
    if (script === BUDGET_SCRIPT) {
      const [amount, limit, seconds] = args.slice(4).map(Number);
      const used = Number(memoryKv(['GET', actualKey]) || 0);
      if (used + amount > limit) return -1;
      const expiresAt = memory.has(actualKey) ? memory.get(actualKey).expiresAt : Date.now() + seconds * 1000;
      memory.set(actualKey, { value: String(used + amount), expiresAt });
      return used + amount;
    }
    if (script === VERIFY_SCRIPT) {
      const raw = memoryKv(['GET', actualKey]);
      if (!raw || JSON.parse(raw).digest !== args[4]) return 0;
      memoryKv(['DEL', actualKey]);
      return 1;
    }
    throw new Error('Unsupported script');
  }
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
  return getJsonKey(`user:${clean}`, { email: clean });
}

async function saveUser(user) {
  const clean = normalizeEmail(user.email);
  const next = { email: clean, name: user.name, picture: user.picture, provider: user.provider, updatedAt: new Date().toISOString() };
  await setJsonKey(`user:${clean}`, next);
  return next;
}

// A single Redis operation checks and reserves usage, including under concurrency.
const BUDGET_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
if used + amount > tonumber(ARGV[2]) then return -1 end
local next = redis.call('INCRBY', KEYS[1], amount)
if next == amount then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return next`;
const VERIFY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if cjson.decode(raw).digest ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1`;

function digest(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('hex');
}

function clientIdentity(req) {
  // Vercel overwrites this header. Never trust arbitrary forwarded headers elsewhere.
  const address = process.env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket && req.socket.remoteAddress;
  if (!address) throw new Error('Client identity unavailable');
  return digest(String(address).split(',')[0].trim());
}

async function reserve(key, amount, limit, ttl) {
  const result = await kv(['EVAL', BUDGET_SCRIPT, 1, key, amount, limit, ttl]);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid storage response');
  return result >= 0;
}

async function loginLimit(req, email, action) {
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const max = action === 'send' ? 3 : 5;
  const ipOK = await reserve(`auth-rate:${action}:ip:${bucket}:${clientIdentity(req)}`, 1, max * 5, 600);
  if (!ipOK) return false;
  return reserve(`auth-rate:${action}:email:${bucket}:${digest(email)}`, 1, max, 600);
}

async function verifyLoginCode(email, code) {
  return Number(await kv(['EVAL', VERIFY_SCRIPT, 1, `auth:${email}`, digest(`${email}:${code}`)])) === 1;
}

async function getViewer(req) {
  sessionSecret();
  const payload = verifyPayload(parseCookies(req)[SESSION_COOKIE]);
  if (payload && payload.kind === 'session' && validEmail(payload.email || '')) {
    const user = await getUser(payload.email);
    return { authenticated: true, identity: `user:${user.email}`, email: user.email, user };
  }
  // Daily network identity survives cookie deletion without storing raw IP addresses.
  return { authenticated: false, identity: `guest:${digest(today() + ':' + clientIdentity(req))}`, email: null, user: null };
}

async function usageStatus(viewer) {
  const limit = viewer.authenticated ? null : GUEST_LIMIT;
  const used = viewer.authenticated ? 0 : Number(await kv(['GET', `usage:${today()}:${viewer.identity}`]) || 0);
  return {
    authenticated: viewer.authenticated, email: viewer.email,
    plan: viewer.authenticated ? 'free' : 'guest', limit, used,
    remaining: limit == null ? null : Math.max(0, limit - used),
    canBatch: true,
    authMethods: {
      email: development() || Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    },
    resetsAt: limit == null ? null : new Date(Date.parse(today()) + DAY_SECONDS * 1000).toISOString()
  };
}

async function consumeUsage(viewer, count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
    return { ok: false, status: 400, code: 'invalid_count', message: 'Choose between 1 and 500 files per batch.' };
  }
  if (!viewer.authenticated && !await reserve(`usage:${today()}:${viewer.identity}`, count, GUEST_LIMIT, DAY_SECONDS * 2)) {
    return { ok: false, status: 429, code: 'daily_limit_reached', message: 'Daily limit reached. Sign up free for unlimited files.' };
  }
  return { ok: true, status: await usageStatus(viewer) };
}

async function sendLoginCode(email, code) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    if (development()) return { sent: false };
    throw new Error('Email delivery unavailable');
  }
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

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

module.exports = {
  SESSION_COOKIE,
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
  getViewer,
  usageStatus,
  consumeUsage,
  sendLoginCode,
  appUrl,
  digest,
  loginLimit,
  verifyLoginCode,
  development
};
