const { json, readRawBody, verifyStripeSignature, normalizeEmail, getUser, saveUser, setJsonKey, getJsonKey } = require('../_lib');

module.exports.config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) {
      return json(res, 400, { error: 'invalid_signature' });
    }
    const event = JSON.parse(raw.toString('utf8'));
    const object = event.data && event.data.object ? event.data.object : {};

    if (event.type === 'checkout.session.completed') {
      const email = normalizeEmail(object.client_reference_id || object.customer_email || (object.metadata && object.metadata.email));
      if (email) {
        const user = await getUser(email);
        await saveUser(Object.assign({}, user, {
          plan: 'pro',
          stripeCustomerId: object.customer,
          stripeSubscriptionId: object.subscription,
          subscriptionStatus: 'active'
        }));
        if (object.customer) await setJsonKey(`customer:${object.customer}`, { email });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const customer = object.customer;
      const mapped = customer ? await getJsonKey(`customer:${customer}`) : null;
      const email = normalizeEmail((object.metadata && object.metadata.email) || (mapped && mapped.email));
      if (email) {
        const active = ['active', 'trialing'].includes(object.status) && event.type !== 'customer.subscription.deleted';
        const user = await getUser(email);
        await saveUser(Object.assign({}, user, {
          plan: active ? 'pro' : 'free',
          stripeCustomerId: customer || user.stripeCustomerId,
          stripeSubscriptionId: object.id || user.stripeSubscriptionId,
          subscriptionStatus: object.status || 'canceled'
        }));
      }
    }

    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 500, { error: 'webhook_failed', message: error.message });
  }
};
