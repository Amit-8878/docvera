const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

const windowMs = Number(process.env.STRICT_RATE_WINDOW_MS) || 60 * 1000;
const max = Number(process.env.STRICT_RATE_MAX_PER_MINUTE) || 100;

function disabled() {
  return String(process.env.DISABLE_STRICT_RATE_LIMIT || '').toLowerCase() === 'true';
}

/**
 * Resolved client IP for rate-limit keys. Falls back when `req.ip` is empty (e.g. before trust proxy runs).
 * `ipKeyGenerator` normalizes IPv6 (subnet) so limits cannot be bypassed via address rotation.
 */
function safeClientIp(req) {
  let ip = req.ip;
  if (ip != null && String(ip).trim() !== '') {
    return String(ip).trim();
  }
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).trim();
  }
  return 'unknown';
}

/** Login / register-style endpoints — per IP */
const loginRouteLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabled(),
  keyGenerator: (req) => ipKeyGenerator(safeClientIp(req)),
  message: {
    success: false,
    message: 'Too many attempts. Please wait and try again.',
    code: 'RATE_LIMITED',
  },
});

/** Payment routes — per user when JWT present, else IP */
const paymentRouteLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabled(),
  keyGenerator: (req) => {
    const uid = req.user && req.user.userId;
    if (uid) return `u:${uid}`;
    return `ip:${ipKeyGenerator(safeClientIp(req))}`;
  },
  message: {
    success: false,
    message: 'Too many payment requests. Please try again shortly.',
    code: 'RATE_LIMITED',
  },
});

/** Order mutations — skip pure GET */
const orderWriteLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => disabled() || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  keyGenerator: (req) => {
    const uid = req.user && req.user.userId;
    if (uid) return `u:${uid}`;
    return `ip:${ipKeyGenerator(safeClientIp(req))}`;
  },
  message: {
    success: false,
    message: 'Too many order requests. Please try again shortly.',
    code: 'RATE_LIMITED',
  },
});

module.exports = {
  loginRouteLimiter,
  paymentRouteLimiter,
  orderWriteLimiter,
};
