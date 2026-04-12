const env = require('../config/env');

/**
 * Log suspicious or notable API outcomes (429, 401 bursts, etc.).
 * Called from error handler / optional middleware.
 */
function logSecurityEvent(payload) {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: payload.level || 'warn',
      type: 'security_event',
      env: env.nodeEnv,
      ...payload,
      at: new Date().toISOString(),
    })
  );
}

module.exports = {
  logSecurityEvent,
};
