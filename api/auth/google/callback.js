const { parseCookies, verifyPayload, appendCookie, cookie, clearCookie, signPayload, SESSION_COOKIE, getUser, saveUser, normalizeEmail, appUrl } = require('../../_lib');

async function exchangeCode(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: 'authorization_code'
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}

async function getProfile(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google profile lookup failed');
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  try {
    const url = new URL(req.url, appUrl());
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req);
    const expected = verifyPayload(cookies.fc_oauth_state);
    appendCookie(res, clearCookie('fc_oauth_state'));
    if (!code || !state || !expected || expected.state !== state) throw new Error('Invalid Google sign-in state');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Missing Google OAuth environment variables');

    const token = await exchangeCode(code);
    const profile = await getProfile(token.access_token);
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('Google account did not provide an email address');

    const user = await getUser(email);
    await saveUser(Object.assign({}, user, {
      email,
      name: profile.name || user.name,
      picture: profile.picture || user.picture,
      provider: 'google'
    }));
    const session = signPayload({ email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
    appendCookie(res, cookie(SESSION_COOKIE, session, { maxAge: 60 * 60 * 24 * 30 }));
    res.statusCode = 302;
    res.setHeader('Location', `${appUrl()}/?registered=google#app`);
    res.end();
  } catch (error) {
    res.statusCode = 302;
    res.setHeader('Location', `${appUrl()}/?auth_error=${encodeURIComponent(error.message)}#app`);
    res.end();
  }
};
