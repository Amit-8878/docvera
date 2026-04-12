const mongoose = require('mongoose');
const Dispute = require('./dispute.model');
const Order = require('../../models/Order');
const User = require('../../models/User');
const Service = require('../../models/Service');
const { createNotification, notifyRoleUsers } = require('../../services/notificationService');
const { creditAgentForOrderRelease } = require('../../services/walletService');

const OPEN_LIKE = ['open', 'in_review'];

async function assertNoOpenDispute(orderId) {
  const existing = await Dispute.findOne({
    orderId,
    status: { $in: OPEN_LIKE },
  }).lean();
  if (existing) {
    const err = new Error('A dispute is already open for this order');
    err.code = 'DISPUTE_EXISTS';
    throw err;
  }
}

/**
 * Creates a dispute and flags the order (payment stays held).
 * @param {{ userId: string, orderId: string, reason: string, message: string, proofFiles: Array<{ fileUrl: string, fileName: string }> }} input
 */
async function createDisputeForOrder({ userId, orderId, reason, message, proofFiles }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    const err = new Error('Invalid order id');
    err.code = 'INVALID_ID';
    throw err;
  }

  const order = await Order.findById(orderId).populate('service', 'category').lean();
  if (!order) {
    const err = new Error('Order not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const ownerId = order.user ? String(order.user) : '';
  if (ownerId !== String(userId)) {
    const err = new Error('Forbidden');
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (order.status !== 'completed') {
    const err = new Error('Issue can be raised after completion only');
    err.code = 'INVALID_STATE';
    throw err;
  }
  if (order.paymentStatus !== 'held' && order.paymentStatus !== 'paid') {
    const err = new Error('Payment is not captured');
    err.code = 'INVALID_STATE';
    throw err;
  }

  await assertNoOpenDispute(order._id);

  const agentId = order.agent || null;

  const dispute = await Dispute.create({
    orderId: order._id,
    userId,
    agentId,
    reason: reason || 'Order issue',
    message: message || '',
    proofFiles: Array.isArray(proofFiles) ? proofFiles : [],
    status: 'open',
  });

  await Order.findByIdAndUpdate(
    orderId,
    {
      $set: {
        paymentStatus: 'held',
        userConfirmationStatus: 'issue_raised',
        issueRaised: true,
        adminReviewRequired: true,
      },
    },
    { runValidators: false }
  );

  await notifyRoleUsers('admin', {
    title: 'Dispute opened',
    event: 'dispute_opened',
    data: { name: 'Customer', orderId: String(order._id), disputeId: String(dispute._id) },
    type: 'system',
  });
  await createNotification({
    userId,
    role: 'user',
    title: 'Issue submitted',
    event: 'dispute_created',
    data: { name: 'Customer', orderId: String(order._id) },
    type: 'system',
  });

  return dispute;
}

async function releasePaymentOrderSideEffects(orderId) {
  const updated = await Order.findByIdAndUpdate(
    orderId,
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

  if (!updated) return null;

  await creditAgentForOrderRelease(updated._id);

  if (updated.user && typeof updated.user === 'object' && updated.user._id) {
    await createNotification({
      userId: updated.user._id,
      role: 'user',
      title: 'Payment released',
      event: 'payment_released',
      data: { name: updated.user.name || 'Customer', orderId: String(updated._id) },
      type: 'payment',
    });
  }
  if (updated.agent && typeof updated.agent === 'object' && updated.agent._id) {
    await createNotification({
      userId: updated.agent._id,
      role: 'agent',
      title: 'Payment released',
      event: 'payment_released',
      data: { name: updated.agent.shopName || 'Agent', orderId: String(updated._id) },
      type: 'payment',
    });
  }

  return updated;
}

async function validateAgentForOrder(agentId, orderId) {
  const agent = await User.findOne({ _id: agentId, role: 'agent', isApproved: true }).lean();
  if (!agent) {
    const err = new Error('Agent is not approved or not found');
    err.code = 'BAD_AGENT';
    throw err;
  }
  if (agent.isRestricted) {
    const err = new Error('Agent is restricted');
    err.code = 'BAD_AGENT';
    throw err;
  }
  const orderCheck = await Order.findById(orderId).populate('service', 'category').lean();
  if (
    agent.agentLevel === 'Beginner' &&
    orderCheck.service &&
    typeof orderCheck.service === 'object' &&
    orderCheck.service.category &&
    String(orderCheck.service.category) !== 'Personal'
  ) {
    const err = new Error('Beginner agents can only be assigned Personal category services');
    err.code = 'BAD_AGENT';
    throw err;
  }
}

/**
 * Applies order-level effects when a dispute is resolved/rejected (admin).
 * @returns {Promise<string>} resolutionAction stored on the dispute row
 */
async function applyDisputeResolutionToOrder(orderId, disputeUserId, { status, resolutionAction, newAgentId }) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
    const err = new Error('Invalid order');
    err.code = 'BAD_INPUT';
    throw err;
  }

  if (status === 'rejected') {
    await releasePaymentOrderSideEffects(orderId);
    return 'release_payment';
  }

  if (status === 'resolved' && resolutionAction === 'release_payment') {
    await releasePaymentOrderSideEffects(orderId);
    return 'release_payment';
  }

  if (status === 'resolved' && resolutionAction === 'refund') {
    await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          paymentStatus: 'refunded',
          userConfirmationStatus: 'confirmed',
          issueRaised: false,
          adminReviewRequired: false,
        },
      },
      { runValidators: false }
    );
    await createNotification({
      userId: disputeUserId,
      role: 'user',
      title: 'Refund recorded',
      message: 'Your dispute was resolved with a refund outcome. If applicable, funds follow your payment method.',
      type: 'payment',
    });
    return 'refund';
  }

  if (status === 'resolved' && resolutionAction === 'reassign_agent') {
    if (!newAgentId || !mongoose.Types.ObjectId.isValid(String(newAgentId))) {
      const err = new Error('newAgentId is required for reassign_agent');
      err.code = 'BAD_INPUT';
      throw err;
    }
    await validateAgentForOrder(newAgentId, orderId);

    const prev = await Order.findById(orderId).select('agent').lean();
    const oldAgentId = prev?.agent ? String(prev.agent) : null;
    const newId = String(newAgentId);

    await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          agent: newAgentId,
          status: 'assigned',
          issueRaised: false,
          adminReviewRequired: false,
          userConfirmationStatus: 'pending',
        },
      },
      { runValidators: false }
    );

    if (oldAgentId && oldAgentId !== newId) {
      await User.findByIdAndUpdate(oldAgentId, { $inc: { activeOrders: -1 } }, { runValidators: false });
    }
    if (!oldAgentId || oldAgentId !== newId) {
      await User.findByIdAndUpdate(newId, { $inc: { activeOrders: 1 } }, { runValidators: false });
    }

    await createNotification({
      userId: newAgentId,
      role: 'agent',
      title: 'New assignment',
      message: `You have been assigned order ${String(orderId)} (reassigned after dispute).`,
      type: 'order',
    });
    await createNotification({
      userId: disputeUserId,
      role: 'user',
      title: 'Agent reassigned',
      message: `A new agent was assigned to your order ${String(orderId)}.`,
      type: 'order',
    });
    return 'reassign_agent';
  }

  return '';
}

module.exports = {
  createDisputeForOrder,
  assertNoOpenDispute,
  applyDisputeResolutionToOrder,
  OPEN_LIKE,
};
