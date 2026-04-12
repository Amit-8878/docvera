/**
 * Pure helpers split from orderController — same behavior, no route handlers.
 */
const mongoose = require('mongoose');
const { effectiveAgentResponseStatus } = require('../../../utils/agentResponseStatus');
const { PLATFORM_FEE_PERCENT, HIGH_VALUE_ORDER_INR, MAX_AGENT_ACTIVE_ASSIGNMENTS } = require('./orderConstants');

function buildOrderFlags(totalPrice) {
  const flags = [];
  const t = Number(totalPrice || 0);
  if (t > HIGH_VALUE_ORDER_INR) flags.push('high_value');
  return flags;
}

function agentPassesLoadAndPresence(agent) {
  if (!agent) return false;
  const n = Number(agent.activeOrders || 0);
  if (n >= MAX_AGENT_ACTIVE_ASSIGNMENTS) return false;
  return agent.isOnline === true;
}

function filterAgentsForSafety(agents) {
  return agents.filter((a) => agentPassesLoadAndPresence(a));
}

function parseJsonMaybe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return fallback;
}

function calculateSplit(totalPrice) {
  const total = Number(totalPrice || 0);
  const platformFee = Number((total * PLATFORM_FEE_PERCENT).toFixed(2));
  const agentEarning = Number((total - platformFee).toFixed(2));
  return { platformFee, agentEarning };
}

function normLoc(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/** Same rules as manual assign: Beginner only for Personal; Verified/Pro for any category. */
function agentEligibleForServiceCategory(agent, category) {
  const cat = String(category || 'Personal');
  if (agent.agentLevel === 'Beginner') return cat === 'Personal';
  return agent.agentLevel === 'Verified' || agent.agentLevel === 'Pro';
}

function locationMatch(agent, uCity, uState) {
  const ac = normLoc(agent.city);
  const as = normLoc(agent.state);
  const uc = normLoc(uCity);
  const us = normLoc(uState);
  if (uc && us) return ac === uc && as === us;
  if (us && !uc) return as === us;
  if (uc && !us) return ac === uc;
  return false;
}

function sortAgentsForAutoAssign(agents) {
  return [...agents].sort((a, b) => {
    const ra = Number(a.avgRating || 0);
    const rb = Number(b.avgRating || 0);
    if (rb !== ra) return rb - ra;
    const la = Number(a.activeOrders || 0);
    const lb = Number(b.activeOrders || 0);
    return la - lb;
  });
}

/** Parse optional `{ lat, lng }` from JSON or multipart body (stringified JSON allowed). */
function parseCustomerLocation(body) {
  if (!body || typeof body !== 'object') return null;
  let loc = body.location || body.customerLocation;
  if (typeof loc === 'string') {
    try {
      loc = JSON.parse(loc);
    } catch {
      return null;
    }
  }
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parsePreferredAgentId(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.preferredAgentId ?? body.selectedAgentId;
  if (raw == null) return null;
  const s = typeof raw === 'string' ? raw.trim() : String(raw);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return s;
}

/** Client may only request admin queue this way (no spoofed agent ids). */
function parseAssignedToFromBody(body) {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.assignedTo === 'string' && body.assignedTo.trim() === 'admin') return 'admin';
  return '';
}

function agentGeoPoint(agent) {
  if (agent.latitude == null || agent.longitude == null) return null;
  const lat = Number(agent.latitude);
  const lng = Number(agent.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/** All current service orders use an agent in the workflow. */
function serviceRequiresAgent(_service) {
  return true;
}

function trackingProgressForStatus(status) {
  switch (status) {
    case 'pending_payment':
      return { step: 0, label: 'Payment required', percent: 0 };
    case 'paid':
      return { step: 1, label: 'Paid', percent: 40 };
    case 'pending':
      return { step: 1, label: 'New', percent: 33 };
    case 'assigned':
    case 'processing':
      return { step: 2, label: 'In progress', percent: 66 };
    case 'completed':
      return { step: 3, label: 'Completed', percent: 100 };
    case 'cancelled':
      return { step: 0, label: 'Rejected', percent: 0 };
    case 'failed':
      return { step: 0, label: 'Failed', percent: 0 };
    default:
      return { step: 1, label: 'New', percent: 25 };
  }
}

/** User-visible pipeline: pending → assigned (await accept) → processing → completed */
function trackingProgressForOrder(o) {
  const ar = effectiveAgentResponseStatus(o);
  const st = String(o?.status || '');
  const hasAgent = Boolean(o?.agent);
  const ps = String(o?.paymentStatus || '');
  const paymentCaptured = ['held', 'paid', 'released'].includes(ps);

  if (st === 'cancelled' || st === 'failed') {
    return { step: 0, label: st === 'failed' ? 'Failed' : 'Cancelled', percent: 0, pipeline: st };
  }
  if (st === 'completed') {
    return { step: 4, label: 'Completed', percent: 100, pipeline: 'completed' };
  }
  if (st === 'pending_payment' || (st === 'pending' && !paymentCaptured && !hasAgent)) {
    return { step: 0, label: 'Payment required', percent: 0, pipeline: 'pending_payment' };
  }
  if ((st === 'paid' || st === 'pending') && !hasAgent) {
    if (o.assignedTo === 'admin') {
      return { step: 2, label: 'Assigned to our team', percent: 50, pipeline: 'admin_queue' };
    }
    return { step: 1, label: 'Finding agent', percent: 25, pipeline: 'pending' };
  }
  if (st === 'assigned' && ar === 'pending') {
    return { step: 2, label: 'Awaiting agent acceptance', percent: 45, pipeline: 'awaiting_accept' };
  }
  if (st === 'processing' || (st === 'assigned' && ar === 'accepted')) {
    return { step: 3, label: 'In progress', percent: 75, pipeline: 'in_progress' };
  }
  return { step: 1, label: 'Placed', percent: 30, pipeline: 'open' };
}

function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  buildOrderFlags,
  agentPassesLoadAndPresence,
  filterAgentsForSafety,
  parseJsonMaybe,
  calculateSplit,
  normLoc,
  agentEligibleForServiceCategory,
  locationMatch,
  sortAgentsForAutoAssign,
  parseCustomerLocation,
  parsePreferredAgentId,
  parseAssignedToFromBody,
  agentGeoPoint,
  serviceRequiresAgent,
  trackingProgressForStatus,
  trackingProgressForOrder,
  escapeRx,
};
