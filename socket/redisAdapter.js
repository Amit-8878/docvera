const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const env = require('../config/env');

/**
 * Cross-process Socket.IO broadcast (PM2 cluster / multiple servers).
 * If REDIS_URL is unset or Redis is down, continues without adapter (single process only).
 */
async function setupRedisAdapter(io) {
  const url = typeof env.redisUrl === 'string' ? env.redisUrl.trim() : '';
  if (!url) {
    // eslint-disable-next-line no-console
    console.warn('[socket] REDIS_URL not set — Redis adapter skipped (OK for single-node dev)');
    return false;
  }

  const socketOpts = {
    reconnectStrategy: () => false,
  };

  try {
    const pubClient = createClient({ url, socket: socketOpts });
    const subClient = pubClient.duplicate();
    pubClient.on('error', () => {
      /* one-shot; no reconnect — avoid log spam */
    });
    subClient.on('error', () => {
      /* one-shot */
    });
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    // eslint-disable-next-line no-console
    console.log('[socket] Redis adapter enabled');
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[socket] Redis adapter failed — continuing without:', e && e.message ? e.message : e);
    return false;
  }
}

module.exports = { setupRedisAdapter };
