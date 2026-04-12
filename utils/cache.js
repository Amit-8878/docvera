const NodeCache = require('node-cache');
const { getRedisClient } = require('../config/redis');

const PREFIX = 'docvera:cache:';
const memory = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

/**
 * @param {string} key
 * @returns {Promise<string|null>}
 */
async function getCache(key) {
  const k = String(key || '');
  if (!k) return null;
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(PREFIX + k);
      return raw == null ? null : String(raw);
    } catch {
      /* fall through */
    }
  }
  const m = memory.get(k);
  return m == null ? null : String(m);
}

/**
 * @param {string} key
 * @param {string} value
 * @param {number} ttlSec
 */
async function setCache(key, value, ttlSec = 300) {
  const k = String(key || '');
  if (!k) return;
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  const ttl = Math.max(1, Number(ttlSec) || 300);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(PREFIX + k, v, { EX: ttl });
    } catch {
      /* ignore */
    }
  }
  memory.set(k, v, ttl);
}

/**
 * @param {string} key
 * @returns {Promise<T|null>}
 * @template T
 */
async function getCacheJson(key) {
  const raw = await getCache(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setCacheJson(key, obj, ttlSec) {
  await setCache(key, JSON.stringify(obj), ttlSec);
}

async function delCache(key) {
  const k = String(key || '');
  if (!k) return;
  memory.del(k);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(PREFIX + k);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  getCache,
  setCache,
  getCacheJson,
  setCacheJson,
  delCache,
};
