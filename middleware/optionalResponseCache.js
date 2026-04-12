const { getRedis } = require('../config/redis');

/**
 * Cache GET JSON responses in Redis (short TTL). Skips when:
 * - not GET
 * - Authorization header present (avoid cross-user leakage)
 * - Redis unavailable
 */
function optionalResponseCache(ttlSeconds = 60) {
  return async function optionalResponseCacheMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();
    if (req.headers.authorization || req.headers.Authorization) return next();

    const redis = getRedis();
    if (!redis) return next();

    const key = `httpcache:${req.method}:${req.originalUrl || req.url}`;

    try {
      const hit = await redis.get(key);
      if (hit) {
        res.set('X-Cache', 'HIT');
        return res.status(200).type('application/json').send(hit);
      }
    } catch {
      return next();
    }

    const origJson = res.json.bind(res);
    res.json = function jsonWithCache(body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      redis.setEx(key, ttlSeconds, payload).catch(() => {});
      res.set('X-Cache', 'MISS');
      return origJson(body);
    };

    next();
  };
}

module.exports = { optionalResponseCache };
