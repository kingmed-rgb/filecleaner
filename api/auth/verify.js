const { setCors, json, readJson, normalizeEmail, validEmail, getJsonKey, kv, getUser, saveUser, appendCookie, cookie, signPayload, SESSION_COOKIE } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    if (!validEmail(email) || !code) return json(res, 400, { error: 'invalid_code', message: 'Enter your email and code.' });
    const record = await getJsonKey(`auth:${email}`);
    if (!record || record.code !== code) return json(res, 401, { error: 'invalid_code', message: 'The sign-in code is invalid or expired.' });
    await kv(['DEL', `auth:${email}`]);
    await saveUser(await getUser(email));
    const token = signPayload({ email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
    appendCookie(res, cookie(SESSION_COOKIE, token, { maxAge: 60 * 60 * 24 * 30 }));
    return json(res, 200, { ok: true, email });
  } catch (error) {
    return json(res, 500, { error: 'auth_verify_failed', message: error.message });
  }
};
