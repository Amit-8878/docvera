const { getBooleanSetting } = require('../services/systemSettingsService');

/**
 * Block public service catalog when services_enabled is false (admins bypass).
 */
async function requireServicesCatalogEnabled(req, res, next) {
  try {
    const enabled = await getBooleanSetting('services_enabled', true);
    if (enabled) return next();
    const role = req.user?.role;
    if (role === 'admin' || role === 'super_admin') return next();
    return res.status(503).json({
      message: 'Service temporarily unavailable',
      details: 'Service browsing is disabled. Please try again later.',
      code: 'SERVICES_DISABLED',
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = { requireServicesCatalogEnabled };
