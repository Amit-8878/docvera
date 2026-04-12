const { getBooleanSetting } = require('../services/systemSettingsService');

/**
 * When maintenance_mode is true, only admin/super_admin may use the API (except public/auth/health paths).
 */
async function maintenanceMiddleware(req, res, next) {
  try {
    const path = (req.originalUrl || '').split('?')[0];

    if (path === '/api/payments/webhook') {
      return next();
    }

    /** Legacy prefixes that only 308 to canonical routes — allow through maintenance. */
    if (
      path.startsWith('/api/order') ||
      (path.startsWith('/api/payments') && path !== '/api/payments/webhook') ||
      path.startsWith('/api/admin-settings') ||
      path === '/api/wallet/dashboard' ||
      path === '/api/wallet/customer' ||
      path === '/api/wallet' ||
      path === '/api/wallet/'
    ) {
      return next();
    }

    if (
      path.startsWith('/api/public') ||
      path === '/api/health' ||
      path === '/api/payment/webhook' ||
      /^\/api\/auth\/(login|register|refresh)/.test(path)
    ) {
      return next();
    }

    const maintenance = await getBooleanSetting('maintenance_mode', false);
    if (!maintenance) return next();

    const role = req.user?.role;
    if (role === 'admin' || role === 'super_admin') return next();

    return res.status(503).json({
      message: 'Service unavailable',
      details: 'System under maintenance',
      maintenance: true,
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = maintenanceMiddleware;
