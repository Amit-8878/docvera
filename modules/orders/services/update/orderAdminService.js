/**
 * Admin-only order meta and payment/dispute resolution actions.
 */
const mongoose = require('mongoose');
const Order = require('../../../../models/Order');
const { createNotification } = require('../../../../services/notificationService');
const { creditAgentForOrderRelease } = require('../../../../services/walletService');
const { recordActivity } = require('../../../../controllers/activityController');
const { bad, good, formatOrder } = require('../orderQueryService');

async function updateOrderAdminMeta(req) {
  const { id } = req.params;
  const { adminRemarks, adminPriority } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const updates = {};
  if (typeof adminRemarks === 'string') {
    updates.adminRemarks = adminRemarks.slice(0, 2000);
  }
  if (adminPriority && ['normal', 'high', 'urgent'].includes(String(adminPriority))) {
    updates.adminPriority = String(adminPriority);
  }

  if (Object.keys(updates).length === 0) {
    return bad(400, { message: 'Bad request', details: 'No valid fields to update' });
  }

  const updated = await Order.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: false });
  if (!updated) {
    return bad(404, { message: 'Not found' });
  }

  const populated = await Order.findById(updated._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .lean();

  try {
    await recordActivity({
      actorId: req.user && req.user.userId,
      action: 'order_admin_meta',
      meta: { orderId: id, ...updates },
    });
  } catch (_e) {
    /* non-fatal */
  }

  return good(200, formatOrder(populated, { includeUser: true }));
}

async function adminForceRelease(req) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  const updated = await Order.findByIdAndUpdate(
    id,
    {
      $set: {
        paymentStatus: 'released',
        userConfirmationStatus: 'confirmed',
        issueRaised: false,
        adminReviewRequired: false,
      },
    },
    { new: true, runValidators: false }
  )
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .lean();
  if (!updated) return bad(404, { message: 'Not found' });
  await creditAgentForOrderRelease(updated._id);
  if (updated.user && typeof updated.user === 'object' && updated.user._id) {
    const oid = String(updated._id);
    await createNotification({
      userId: updated.user._id,
      role: 'user',
      title: 'Payment released by admin',
      event: 'payment_released',
      data: { name: updated.user.name || 'Customer', orderId: oid },
      type: 'payment',
      dedupeKey: `payment_released_admin_${oid}_user`,
    });
  }
  if (updated.agent && typeof updated.agent === 'object' && updated.agent._id) {
    await createNotification({
      userId: updated.agent._id,
      role: 'agent',
      title: 'Payment released by admin',
      event: 'payment_released',
      data: { name: updated.agent.shopName || 'Agent', orderId: String(updated._id) },
      type: 'payment',
      dedupeKey: `payment_released_admin_${String(updated._id)}_agent`,
    });
  }
  return good(200, formatOrder(updated, { includeUser: true }));
}

async function adminResolveDispute(req) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  const updated = await Order.findByIdAndUpdate(
    id,
    { $set: { issueRaised: false, adminReviewRequired: false, userConfirmationStatus: 'pending' } },
    { new: true, runValidators: false }
  )
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .lean();
  if (!updated) return bad(404, { message: 'Not found' });
  return good(200, formatOrder(updated, { includeUser: true }));
}

module.exports = {
  updateOrderAdminMeta,
  adminForceRelease,
  adminResolveDispute,
};
