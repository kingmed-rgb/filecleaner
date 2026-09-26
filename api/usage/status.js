const { setCors, json, getViewer, usageStatus } = require('../_lib');

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const viewer = await getViewer(req, res);
    return json(res, 200, await usageStatus(viewer));
  } catch (error) {
    return json(res, 500, { error: 'usage_status_failed', message: 'Service temporarily unavailable. Please try again.' });
  }
};
