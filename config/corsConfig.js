const env = require('./env');

/**
 * Allowed browser origins (comma-separated CLIENT_URL or CORS_ORIGINS).
 * Production: must include your Vercel / frontend URL(s), no trailing slash.
 */
function buildAllowedOrigins() {
  const raw = process.env.CLIENT_URL || process.env.CORS_ORIGINS || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (env.nodeEnv !== 'production') {
    const devDefaults = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    return [...new Set([...fromEnv, ...devDefaults])];
  }
  return fromEnv;
}

/**
 * Express `cors` origin callback. Non-browser requests (no Origin) are allowed.
 */
function corsOrigin(origin, callback) {
  const allowed = buildAllowedOrigins();
  if (!origin) {
    return callback(null, true);
  }
  if (allowed.length === 0) {
    if (env.nodeEnv !== 'production') {
      return callback(null, true);
    }
    // eslint-disable-next-line no-console
    console.warn('[cors] Set CLIENT_URL (or CORS_ORIGINS) so the web app can call this API.');
    return callback(null, false);
  }
  if (allowed.some((a) => origin === a || origin === `${a}/`)) {
    return callback(null, true);
  }
  if (env.nodeEnv !== 'production' && /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error('Not allowed by CORS'));
}

/** Socket.IO `cors.origin` — array or boolean. */
function socketCorsOrigin() {
  const allowed = buildAllowedOrigins();
  if (allowed.length > 0) return allowed;
  if (env.nodeEnv !== 'production') return true;
  return false;
}

module.exports = {
  buildAllowedOrigins,
  corsOrigin,
  socketCorsOrigin,
};
