const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const { effectiveAgentResponseStatus } = require('../utils/agentResponseStatus');
const { getCachedNearby, setCachedNearby } = require('../cache/apiCache');
const { getCacheJson, setCacheJson, delCache } = require('../utils/cache');
const { withDbTimeout } = require('../utils/dbSafe');

const APPROVED_AGENTS_CACHE_KEY = 'http:approved_agents_list:v1';
const APPROVED_AGENTS_TTL_SEC = 120;

async function invalidateApprovedAgentsListCache() {
  await delCache(APPROVED_AGENTS_CACHE_KEY);
}

function deriveLevel(avgRating, completedOrders) {
  if (avgRating >= 4.5 && completedOrders >= 20) return 'Pro';
  if (avgRating >= 3.8 && completedOrders >= 5) return 'Verified';
  return 'Beginner';
}

function deriveRestriction(avgRating, totalReviews) {
  return totalReviews >= 3 && avgRating < 2.5;
}

async function recomputeAgentMeta(agentId) {
  const agent = await User.findById(agentId);
  if (!agent || agent.role !== 'agent') return null;
  const reviews = Array.isArray(agent.reviews) ? agent.reviews : [];
  const totalReviews = reviews.length;
  const avgRating = totalReviews
    ? Number((reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / totalReviews).toFixed(2))
    : 0;
  agent.totalReviews = totalReviews;
  agent.avgRating = avgRating;
  agent.rating = avgRating;
  agent.agentLevel = deriveLevel(avgRating, Number(agent.completedOrders || 0));
  agent.isRestricted = deriveRestriction(avgRating, totalReviews);
  await agent.save();
  return agent;
}

function mapAgent(user, extra = {}) {
  const u = typeof user?.toObject === 'function' ? user.toObject() : user;
  const base = {
    id: String(u._id),
    shopName: u.shopName || '',
    phone: u.phone || '',
    address: u.address || '',
    city: u.city || '',
    state: u.state || '',
    pincode: u.pincode || '',
    isApproved: Boolean(u.isApproved),
    avgRating: Number(u.avgRating || 0),
    rating: Number(u.rating || 0),
    totalReviews: Number(u.totalReviews || 0),
    completedOrders: Number(u.completedOrders || 0),
    cancelledOrders: Number(u.cancelledOrders || 0),
    agentLevel: u.agentLevel || 'Beginner',
    isRestricted: Boolean(u.isRestricted),
    walletBalance: Number(u.walletBalance || 0),
    latitude: u.latitude != null && !Number.isNaN(Number(u.latitude)) ? Number(u.latitude) : null,
    longitude: u.longitude != null && !Number.isNaN(Number(u.longitude)) ? Number(u.longitude) : null,
    isOnline: Boolean(u.isOnline),
    currentOrder: u.currentOrder != null ? String(u.currentOrder) : null,
  };
  return { ...base, ...extra };
}

/** Haversine distance in km (Earth radius 6371 km). */
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function clampRadiusKm(raw) {
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0) return 15;
  return Math.min(20, Math.max(5, n));
}

/**
 * Shared geo nearby (DB + foundation, radius expansion). Used by GET /api/agents/nearby and legacy POST (shim).
 */
async function fetchNearbyGeoExpanded(lat, lng, limitRaw, radiusKmRaw) {
  const limitParsed = Number(limitRaw);
  const hasLimit = limitRaw != null && limitRaw !== '' && !Number.isNaN(limitParsed);
  const limit = Math.min(50, Math.max(1, hasLimit ? limitParsed : 50));
  let radiusKm = clampRadiusKm(radiusKmRaw);

  function agentsWithinRadius(radius) {
    return User.find({
      role: 'agent',
      isApproved: true,
      isRestricted: false,
      latitude: { $ne: null, $exists: true },
      longitude: { $ne: null, $exists: true },
    })
      .sort({ avgRating: -1 })
      .limit(250)
      .lean()
      .then((agentsRaw) => {
        const rows = agentsRaw
          .map((a) => {
            const alat = Number(a.latitude);
            const alng = Number(a.longitude);
            if (Number.isNaN(alat) || Number.isNaN(alng)) return null;
            const d = distanceKm(lat, lng, alat, alng);
            return { agent: a, distanceKm: d };
          })
          .filter(Boolean)
          .filter((x) => x.distanceKm <= radius)
          .sort((a, b) => {
            if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
            return Number(b.agent.avgRating || 0) - Number(a.agent.avgRating || 0);
          });
        return rows;
      });
  }

  let rows = await agentsWithinRadius(radiusKm);
  let expanded = false;
  let message = null;
  if (rows.length === 0) {
    expanded = true;
    message = 'Nearby agent not found — expanding search...';
    const wider = Math.min(50, Math.max(radiusKm * 2, 25));
    rows = await agentsWithinRadius(wider);
  }
  if (rows.length === 0) {
    rows = await agentsWithinRadius(20000);
    if (rows.length === 0) {
      message = 'No agents with saved location yet.';
    }
  }

  const mongoMapped = rows.map((x) =>
    mapAgent(x.agent, {
      distanceKm: Number(x.distanceKm.toFixed(2)),
      assignable: true,
      source: 'user',
    })
  );

  let foundationMapped = [];
  try {
    const { listAgents } = require('../utils/agentFoundationStore');
    foundationMapped = listAgents()
      .filter(
        (a) =>
          a.status === 'approved' &&
          a.location &&
          a.location.lat != null &&
          a.location.lng != null &&
          !Number.isNaN(Number(a.location.lat)) &&
          !Number.isNaN(Number(a.location.lng))
      )
      .map((a) => {
        const d = distanceKm(lat, lng, Number(a.location.lat), Number(a.location.lng));
        return {
          id: String(a.id),
          shopName: a.name || 'Foundation agent',
          phone: '',
          address: '',
          city: a.city || '',
          state: '',
          pincode: '',
          isApproved: true,
          avgRating: 0,
          rating: 0,
          totalReviews: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          agentLevel: 'Beginner',
          isRestricted: false,
          walletBalance: 0,
          latitude: Number(a.location.lat),
          longitude: Number(a.location.lng),
          distanceKm: Number(d.toFixed(2)),
          assignable: false,
          source: 'foundation',
          earnings: typeof a.earnings === 'number' ? a.earnings : 0,
        };
      });
  } catch {
    foundationMapped = [];
  }

  const combined = [...mongoMapped, ...foundationMapped].sort((a, b) => {
    const da = Number(a.distanceKm ?? 1e9);
    const db = Number(b.distanceKm ?? 1e9);
    if (da !== db) return da - db;
    return Number(b.avgRating || 0) - Number(a.avgRating || 0);
  });

  const agents = combined.slice(0, limit);

  return {
    agents,
    searchMode: 'geo',
    radiusKm,
    center: { lat, lng },
    expanded,
    message,
  };
}

/**
 * POST /api/agents/nearby — deprecated; use GET with ?lat=&lng=&limit=&radiusKm=.
 * Same response body as GET geo mode for backward compatibility.
 */
async function postNearbyAgents(req, res, next) {
  try {
    res.set('Deprecation', 'true');
    const body = req.body || {};
    const lat = body.lat != null ? Number(body.lat) : NaN;
    const lng = body.lng != null ? Number(body.lng) : NaN;
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Bad request', details: 'Valid lat and lng are required' });
    }
    const limit = body.limit;
    const radiusKm = body.radiusKm;
    const payload = await fetchNearbyGeoExpanded(lat, lng, limit, radiusKm);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

async function getNearbyAgents(req, res, next) {
  try {
    const cached = getCachedNearby(req);
    if (cached) {
      return res.status(200).json(cached);
    }

    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const pincode = typeof req.query.pincode === 'string' ? req.query.pincode.trim() : '';
    const latRaw = req.query.lat;
    const lngRaw = req.query.lng;
    const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : NaN;
    const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : NaN;
    const useGeo = !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    if (useGeo) {
      const limit = req.query.limit;
      const radiusKm = req.query.radiusKm;
      const payload = await fetchNearbyGeoExpanded(lat, lng, limit, radiusKm);
      setCachedNearby(req, payload);
      return res.status(200).json(payload);
    }

    const filter = { role: 'agent', isApproved: true };
    if (city) filter.city = city;
    if (pincode) filter.pincode = pincode;

    const agentsRaw = await User.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const score = (a) => {
      const pincodeScore = pincode && a.pincode && a.pincode === pincode ? 2 : 0;
      const cityScore = city && a.city && a.city.toLowerCase() === city.toLowerCase() ? 1 : 0;
      const trustScore = Number(a.avgRating || 0);
      return pincodeScore + cityScore + trustScore;
    };
    const agents = agentsRaw
      .filter((a) => !a.isRestricted)
      .sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return Number(b.totalReviews || 0) - Number(a.totalReviews || 0);
      })
      .slice(0, 50);
    const payloadCity = { agents: agents.map((a) => mapAgent(a)), searchMode: 'city', center: null };
    setCachedNearby(req, payloadCity);
    return res.status(200).json(payloadCity);
  } catch (err) {
    return next(err);
  }
}

async function getPendingAgents(req, res, next) {
  try {
    const agents = await User.find({ role: 'agent', isApproved: false }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ agents: agents.map(mapAgent) });
  } catch (err) {
    return next(err);
  }
}

async function approveAgent(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid agent id' });
    }

    const updated = await User.findOneAndUpdate(
      { _id: id, role: 'agent' },
      { $set: { isApproved: true } },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    await invalidateApprovedAgentsListCache();
    return res.status(200).json({ agent: mapAgent(updated) });
  } catch (err) {
    return next(err);
  }
}

async function rejectAgent(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid agent id' });
    }
    const updated = await User.findOneAndUpdate(
      { _id: id, role: 'agent' },
      { $set: { isApproved: false } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: 'Agent not found' });
    await invalidateApprovedAgentsListCache();
    return res.status(200).json({ agent: mapAgent(updated) });
  } catch (err) {
    return next(err);
  }
}

async function getApprovedAgents(req, res, next) {
  try {
    const hit = await getCacheJson(APPROVED_AGENTS_CACHE_KEY);
    if (hit && Array.isArray(hit.agents)) {
      return res.status(200).json(hit);
    }
    const agents = await withDbTimeout(
      User.find({ role: 'agent', isApproved: true }).sort({ avgRating: -1 }).lean(),
      12_000,
      null
    );
    if (!agents) {
      return res.status(200).json({
        agents: [],
        degraded: true,
        message: 'List temporarily unavailable; database slow or unreachable.',
      });
    }
    const payload = { agents: agents.map(mapAgent) };
    await setCacheJson(APPROVED_AGENTS_CACHE_KEY, payload, APPROVED_AGENTS_TTL_SEC);
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

function parseLatLng(val) {
  if (val == null || val === '') return null;
  const n = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(n)) return null;
  return n;
}

/** POST /api/agents/location — agent-only; saves GPS for nearest-order matching (no map SDK). */
async function postAgentLocation(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const existing = await User.findById(userId).lean();
    if (!existing || existing.role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden', details: 'Agents only' });
    }

    const { lat, lng } = req.body || {};
    const latitude = parseLatLng(lat);
    const longitude = parseLatLng(lng);
    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: 'Bad request', details: 'lat and lng are required' });
    }
    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({ message: 'Bad request', details: 'lat must be between -90 and 90' });
    }
    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({ message: 'Bad request', details: 'lng must be between -180 and 180' });
    }

    await User.findByIdAndUpdate(userId, { $set: { latitude, longitude } }, { runValidators: false });
    return res.status(200).json({
      success: true,
      location: { lat: latitude, lng: longitude },
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/agents/online — body `{ online: boolean }` */
async function postAgentOnlineToggle(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const me = await User.findById(userId).lean();
    if (!me || me.role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden', details: 'Agents only' });
    }
    const { online } = req.body || {};
    if (typeof online !== 'boolean') {
      return res.status(400).json({ message: 'Bad request', details: 'online (boolean) is required' });
    }
    await User.findByIdAndUpdate(userId, { $set: { isOnline: online } }, { runValidators: false });
    const u = await User.findById(userId).lean();
    return res.status(200).json({ success: true, isOnline: Boolean(u.isOnline) });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/agents/assignment-requests — orders awaiting accept/reject (polling). */
async function getAgentAssignmentRequests(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const me = await User.findById(userId).lean();
    if (!me || me.role !== 'agent' || !me.isApproved) {
      return res.status(403).json({ message: 'Forbidden', details: 'Agents only' });
    }

    const orders = await Order.find({ agent: userId, agentResponseStatus: 'pending' })
      .populate('user', 'name phone')
      .populate('service', 'name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const orderController = require('./orderController');
    return res.status(200).json({
      requests: orders.map((o) => orderController.formatOrder(o, { includeUser: true })),
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/agents/assignment-respond — body `{ orderId, action: 'accept' | 'reject' }` */
async function postAgentAssignmentRespond(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { orderId, action } = req.body || {};
    const oid = orderId != null ? String(orderId).trim() : '';
    if (!oid || !mongoose.Types.ObjectId.isValid(oid)) {
      return res.status(400).json({ message: 'Bad request', details: 'orderId required' });
    }
    const act = String(action || '').toLowerCase();
    if (!['accept', 'reject'].includes(act)) {
      return res.status(400).json({ message: 'Bad request', details: 'action must be accept or reject' });
    }

    const order = await Order.findById(oid).lean();
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (!order.agent || String(order.agent) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Not your assignment' });
    }
    if (effectiveAgentResponseStatus(order) !== 'pending') {
      return res.status(400).json({ message: 'Bad request', details: 'This order is not awaiting your response' });
    }

    const orderController = require('./orderController');
    const { orderAllowsFulfillmentWork, paymentStatusCaptured, sendPaymentRequired } = require('../utils/orderPaymentGate');

    if (act === 'accept') {
      if (!orderAllowsFulfillmentWork(order)) {
        return sendPaymentRequired(res);
      }
      await Order.findByIdAndUpdate(
        oid,
        { $set: { agentResponseStatus: 'accepted', status: 'processing' } },
        { runValidators: false }
      );
      await User.findByIdAndUpdate(userId, { $set: { currentOrder: oid } }, { runValidators: false });
      const populated = await Order.findById(oid)
        .populate('user', 'name phone')
        .populate('service', 'name')
        .populate(
          'agent',
          'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
        )
        .lean();
      const formatted = orderController.formatOrder(populated, { includeUser: true });
      const io = req.app && req.app.get('io');
      if (io && formatted) {
        const { emitOrderUpdate } = require('../socket/orderEvents');
        emitOrderUpdate(io, formatted);
      }
      return res.status(200).json({ success: true, order: formatted });
    }

    const nextSt = paymentStatusCaptured(order.paymentStatus) ? 'paid' : 'pending_payment';
    await Order.findByIdAndUpdate(
      oid,
      {
        $set: { agent: null, agentResponseStatus: 'none', status: nextSt },
        $unset: { preferredAgent: 1 },
      },
      { runValidators: false }
    );
    await User.findByIdAndUpdate(userId, { $inc: { activeOrders: -1 }, $set: { currentOrder: null } }, { runValidators: false });

    await orderController.autoAssignAgent(oid);

    const after = await Order.findById(oid)
      .populate('user', 'name phone')
      .populate('service', 'name')
      .populate(
        'agent',
        'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
      )
      .lean();
    const formatted = after ? orderController.formatOrder(after, { includeUser: true }) : null;
    const io = req.app && req.app.get('io');
    if (io && formatted) {
      const { emitOrderUpdate } = require('../socket/orderEvents');
      emitOrderUpdate(io, formatted);
    }
    return res.status(200).json({ success: true, order: formatted, reassigned: true });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/agents/:agentId/dashboard — assigned orders + earnings summary (agent reads self; admin reads any).
 * Canonical agent data: `User` (`role: 'agent'`), orders use `agent` + `agentEarning`; wallet credits on payment release.
 */
async function getAgentDashboard(req, res, next) {
  try {
    const { agentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid agent id' });
    }
    const uid = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (role !== 'admin' && role !== 'super_admin' && String(uid) !== String(agentId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const agent = await User.findOne({ _id: agentId, role: 'agent' })
      .select('name walletBalance totalEarnings isApproved')
      .lean();
    if (!agent) {
      return res.status(404).json({ message: 'Not found' });
    }

    const orders = await Order.find({ agent: agentId })
      .populate('user', 'name phone')
      .populate('service', 'name')
      .populate(
        'agent',
        'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const orderController = require('./orderController');
    const earnings = orders.reduce((sum, o) => sum + Number(o.agentEarning || 0), 0);

    return res.status(200).json({
      agent: {
        id: String(agentId),
        name: agent.name || '',
        verified: Boolean(agent.isApproved),
        walletBalance: Number(agent.walletBalance || 0),
        totalEarnings: Number(agent.totalEarnings || 0),
      },
      orders: orders.map((o) => orderController.formatOrder(o, { includeUser: true })),
      earnings,
    });
  } catch (err) {
    return next(err);
  }
}

async function updateAgentControl(req, res, next) {
  try {
    const { id } = req.params;
    const { isRestricted, agentLevel } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid agent id' });
    }
    const updates = {};
    if (typeof isRestricted === 'boolean') updates.isRestricted = isRestricted;
    if (['Beginner', 'Verified', 'Pro'].includes(agentLevel)) updates.agentLevel = agentLevel;

    const updated = await User.findOneAndUpdate({ _id: id, role: 'agent' }, { $set: updates }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: 'Agent not found' });
    return res.status(200).json({ agent: mapAgent(updated) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getNearbyAgents,
  postNearbyAgents,
  getPendingAgents,
  approveAgent,
  rejectAgent,
  getApprovedAgents,
  postAgentLocation,
  postAgentOnlineToggle,
  getAgentAssignmentRequests,
  postAgentAssignmentRespond,
  getAgentDashboard,
  updateAgentControl,
  recomputeAgentMeta,
};
