/**
 * BullMQ connections via ioredis (REDIS_URL). Required for durable queues across API restarts.
 * Each caller should typically hold one connection instance per process (see jobQueue / mainQueue).
 */

const IORedis = require('ioredis');
const env = require('./env');

/**
 * @returns {import('ioredis').default | null}
 */
function getBullConnection() {
  const raw = (env.redisUrl || '').trim();
  if (!raw) return null;
  try {
    return new IORedis(raw, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      enableOfflineQueue: false,
      /** No reconnect loop — avoids continuous ECONNREFUSED when Redis is down. */
      retryStrategy: () => null,
    });
  } catch {
    return null;
  }
}

module.exports = { getBullConnection };
