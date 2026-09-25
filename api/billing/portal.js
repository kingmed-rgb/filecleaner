const { setCors, json, getViewer, stripeRequest, appUrl } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const viewer = await getViewer(req, res);
    if (!viewer.authenticated) return json(res, 401, { error: 'sign_in_required', message: 'Sign in to manage billing.' });
    if (!viewer.user || !viewer.user.stripeCustomerId) return json(res, 404, { error: 'no_subscription', message: 'No billing account found yet.' });
    const session = await stripeRequest('billing_portal/sessions', {
      customer: viewer.user.stripeCustomerId,
      return_url: appUrl()
    });
    return json(res, 200, { url: session.url });
  } catch (error) {
    return json(res, 500, { error: 'portal_failed', message: error.message });
  }
};
