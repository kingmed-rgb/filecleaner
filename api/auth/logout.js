const { setCors, json, appendCookie, clearCookie, SESSION_COOKIE } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  appendCookie(res, clearCookie(SESSION_COOKIE));
  return json(res, 200, { ok: true });
};
