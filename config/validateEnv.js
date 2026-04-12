const DEV_JWT_PLACEHOLDER = 'dev-only-change-me';

/**
 * Fail fast in production when secrets are missing or unsafe.
 * Call after dotenv has loaded.
 */
function assertProductionSafe() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_PLACEHOLDER) {
    errors.push('JWT_SECRET must be set to a strong random value in production.');
  }
  if (!process.env.MONGO_URI) {
    errors.push('MONGO_URI must be set in production.');
  }
  if (!process.env.REDIS_URL || !String(process.env.REDIS_URL).trim()) {
    errors.push('REDIS_URL must be set in production (BullMQ order jobs and durable queues).');
  }
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error('[FATAL]', errors.join(' '));
    process.exit(1);
  }
}

module.exports = { assertProductionSafe };
