const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../api/_lib');
const start = require('../api/auth/start');
const verify = require('../api/auth/verify');
const status = require('../api/usage/status');
const consume = require('../api/usage/consume');
const logout = require('../api/auth/logout');
const googleCallback = require('../api/auth/google/callback');

const envKeys = ['NODE_ENV', 'VERCEL', 'SESSION_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'RESEND_API_KEY', 'EMAIL_FROM', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.NODE_ENV = 'test';
  process.env.APP_URL = 'https://example.test';
  process.env.ALLOWED_ORIGINS = 'https://example.test';
  global.__FILECLEANER_MEMORY__.clear();
});
function request(body = {}, extras = {}) {
  return { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'https://example.test' }, socket: { remoteAddress: '192.0.2.1' }, ...extras };
}
async function call(handler, req) {
  const headers = {};
  const res = { statusCode: 200, setHeader(name, value) { headers[name] = value; }, getHeader(name) { return headers[name]; }, end(text) { this.text = text || ''; } };
  await handler(req, res);
  return { status: res.statusCode, headers, text: res.text, data: res.text && res.text.startsWith('{') ? JSON.parse(res.text) : null };
}
const guest = () => lib.getViewer(request());

test('guest gets three images and fourth is blocked', async () => {
  const viewer = await guest();
  for (let i = 0; i < 3; i++) assert.equal((await lib.consumeUsage(viewer, 1)).ok, true);
  const denied = await lib.consumeUsage(viewer, 1);
  assert.equal(denied.status, 429);
  assert.match(denied.message, /Sign up free for unlimited/);
  assert.equal((await lib.usageStatus(viewer)).used, 3);
});
test('eight simultaneous guest requests accept exactly three', async () => {
  const viewer = await guest();
  const results = await Promise.all(Array.from({ length: 8 }, () => lib.consumeUsage(viewer, 1)));
  assert.equal(results.filter(result => result.ok).length, 3);
  assert.equal((await lib.usageStatus(viewer)).used, 3);
});
test('guest batch is atomic and counts each image', async () => {
  const viewer = await guest();
  assert.equal((await lib.consumeUsage(viewer, 2)).ok, true);
  assert.equal((await lib.consumeUsage(viewer, 2)).status, 429);
  assert.equal((await lib.usageStatus(viewer)).used, 2);
  assert.equal((await lib.consumeUsage(viewer, 1)).ok, true);
});
test('cookie reset and untrusted forwarded headers cannot reset guest quota', async () => {
  const viewer = await guest();
  await lib.consumeUsage(viewer, 3);
  const changed = await lib.getViewer(request({}, { headers: { cookie: 'fc_anon=changed', 'x-forwarded-for': '198.51.100.1', 'x-vercel-forwarded-for': '198.51.100.2' } }));
  assert.equal(changed.identity, viewer.identity);
  assert.equal((await lib.consumeUsage(changed, 1)).status, 429);
  assert.ok(!viewer.identity.includes('192.0.2.1'));
});
test('guest allowance resets on a new UTC day and expires', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-26T23:59:59Z') });
  const viewer = await guest();
  await lib.consumeUsage(viewer, 3);
  assert.equal((await lib.usageStatus(viewer)).resetsAt, '2026-09-27T00:00:00.000Z');
  t.mock.timers.tick(2000);
  assert.equal((await lib.consumeUsage(await guest(), 3)).ok, true);
  t.mock.timers.tick(3 * 86400000);
  assert.equal((await lib.usageStatus(await guest())).used, 0);
  assert.equal(global.__FILECLEANER_MEMORY__.size, 0);
});
test('signed-in accounts have unlimited use regardless of old subscription state', async () => {
  for (const plan of ['free', 'pro']) {
    const email = `${plan}@example.test`;
    await lib.setJsonKey(`user:${email}`, { email, plan, subscriptionStatus: 'canceled' });
    const token = lib.signPayload({ kind: 'session', email, exp: Math.floor(Date.now() / 1000) + 3600 });
    const viewer = await lib.getViewer(request({}, { headers: { cookie: `fc_session=${token}` } }));
    for (let i = 0; i < 12; i++) assert.equal((await lib.consumeUsage(viewer, 500)).ok, true);
    const state = await lib.usageStatus(viewer);
    assert.equal(state.limit, null); assert.equal(state.remaining, null); assert.equal(state.canBatch, true);
    assert.equal(state.plan, 'free');
  }
  assert.equal([...global.__FILECLEANER_MEMORY__.keys()].filter(key => key.startsWith('usage:')).length, 0);
});
test('invalid counts do not spend quota', async () => {
  const viewer = await guest();
  for (const count of [undefined, null, 0, -1, 1.5, '2', {}, [], 501, NaN, Infinity]) assert.equal((await lib.consumeUsage(viewer, count)).status, 400);
  assert.equal((await lib.usageStatus(viewer)).used, 0);
});
test('email sign-in creates an unlimited account and code cannot be reused', async () => {
  const email = 'person@example.test';
  const first = await call(start, request({ email }));
  assert.equal(first.status, 200);
  assert.match(first.data.devCode, /^\d{6}$/);
  assert.ok(!(await lib.kv(['GET', `auth:${email}`])).includes(first.data.devCode));
  const verified = await call(verify, request({ email, code: first.data.devCode }));
  assert.equal(verified.status, 200);
  assert.match(verified.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
  const cookie = verified.headers['Set-Cookie'].split(';')[0];
  const usage = await call(status, request({}, { method: 'GET', headers: { cookie } }));
  assert.equal(usage.data.authenticated, true); assert.equal(usage.data.limit, null);
  assert.equal((await call(consume, request({ count: 30 }, { headers: { 'content-type': 'application/json', cookie } }))).status, 200);
  assert.equal((await call(verify, request({ email, code: first.data.devCode }))).status, 401);
  const signedOut = await call(logout, request());
  assert.match(signedOut.headers['Set-Cookie'], /Max-Age=0/);
});
test('only one concurrent verification can consume a code', async () => {
  const email = 'race@example.test';
  await lib.setJsonKey(`auth:${email}`, { digest: lib.digest(`${email}:123456`) }, 600);
  const results = await Promise.all(Array.from({ length: 5 }, () => lib.verifyLoginCode(email, '123456')));
  assert.equal(results.filter(Boolean).length, 1);
});
test('email send requests and wrong verification attempts are throttled', async () => {
  const email = 'limits@example.test';
  for (let i = 0; i < 3; i++) assert.equal((await call(start, request({ email }))).status, 200);
  assert.equal((await call(start, request({ email }))).status, 429);
  for (let i = 0; i < 5; i++) assert.equal((await call(verify, request({ email, code: '000000' }))).status, 401);
  assert.equal((await call(verify, request({ email, code: '000000' }))).status, 429);
});
test('network send throttling also covers attempts across many emails', async () => {
  for (let i = 0; i < 15; i++) assert.equal((await call(start, request({ email: `p${i}@example.test` }))).status, 200);
  assert.equal((await call(start, request({ email: 'p16@example.test' }))).status, 429);
});
test('expired challenges and tampered, expired, or wrong-purpose sessions fail', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-26T12:00:00Z') });
  await lib.setJsonKey('auth:expired@example.test', { digest: lib.digest('expired@example.test:123456') }, 600);
  t.mock.timers.tick(601000);
  assert.equal(await lib.verifyLoginCode('expired@example.test', '123456'), false);
  const now = Math.floor(Date.now() / 1000);
  for (const payload of [{ kind: 'session', email: 'a@example.test', exp: now - 1 }, { kind: 'session', email: 'a@example.test' }, { kind: 'oauth', email: 'a@example.test', exp: now + 100 }]) {
    const viewer = await lib.getViewer(request({}, { headers: { cookie: `fc_session=${lib.signPayload(payload)}` } }));
    assert.equal(viewer.authenticated, false);
  }
  assert.equal(lib.verifyPayload(lib.signPayload({ exp: now + 100 }) + 'tampered'), null);
  assert.deepEqual(lib.parseCookies(request({}, { headers: { cookie: 'fc_session=%ZZ' } })), {});
});
test('production rejects missing secrets, storage, and email credentials', async () => {
  process.env.NODE_ENV = 'production';
  assert.throws(() => lib.signPayload({}), /Session configuration/);
  await assert.rejects(() => lib.kv(['GET', 'anything']), /Storage configuration/);
  await assert.rejects(() => lib.sendLoginCode('a@example.test', '123456'), /Email delivery/);
  const result = await call(start, request({ email: 'a@example.test' }));
  assert.equal(result.status, 500); assert.equal(result.data.devCode, undefined);
  assert.match(lib.cookie('fc_session', 'abc'), /Secure; HttpOnly; SameSite=Lax/);
});
test('Vercel preview deployments never use development fallbacks', async () => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'development';
  assert.equal(lib.development(), false);
  assert.throws(() => lib.signPayload({}), /Session configuration/);
  await assert.rejects(() => lib.kv(['GET', 'anything']), /Storage configuration/);
  await assert.rejects(() => lib.sendLoginCode('a@example.test', '123456'), /Email delivery/);
});
test('Redis errors are not treated as successful reservations', async t => {
  process.env.KV_REST_API_URL = 'https://redis.example.test'; process.env.KV_REST_API_TOKEN = 'test';
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ error: 'ERR' }) }));
  await assert.rejects(() => lib.consumeUsage({ authenticated: false, identity: 'test' }, 1), /Storage command failed/);
});
test('cross-origin and non-JSON mutations are rejected; responses cannot be cached', async () => {
  const denied = await call(consume, request({ count: 1 }, { headers: { origin: 'https://evil.test', 'content-type': 'application/json' } }));
  assert.equal(denied.status, 403); assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal((await call(consume, request({ count: 1 }, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  const state = await call(status, request({}, { method: 'GET' }));
  assert.equal(state.headers['Cache-Control'], 'no-store');
});
test('Google refuses profiles without verified emails', async t => {
  process.env.GOOGLE_CLIENT_ID = 'test'; process.env.GOOGLE_CLIENT_SECRET = 'test';
  t.mock.method(global, 'fetch', async url => ({ ok: true, json: async () => String(url).includes('/token') ? { access_token: 'test' } : { email: 'unverified@example.test', email_verified: false } }));
  const token = lib.signPayload({ kind: 'oauth', state: 'test', exp: Math.floor(Date.now() / 1000) + 600 });
  const result = await call(googleCallback, request({}, { method: 'GET', url: '/api/auth/google/callback?code=test&state=test', headers: { cookie: `fc_oauth_state=${token}` } }));
  assert.match(result.headers.Location, /auth_error=/);
  assert.ok(!JSON.stringify(result.headers['Set-Cookie']).includes('fc_session='));
});

test('frontend receives only configured login methods', async () => {
  const viewer = { authenticated: true, email: 'test@example.test' };
  assert.deepEqual((await lib.usageStatus(viewer)).authMethods, { email: true, google: false });
  process.env.NODE_ENV = 'production';
  assert.deepEqual((await lib.usageStatus(viewer)).authMethods, { email: false, google: false });
  process.env.RESEND_API_KEY = 'test'; process.env.EMAIL_FROM = 'test@example.test';
  process.env.GOOGLE_CLIENT_ID = 'test'; process.env.GOOGLE_CLIENT_SECRET = 'test';
  assert.deepEqual((await lib.usageStatus(viewer)).authMethods, { email: true, google: true });
});
