const buckets = new Map();

function isRateLimitDisabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.DISABLE_API_RATE_LIMIT || '').toLowerCase() === 'true';
}

/**
 * @param {{ windowMs?: number, max?: number, keyGenerator?: (req: import('express').Request) => string }} opts
 */
function createRateLimiter({ windowMs = 60_000, max = 120, keyGenerator } = {}) {
  return function rateLimit(req, res, next) {
    if (isRateLimitDisabled()) return next();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = keyGenerator ? keyGenerator(req) : `${ip}:${req.path}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || now - existing.start > windowMs) {
      buckets.set(key, { count: 1, start: now });
      return next();
    }
    existing.count += 1;
    if (existing.count > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({
        success: false,
        data: null,
        message: 'Too many requests. Please try again shortly.',
        errorCode: 'RATE_LIMITED',
      });
    }
    return next();
  };
}

module.exports = {
  createRateLimiter,
};

