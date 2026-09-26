const crypto = require('crypto');
const { appendCookie, cookie, signPayload, appUrl } = require('../_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    return res.end('Missing GOOGLE_CLIENT_ID');
  }
  const state = crypto.randomUUID();
  const token = signPayload({ kind: 'oauth', state, exp: Math.floor(Date.now() / 1000) + 10 * 60 });
  appendCookie(res, cookie('fc_oauth_state', token, { maxAge: 10 * 60 }));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl()}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });
  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.end();
};
