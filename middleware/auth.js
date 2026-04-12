/**
 * Alias for `authMiddleware.js` — JWT verification and `req.user` / `req.user.userId`.
 * Prefer importing `authMiddleware` directly; this file exists for predictable naming.
 */
module.exports = require('./authMiddleware');
