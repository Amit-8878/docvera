const NodeCache = require('node-cache');
const { getCacheJson, setCacheJson } = require('../utils/cache');

/** Bumped on invalidate so Redis keys from older epochs are ignored without SCAN/delete. */
let servicesCacheEpoch = 0;

/** Services list + search: 8 minutes (within 5–10m requirement). */
const serviceCache = new NodeCache({
  stdTTL: 480,
  checkperiod: 120,
  useClones: false,
});

/** Nearby agents (geo + city modes): 3 minutes (within 2–5m). */
const nearbyAgentsCache = new NodeCache({
  stdTTL: 180,
  checkperiod: 60,
  useClones: false,
});

function servicesListKey(req) {
  const isAdmin = req.user && req.user.role === 'admin';
  const cat = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const catExact = typeof req.query.cat === 'string' ? req.query.cat.trim() : '';
  const industry = typeof req.query.industry === 'string' ? req.query.industry.trim() : '';
  return `list:${isAdmin ? 'a' : 'u'}:${cat}:${catExact}:${industry}`;
}

function servicesSearchKey(req) {
  const isAdmin = req.user && req.user.role === 'admin';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const cat = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const ind = typeof req.query.industry === 'string' ? req.query.industry.trim() : '';
  return `search:${isAdmin ? 'a' : 'u'}:${q}:${cat}:${ind}`;
}

function nearbyKey(req) {
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
  const pincode = typeof req.query.pincode === 'string' ? req.query.pincode.trim() : '';
  const lat = req.query.lat != null ? String(req.query.lat) : '';
  const lng = req.query.lng != null ? String(req.query.lng) : '';
  const r = req.query.radiusKm != null ? String(req.query.radiusKm) : '';
  const lim = req.query.limit != null ? String(req.query.limit) : '';
  return `near:${city}:${pincode}:${lat}:${lng}:${r}:${lim}`;
}

function getCachedServicesList(req) {
  return serviceCache.get(servicesListKey(req));
}

async function getCachedServicesListWithRedis(req) {
  const mem = serviceCache.get(servicesListKey(req));
  if (mem) return mem;
  const redisKey = `svclist:e${servicesCacheEpoch}:${servicesListKey(req)}`;
  const remote = await getCacheJson(redisKey);
  if (remote) {
    serviceCache.set(servicesListKey(req), remote);
  }
  return remote || undefined;
}

function setCachedServicesList(req, payload) {
  serviceCache.set(servicesListKey(req), payload);
}

async function setCachedServicesListWithRedis(req, payload) {
  serviceCache.set(servicesListKey(req), payload);
  const redisKey = `svclist:e${servicesCacheEpoch}:${servicesListKey(req)}`;
  await setCacheJson(redisKey, payload, 480);
}

function getCachedSearch(req) {
  return serviceCache.get(servicesSearchKey(req));
}

function setCachedSearch(req, payload) {
  serviceCache.set(servicesSearchKey(req), payload);
}

function getCachedNearby(req) {
  return nearbyAgentsCache.get(nearbyKey(req));
}

function setCachedNearby(req, payload) {
  nearbyAgentsCache.set(nearbyKey(req), payload);
}

/** Call after any service create/update/delete/toggle. */
function invalidateServiceCaches() {
  serviceCache.flushAll();
  servicesCacheEpoch += 1;
}

function invalidateNearbyCaches() {
  nearbyAgentsCache.flushAll();
}

module.exports = {
  servicesListKey,
  servicesSearchKey,
  nearbyKey,
  getCachedServicesList,
  getCachedServicesListWithRedis,
  setCachedServicesList,
  setCachedServicesListWithRedis,
  getCachedSearch,
  setCachedSearch,
  getCachedNearby,
  setCachedNearby,
  invalidateServiceCaches,
  invalidateNearbyCaches,
};
