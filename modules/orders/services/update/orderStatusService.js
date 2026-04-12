/**
 * Admin-driven order status transitions (not completion upload flow).
 */
const mongoose = require('mongoose');
const Order = require('../../../../models/Order');
const User = require('../../../../models/User');
const { createNotification } = require('../../../../services/notificationService');
const {
  orderAllowsFulfillmentWork,
  paymentStatusCaptured,
} = require('../../../../utils/orderPaymentGate');
const { recordActivity } = require('../../../../controllers/activityController');
const { bad, good, formatOrder } = require('../orderQueryService');
const { ALLOWED_STATUSES, STATUS_ALIASES } = require('../../parts/orderConstants');

async function recomputeAgentMeta(agentId) {
  const ac = require('../../../../controllers/agentController');
  return ac.recomputeAgentMeta(agentId);
}

async function updateOrderStatus(req) {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  if (!status || typeof status !== 'string') {
    return bad(400, { message: 'Bad request', details: 'status is required' });
  }

  const normalizedStatus = STATUS_ALIASES[status] || status;
  if (!ALLOWED_STATUSES.includes(normalizedStatus)) {
    return bad(400, {
      message: 'Bad request',
      details: `status must be one of: ${ALLOWED_STATUSES.join(', ')} (or in-progress → processing, rejected → cancelled)`,
    });
  }

  if (normalizedStatus === 'completed') {
    return bad(400, {
      message: 'Bad request',
      details:
        'To mark completed, upload final document(s) via POST /api/orders/complete/:id (multipart files + optional note).',
      errorCode: 'COMPLETED_REQUIRES_RESULT_UPLOAD',
    });
  }

  if (normalizedStatus === 'paid') {
    return bad(403, {
      message: 'Forbidden',
      details: 'Paid status is set only after successful payment capture.',
      errorCode: 'PAID_STATUS_READ_ONLY',
    });
  }

  if (normalizedStatus === 'pending_payment') {
    return bad(403, {
      message: 'Forbidden',
      details: 'pending_payment is set when the order is placed; it cannot be set from the admin panel.',
      errorCode: 'PENDING_PAYMENT_READ_ONLY',
    });
  }

  const before = await Order.findById(id).lean();
  if (!before) {
    return bad(404, { message: 'Not found' });
  }

  if (normalizedStatus === 'pending' && paymentStatusCaptured(before.paymentStatus)) {
    return bad(400, {
      message: 'Bad request',
      details:
        'This order is already paid. Use paid / assigned / processing, or cancel — not legacy pending.',
    });
  }

  if (['assigned', 'processing'].includes(normalizedStatus) && !orderAllowsFulfillmentWork(before)) {
    return { ok: false, paymentRequired: true };
  }

  const updated = await Order.findByIdAndUpdate(
    id,
    { $set: { status: normalizedStatus } },
    { new: true, runValidators: false }
  );

  if (!updated) {
    return bad(404, { message: 'Not found' });
  }

  const populated = await Order.findById(updated._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .lean();
  if (normalizedStatus === 'cancelled' && before && before.agent) {
    const aid = before.agent;
    const prevStatus = before.status;
    const inc = { cancelledOrders: 1 };
    if (['pending_payment', 'pending', 'paid', 'assigned', 'processing'].includes(prevStatus)) {
      inc.activeOrders = -1;
    }
    await User.findByIdAndUpdate(aid, { $inc: inc }, { runValidators: false });
    await recomputeAgentMeta(aid);
  }
  const ownerObj = populated.user && typeof populated.user === 'object' ? populated.user : null;
  if (ownerObj && ownerObj._id) {
    const oid = String(populated._id);
    const isCompleted = normalizedStatus === 'completed';
    await createNotification({
      userId: ownerObj._id,
      role: 'user',
      title: 'Order status updated',
      message: `Your order ${oid} is now ${normalizedStatus}.`,
      type: isCompleted ? 'order_completed' : 'order_in_progress',
      event: 'order_status_changed',
      data: { orderId: oid, status: normalizedStatus },
      dedupeKey: isCompleted ? `order_completed_${oid}` : `order_status_${oid}_${normalizedStatus}`,
    });
  }

  try {
    await recordActivity({
      actorId: req.user && req.user.userId,
      action: `order_status→${normalizedStatus}`,
      meta: { orderId: id, previous: before && before.status },
    });
  } catch (_e) {
    /* non-fatal */
  }

  return good(200, formatOrder(populated, { includeUser: true }));
}

module.exports = {
  updateOrderStatus,
};
