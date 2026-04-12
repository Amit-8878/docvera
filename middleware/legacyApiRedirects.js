/**
 * Permanent redirects (308) from legacy API paths to canonical routes.
 * Preserves query string; POST body follows fetch spec on 308.
 */

function querySuffix(req) {
  const i = req.originalUrl.indexOf('?');
  return i >= 0 ? req.originalUrl.slice(i) : '';
}

/** Mounted at /api/order — req.url is remainder (e.g. /upload/…). */
function redirectOrderToOrders(req, res) {
  res.redirect(308, `/api/orders${req.url}`);
}

/** Mounted at /api/payments — skip only if something else handles it (webhook is separate app.post). */
function redirectPaymentsToPayment(req, res) {
  res.redirect(308, `/api/payment${req.url}`);
}

/** Mounted at /api/admin-settings — req.url e.g. /global, /pricing, /toggles. */
function redirectAdminSettingsToAdmin(req, res) {
  const pathOnly = (req.url || '/').split('?')[0] || '/';
  const q = querySuffix(req);
  const tail = pathOnly === '/' || pathOnly === '' ? '/global' : pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  res.redirect(308, `/api/admin${tail}${q}`);
}

module.exports = {
  redirectOrderToOrders,
  redirectPaymentsToPayment,
  redirectAdminSettingsToAdmin,
};
