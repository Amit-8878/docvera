const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Verify JWT. Attaches decoded payload to req.user ({ id, role }).
 * Also available as `middleware/auth.js` (same module).
 * Sets req.user.userId for compatibility with order/payment controllers.
 */
function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({ message: 'Unauthorized', details: 'Missing Authorization header' });
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Unauthorized', details: 'Invalid Authorization header' });
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    if (decoded.typ === 'refresh') {
      return res.status(401).json({ message: 'Unauthorized', details: 'Invalid token type' });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
    };
    req.user.userId = decoded.id;

    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized', details: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
