const { features } = require('../config/featureFlags');

/**
 * Hard 403 when env feature flag is off (ops kill-switch).
 * Does not replace DB-backed requireFeatureEnabled — use both where needed.
 */
function requireEnvFeature(flagKey) {
  return function envFeatureMiddleware(req, res, next) {
    if (features[flagKey]) return next();
    return res.status(403).json({
      success: false,
      data: null,
      message: 'Feature disabled',
      errorCode: 'FEATURE_DISABLED',
      details: `Feature "${flagKey}" is disabled via server configuration.`,
    });
  };
}

module.exports = {
  requireEnvFeature,
};
