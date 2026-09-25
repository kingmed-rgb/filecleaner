const { setCors, json, readJson, getViewer, stripeRequest, appUrl } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const body = await readJson(req);
    const viewer = await getViewer(req, res);
    if (!viewer.authenticated) return json(res, 401, { error: 'sign_in_required', message: 'Sign in before upgrading.' });
    const interval = body.interval === 'yearly' ? 'yearly' : 'monthly';
    const price = interval === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
    if (!price) return json(res, 500, { error: 'missing_price', message: `Missing Stripe ${interval} price id.` });
    const root = appUrl();
    const session = await stripeRequest('checkout/sessions', {
      mode: 'subscription',
      success_url: `${root}/?checkout=success`,
      cancel_url: `${root}/?checkout=cancel`,
      client_reference_id: viewer.email,
      customer_email: viewer.email,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      'metadata[email]': viewer.email,
      'subscription_data[metadata][email]': viewer.email
    });
    return json(res, 200, { url: session.url });
  } catch (error) {
    return json(res, 500, { error: 'checkout_failed', message: error.message });
  }
};
