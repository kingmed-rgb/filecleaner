const { setCors, json, readJson, getViewer, consumeUsage } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const body = await readJson(req);
    const viewer = await getViewer(req, res);
    const result = await consumeUsage(viewer, body.count);
    if (!result.ok) return json(res, result.status, { error: result.code, message: result.message });
    return json(res, 200, result.status);
  } catch (error) {
    return json(res, 500, { error: 'usage_consume_failed', message: 'Service temporarily unavailable. Please try again.' });
  }
};
