const env = require('../config/env');

/**
 * Protects review admin CRUD when ADMIN_REVIEW_KEY is set (server/.env).
 * Client sends header: x-admin-key: <same value>
 * If unset or too short, middleware is a no-op (local dev).
 */
function requireAdminReviewKey(req, res, next) {
  const key = String(env.adminReviewKey || '').trim();
  if (!key || key.length < 8) {
    return next();
  }
  const sent = req.headers['x-admin-key'] || req.headers['x-admin-review-key'];
  if (String(sent || '') !== key) {
    return res.status(401).json({ message: 'Unauthorized', code: 'admin_key_required' });
  }
  return next();
}

module.exports = { requireAdminReviewKey };
