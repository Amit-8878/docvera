const { getBooleanSetting } = require('../services/systemSettingsService');

/**
 * Block feature when setting is false. Admins and super admins may bypass (operations/testing).
 */
function requireFeatureEnabled(settingKey) {
  return async function requireFeatureEnabledMiddleware(req, res, next) {
    try {
      const enabled = await getBooleanSetting(settingKey, true);
      if (enabled) return next();
      const role = req.user?.role;
      if (role === 'admin' || role === 'super_admin') return next();
      return res.status(403).json({
        message: 'Forbidden',
        details: 'This feature is temporarily disabled',
        code: settingKey,
      });
    } catch (e) {
      return next(e);
    }
  };
}

module.exports = {
  requireFeatureEnabled,
};
