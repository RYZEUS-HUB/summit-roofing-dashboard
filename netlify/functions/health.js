const { getConfig, json, tryGhl } = require('./_lib/ghl');

exports.handler = async function handler() {
  const cfg = getConfig();
  if (!cfg.token) {
    return json(200, {
      ok: false,
      message: 'GHL_PRIVATE_TOKEN is missing. Add it in Netlify environment variables.',
      locationId: cfg.locationId
    });
  }
  const location = await tryGhl('location', [{ path: `/locations/${cfg.locationId}` }]);
  return json(location.ok ? 200 : 500, {
    ok: location.ok,
    locationId: cfg.locationId,
    endpoint: location.endpoint || '',
    errors: location.errors || []
  });
};
