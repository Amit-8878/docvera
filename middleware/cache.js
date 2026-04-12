const { getRedis } = require('../config/redis');

/**
 * Safe JSON response cache (GET, no Authorization). Fails open on any error.
 * Prefer `optionalResponseCache(ttl)` for explicit TTL; this uses 60s.
 */
async function cacheMiddleware(req, res, next) {
  try {
    if (req.method !== 'GET') return next();
    if (req.headers.authorization || req.headers.Authorization) return next();

    const redis = getRedis();
    if (!redis) return next();

    const key = `cache:${req.originalUrl || req.url}`;
    const cached = await redis.get(key);
    if (cached) {
      return res.status(200).type('application/json').send(cached);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        redis.setEx(key, 60, JSON.stringify(body)).catch(() => {});
      } catch {
        /* ignore */
      }
      return originalJson(body);
    };

    next();
  } catch {
    next();
  }
}

module.exports = { cacheMiddleware };
