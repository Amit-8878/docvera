const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * If a valid Bearer token is present, attaches req.user like authMiddleware.
 * If missing or invalid, continues without req.user (anonymous).
 */
function optionalAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) return next();

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next();

    const decoded = jwt.verify(token, env.jwtSecret);
    if (decoded.typ === 'refresh') {
      return next();
    }
    req.user = {
      id: decoded.id,
      role: decoded.role,
      userId: decoded.id,
    };
  } catch (_e) {
    // ignore invalid token for optional auth
  }
  return next();
}

module.exports = optionalAuthMiddleware;
