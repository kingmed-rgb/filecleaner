const crypto = require('crypto');
const { setCors, json, readJson, normalizeEmail, validEmail, setJsonKey, sendLoginCode, digest, loginLimit } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return json(res, 400, { error: 'invalid_email', message: 'Enter a valid email address.' });
    if (!await loginLimit(req, email, 'send')) return json(res, 429, { error: 'rate_limited', message: 'Too many code requests. Try again in 10 minutes.' });
    const code = String(crypto.randomInt(100000, 999999));
    await setJsonKey(`auth:${email}`, { digest: digest(`${email}:${code}`), email, createdAt: new Date().toISOString() }, 10 * 60);
    const result = await sendLoginCode(email, code);
    return json(res, 200, { ok: true, sent: result.sent, devCode: result.sent ? undefined : code });
  } catch (error) {
    return json(res, 500, { error: 'auth_start_failed', message: 'Service temporarily unavailable. Please try again.' });
  }
};
