const { createClient } = require('redis');
const env = require('./env');

/**
 * Optional Redis for cache / queues / Socket adapter. Safe mode: no REDIS_URL → memory-only (no TCP attempt).
 *
 * To enable: set REDIS_URL (e.g. redis://127.0.0.1:6379 or rediss://…)
 */
let redisClient = null;
let isConnected = false;
/** True when REDIS_URL was not set — intentional memory mode. */
let memoryModeByConfig = false;

async function initRedis() {
  const url = (env.redisUrl || '').trim();
  if (!url) {
    memoryModeByConfig = true;
    isConnected = false;
    redisClient = null;
    const off = String(process.env.REDIS_DISABLED || '').toLowerCase();
    const reason =
      off === '1' || off === 'true' || off === 'yes'
        ? 'REDIS_DISABLED — memory mode (no Redis connection attempted)'
        : 'REDIS_URL unset — memory mode (no Redis connection attempted)';
    // eslint-disable-next-line no-console
    console.log(`[redis] ${reason}`);
    return;
  }

  memoryModeByConfig = false;
  let client = null;
  try {
    client = createClient({
      url,
      socket: {
        /** No reconnect loop — avoids ECONNREFUSED spam when Redis is down. */
        reconnectStrategy: () => false,
      },
    });

    client.on('error', () => {
      isConnected = false;
    });

    await client.connect();

    redisClient = client;
    isConnected = true;
    // eslint-disable-next-line no-console
    console.log('✅ Redis Connected');
  } catch {
    isConnected = false;
    redisClient = null;
    if (client) {
      try {
        await client.quit();
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line no-console
    console.log('⚠️ Redis connection failed — continuing in memory mode');
  }
}

function getRedis() {
  if (!isConnected || !redisClient) return null;
  return redisClient.isReady ? redisClient : null;
}

/** Alias for callers expecting `getRedisClient()`. */
function getRedisClient() {
  return getRedis();
}

function getRedisHealthSummary() {
  if (memoryModeByConfig) {
    return { ok: true, mode: 'memory', connected: false, reason: 'REDIS_URL not set' };
  }
  const c = getRedis();
  if (c) return { ok: true, mode: 'redis', connected: true };
  return { ok: false, mode: 'redis', connected: false, reason: 'unavailable_or_down' };
}

const initRedisAppCache = initRedis;
const getRedisAppCache = getRedis;

module.exports = {
  initRedis,
  getRedis,
  getRedisClient,
  getRedisHealthSummary,
  initRedisAppCache,
  getRedisAppCache,
};
