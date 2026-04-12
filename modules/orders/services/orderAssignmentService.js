/**
 * Agent discovery, auto-assign, accept-timeout reassign, manual assign, agent status updates, auto-assign trigger.
 */
const mongoose = require('mongoose');
const Order = require('../../../models/Order');
const User = require('../../../models/User');
const { createNotification, notifyRoleUsers } = require('../../../services/notificationService');
const { orderAllowsFulfillmentWork, paymentStatusCaptured } = require('../../../utils/orderPaymentGate');
const { effectiveAgentResponseStatus } = require('../../../utils/agentResponseStatus');
const { getDistance } = require('../../../utils/geoAssign');
const ph = require('../parts/orderPureHelpers');
const { AGENT_ACCEPT_TIMEOUT_MS } = require('../parts/orderConstants');
const { notifyOrderAgentAssignment } = require('./orderNotificationService');
const { bad, good, formatOrder } = require('./orderQueryService');

async function recomputeAgentMeta(agentId) {
  const ac = require('../../../controllers/agentController');
  return ac.recomputeAgentMeta(agentId);
}

async function findAgentsForAutoAssignNearest(category, userLat, userLng) {
  const agents = await User.find({
    role: 'agent',
    isApproved: true,
    isRestricted: false,
    latitude: { $ne: null, $exists: true },
    longitude: { $ne: null, $exists: true },
  }).lean();

  const cat = String(category || 'Personal');
  const pool = agents.filter((a) => ph.agentEligibleForServiceCategory(a, cat));
  const withDist = [];
  const userPt = { lat: userLat, lng: userLng };
  for (const a of pool) {
    const pt = ph.agentGeoPoint(a);
    if (!pt) continue;
    const dist = getDistance(pt, userPt);
    if (!Number.isFinite(dist)) continue;
    withDist.push({ agent: a, dist });
  }
  withDist.sort((x, y) => {
    if (x.dist !== y.dist) return x.dist - y.dist;
    const ra = Number(x.agent.avgRating || 0);
    const rb = Number(y.agent.avgRating || 0);
    if (rb !== ra) return rb - ra;
    return Number(x.agent.activeOrders || 0) - Number(y.agent.activeOrders || 0);
  });
  return ph.filterAgentsForSafety(withDist.map((x) => x.agent));
}

async function findAgentsForAutoAssign(serviceCategory, uCity, uState) {
  const agents = await User.find({
    role: 'agent',
    isApproved: true,
    isRestricted: false,
  }).lean();

  const cat = String(serviceCategory || 'Personal');
  const pool = agents.filter((a) => ph.agentEligibleForServiceCategory(a, cat));

  let matched = pool.filter((a) => ph.locationMatch(a, uCity, uState));
  if (matched.length === 0) {
    const us = ph.normLoc(uState);
    if (us) {
      matched = pool.filter((a) => ph.normLoc(a.state) === us);
    }
  }
  if (matched.length === 0) {
    const uc = ph.normLoc(uCity);
    if (uc) {
      matched = pool.filter((a) => ph.normLoc(a.city) === uc);
    }
  }

  return ph.filterAgentsForSafety(ph.sortAgentsForAutoAssign(matched));
}

async function autoAssignAgent(orderId) {
  const oid = typeof orderId === 'string' ? orderId : String(orderId);
  if (!mongoose.Types.ObjectId.isValid(oid)) {
    return { ok: false, reason: 'invalid_id' };
  }

  const order = await Order.findById(oid)
    .populate('user', 'city state name')
    .populate('service', 'category name')
    .lean();

  if (!order) return { ok: false, reason: 'not_found' };
  if (order.requestType === 'custom') return { ok: false, reason: 'custom_request' };
  if (order.agent) return { ok: false, reason: 'already_assigned' };
  if (order.assignedTo === 'admin' && !order.agent) {
    return { ok: false, reason: 'admin_queue' };
  }
  if (order.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (!orderAllowsFulfillmentWork(order)) {
    return { ok: false, reason: 'payment_required' };
  }

  const service = order.service && typeof order.service === 'object' ? order.service : null;
  if (!ph.serviceRequiresAgent(service)) {
    return { ok: false, reason: 'no_agent_needed' };
  }

  const user = order.user && typeof order.user === 'object' ? order.user : null;
  const uCity = user?.city || '';
  const uState = user?.state || '';
  const category = service?.category || 'Personal';

  const prefRaw = order.preferredAgent;
  if (prefRaw && !order.agent) {
    const pid = mongoose.Types.ObjectId.isValid(String(prefRaw)) ? String(prefRaw) : null;
    if (pid) {
      const prefAgent = await User.findOne({
        _id: pid,
        role: 'agent',
        isApproved: true,
        isRestricted: false,
      }).lean();
      if (
        prefAgent &&
        ph.agentEligibleForServiceCategory(prefAgent, category) &&
        ph.agentPassesLoadAndPresence(prefAgent)
      ) {
        await Order.findByIdAndUpdate(
          oid,
          {
            $set: {
              agent: prefAgent._id,
              assignedTo: String(prefAgent._id),
              status: 'assigned',
              agentResponseStatus: 'pending',
              agentAssignedAt: new Date(),
            },
            $unset: { preferredAgent: 1 },
          },
          { runValidators: false }
        );
        await User.findByIdAndUpdate(
          prefAgent._id,
          { $inc: { activeOrders: 1 }, $set: { currentOrder: oid } },
          { runValidators: false }
        );
        const populated = await Order.findById(oid)
          .populate('user', 'name phone')
          .populate('service', 'name')
          .populate(
            'agent',
            'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
          )
          .lean();
        await notifyOrderAgentAssignment(populated);
        return { ok: true, agentId: String(prefAgent._id) };
      }
    }
  }

  const cl = order.customerLocation;
  const hasUserGeo =
    cl &&
    typeof cl.lat === 'number' &&
    typeof cl.lng === 'number' &&
    !Number.isNaN(cl.lat) &&
    !Number.isNaN(cl.lng) &&
    cl.lat >= -90 &&
    cl.lat <= 90 &&
    cl.lng >= -180 &&
    cl.lng <= 180;

  if (!ph.normLoc(uCity) && !ph.normLoc(uState) && !hasUserGeo) {
    await notifyRoleUsers('admin', {
      title: 'Auto-assign skipped',
      message: `Order ${oid}: add city/state on profile or send browser location with the order.`,
      type: 'system',
      event: 'auto_assign_skipped',
      data: { orderId: oid, reason: 'no_user_location' },
      dedupeKey: `auto_assign_skip_${oid}`,
    });
    return { ok: false, reason: 'no_user_location' };
  }

  let ranked = [];
  if (hasUserGeo) {
    ranked = await findAgentsForAutoAssignNearest(category, cl.lat, cl.lng);
    if (!ranked.length) {
      console.log('[safety] geo agent pool empty after filters — fallback city/state', { orderId: oid });
    }
  }
  if (!ranked.length) {
    ranked = await findAgentsForAutoAssign(category, uCity, uState);
  }
  if (!ranked.length) {
    await Order.findByIdAndUpdate(
      oid,
      {
        $set: {
          assignedTo: 'admin',
          agent: null,
          agentResponseStatus: 'none',
        },
      },
      { runValidators: false }
    );
    await notifyRoleUsers('admin', {
      title: 'Order in admin queue',
      message: `Order ${oid}: no agent in area for category ${category} — assigned to admin queue.`,
      type: 'system',
      event: 'order_admin_queue',
      data: { orderId: oid, reason: 'no_agent_in_area' },
      dedupeKey: `admin_queue_${oid}`,
    });
    return { ok: true, assignedTo: 'admin' };
  }

  const best = ranked[0];
  await Order.findByIdAndUpdate(
    oid,
    {
      $set: {
        agent: best._id,
        assignedTo: String(best._id),
        status: 'assigned',
        agentResponseStatus: 'pending',
        agentAssignedAt: new Date(),
      },
    },
    { runValidators: false }
  );
  await User.findByIdAndUpdate(
    best._id,
    { $inc: { activeOrders: 1 }, $set: { currentOrder: oid } },
    { runValidators: false }
  );

  const populated = await Order.findById(oid)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();

  await notifyOrderAgentAssignment(populated);

  return { ok: true, agentId: String(best._id) };
}

async function maybeReassignIfAcceptTimeout(orderDoc) {
  const o = typeof orderDoc?.toObject === 'function' ? orderDoc.toObject() : orderDoc;
  if (!o || !o._id) return orderDoc;
  if (o.status !== 'assigned' || o.agentResponseStatus !== 'pending') return orderDoc;
  const at = o.agentAssignedAt ? new Date(o.agentAssignedAt).getTime() : 0;
  if (!at || Date.now() - at < AGENT_ACCEPT_TIMEOUT_MS) return orderDoc;

  const oid = o._id;
  const oldAgentId =
    o.agent && typeof o.agent === 'object' && o.agent._id != null ? o.agent._id : o.agent ? o.agent : null;

  const nextStatus = paymentStatusCaptured(o.paymentStatus) ? 'paid' : 'pending_payment';
  await Order.findByIdAndUpdate(
    oid,
    {
      $set: { agent: null, status: nextStatus, agentResponseStatus: 'none' },
      $unset: { agentAssignedAt: 1 },
    },
    { runValidators: false }
  );
  if (oldAgentId) {
    await User.findByIdAndUpdate(
      oldAgentId,
      { $inc: { activeOrders: -1 }, $set: { currentOrder: null } },
      { runValidators: false }
    );
  }
  console.log('[safety] order accept timeout — reassign', { orderId: String(oid) });
  await autoAssignAgent(oid);
  return Order.findById(oid)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();
}

async function assignOrderToAgent(req) {
  const { id } = req.params;
  const { agentId } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  if (!agentId || !mongoose.Types.ObjectId.isValid(String(agentId))) {
    return bad(400, { message: 'Bad request', details: 'Valid agentId is required' });
  }

  const agent = await User.findOne({ _id: agentId, role: 'agent', isApproved: true }).lean();
  if (!agent) {
    return bad(400, { message: 'Bad request', details: 'Agent is not approved or not found' });
  }
  if (agent.isRestricted) {
    return bad(400, { message: 'Bad request', details: 'Agent is restricted by admin/rating policy' });
  }
  if (!ph.agentPassesLoadAndPresence(agent)) {
    return bad(400, {
      message: 'Bad request',
      details: 'Agent must be online and under active order limit (max 3)',
    });
  }
  const orderCheck = await Order.findById(id).populate('service', 'category').lean();
  if (!orderCheck) return bad(404, { message: 'Not found' });
  if (!orderAllowsFulfillmentWork(orderCheck)) {
    return { ok: false, paymentRequired: true };
  }
  if (
    agent.agentLevel === 'Beginner' &&
    orderCheck.service &&
    typeof orderCheck.service === 'object' &&
    orderCheck.service.category &&
    String(orderCheck.service.category) !== 'Personal'
  ) {
    return bad(400, {
      message: 'Bad request',
      details: 'Beginner agents can only be assigned Personal category services',
    });
  }

  const prev = await Order.findById(id).select('agent').lean();
  const oldAgentId = prev?.agent ? String(prev.agent) : null;
  const newId = String(agentId);

  const updated = await Order.findByIdAndUpdate(
    id,
    {
      $set: {
        agent: agentId,
        assignedTo: String(agentId),
        status: 'assigned',
        agentResponseStatus: 'pending',
        agentAssignedAt: new Date(),
      },
    },
    { new: true, runValidators: false }
  );
  if (!updated) {
    return bad(404, { message: 'Not found' });
  }

  if (oldAgentId && oldAgentId !== newId) {
    await User.findByIdAndUpdate(oldAgentId, { $inc: { activeOrders: -1 } }, { runValidators: false });
  }
  if (!oldAgentId || oldAgentId !== newId) {
    await User.findByIdAndUpdate(
      newId,
      { $inc: { activeOrders: 1 }, $set: { currentOrder: id } },
      { runValidators: false }
    );
  }

  const populated = await Order.findById(updated._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();

  await notifyOrderAgentAssignment(populated);

  const formatted = formatOrder(populated, { includeUser: true });
  return good(200, formatted, { socketOrderUpdate: formatted });
}

async function updateAgentOrderStatus(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { status, completionNote } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  if (!['processing', 'completed'].includes(status)) {
    return bad(400, { message: 'Bad request', details: 'status must be processing or completed' });
  }

  const order = await Order.findById(id).lean();
  if (!order) {
    return bad(404, { message: 'Not found' });
  }
  if (order.status === 'completed') {
    return bad(400, { message: 'Bad request', details: 'Order already completed' });
  }
  if (!order.agent || String(order.agent) !== String(userId)) {
    return bad(403, { message: 'Forbidden', details: 'Not assigned to this agent' });
  }

  if (effectiveAgentResponseStatus(order) === 'pending') {
    return bad(400, {
      message: 'Bad request',
      details: 'Accept or decline this assignment before updating status',
    });
  }

  if (!orderAllowsFulfillmentWork(order)) {
    return { ok: false, paymentRequired: true };
  }

  const files = Array.isArray(req.files) ? req.files : [];
  const updates = { status };
  if (status === 'completed') {
    if (!files.length) {
      return bad(400, { message: 'Bad request', details: 'Proof files are required to mark completed' });
    }
    const fileSvc = require('../../files/file.service');
    const ownerUserId = order.user;
    updates.proofFiles = await fileSvc.registerAgentProofFiles(id, userId, ownerUserId, files);
    updates.completionNote = typeof completionNote === 'string' ? completionNote.trim() : '';
    updates.completionSubmittedAt = new Date();
    updates.completedAt = new Date();
    updates.userConfirmationStatus = 'pending';
    updates.issueRaised = false;
    updates.adminReviewRequired = false;
  }

  const updated = await Order.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: false });

  const populated = await Order.findById(updated._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();

  if (status === 'completed' && populated.agent && typeof populated.agent === 'object' && populated.agent._id) {
    await User.findByIdAndUpdate(
      populated.agent._id,
      {
        $inc: { completedOrders: 1, activeOrders: -1 },
        $set: { currentOrder: null },
      },
      { runValidators: false }
    );
    await recomputeAgentMeta(populated.agent._id);
  }
  if (populated.user && typeof populated.user === 'object' && populated.user._id) {
    const oid = String(populated._id);
    const done = status === 'completed';
    await createNotification({
      userId: populated.user._id,
      role: 'user',
      title: done ? 'Order completed' : 'Order processing',
      event: done ? 'status_completed' : 'status_processing',
      data: { name: populated.user.name || 'Customer', orderId: oid },
      type: done ? 'order_completed' : 'order_in_progress',
      dedupeKey: done ? `order_completed_${oid}` : `order_in_progress_${oid}_processing`,
    });
  }
  if (status === 'completed') {
    await notifyRoleUsers('admin', {
      title: 'Proof uploaded',
      event: 'status_completed',
      data: { name: 'Admin', orderId: String(populated._id) },
      type: 'order_completed',
      dedupeKey: `admin_proof_${String(populated._id)}`,
    });
  }
  const formatted = formatOrder(populated, { includeUser: true });
  return good(200, formatted, { socketOrderUpdate: formatted });
}

async function runTriggerAutoAssign(req) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  const { maybeAutoRelease } = require('./orderUpdateService');
  const result = await autoAssignAgent(id);
  if (!result.ok && result.reason === 'payment_required') {
    return { ok: false, paymentRequired: true };
  }
  const populatedRaw = await Order.findById(id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();
  const populated = await maybeAutoRelease(populatedRaw);
  return good(200, {
    ...formatOrder(populated, { includeUser: true }),
    autoAssign: result,
  });
}

module.exports = {
  autoAssignAgent,
  maybeReassignIfAcceptTimeout,
  assignOrderToAgent,
  updateAgentOrderStatus,
  runTriggerAutoAssign,
};
