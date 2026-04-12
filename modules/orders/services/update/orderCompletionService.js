/**
 * Completion upload, user confirm release, auto-release window, post-release rating.
 */
const mongoose = require('mongoose');
const Order = require('../../../../models/Order');
const User = require('../../../../models/User');
const { createNotification } = require('../../../../services/notificationService');
const { creditAgentForOrderRelease } = require('../../../../services/walletService');
const { orderAllowsFulfillmentWork } = require('../../../../utils/orderPaymentGate');
const { bad, good, formatOrder } = require('../orderQueryService');
const { AUTO_RELEASE_AFTER_MS } = require('../../parts/orderConstants');

async function recomputeAgentMeta(agentId) {
  const ac = require('../../../../controllers/agentController');
  return ac.recomputeAgentMeta(agentId);
}

async function maybeAutoRelease(orderDoc) {
  const order = typeof orderDoc?.toObject === 'function' ? orderDoc.toObject() : orderDoc;
  if (!order || !order._id) return orderDoc;
  const ps = String(order.paymentStatus || '');
  if (ps !== 'held' && ps !== 'paid') return orderDoc;
  if (order.userConfirmationStatus !== 'pending') return orderDoc;
  if (order.status !== 'completed') return orderDoc;
  if (!order.completionSubmittedAt) return orderDoc;

  const elapsed = Date.now() - new Date(order.completionSubmittedAt).getTime();
  if (elapsed < AUTO_RELEASE_AFTER_MS) return orderDoc;

  await Order.findByIdAndUpdate(
    order._id,
    {
      $set: {
        paymentStatus: 'released',
        userConfirmationStatus: 'confirmed',
        issueRaised: false,
        adminReviewRequired: false,
      },
    },
    { runValidators: false }
  );
  await creditAgentForOrderRelease(order._id);
  return {
    ...order,
    paymentStatus: 'released',
    userConfirmationStatus: 'confirmed',
    issueRaised: false,
    adminReviewRequired: false,
  };
}

async function uploadResultAndCompleteOrder(req) {
  const userId = req.user && req.user.userId;
  const role = req.user && req.user.role;
  if (!userId) return bad(401, { message: 'Unauthorized' });
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    return bad(400, { message: 'Bad request', details: 'At least one result file is required' });
  }

  const noteRaw = req.body && req.body.note != null ? String(req.body.note) : '';
  const note = noteRaw.trim().slice(0, 5000);

  const order = await Order.findById(id).lean();
  if (!order) return bad(404, { message: 'Not found' });
  if (order.status === 'cancelled') {
    return bad(400, { message: 'Bad request', details: 'Order is cancelled' });
  }
  if (order.status === 'completed') {
    return bad(409, { message: 'Conflict', details: 'Order already completed' });
  }

  if (!orderAllowsFulfillmentWork(order)) {
    return { ok: false, paymentRequired: true };
  }

  if (role === 'agent') {
    if (!order.agent || String(order.agent) !== String(userId)) {
      return bad(403, { message: 'Forbidden', details: 'Not assigned to this order' });
    }
  } else if (role !== 'admin') {
    return bad(403, { message: 'Forbidden' });
  }

  const fileSvc = require('../../../files/file.service');
  const ownerUserId = order.user;
  const uploadedByRole = role === 'admin' ? 'admin' : 'agent';
  const newResultFiles = await fileSvc.registerOrderResultFiles(id, ownerUserId, files, uploadedByRole);
  const existingResults = Array.isArray(order.resultFiles) ? order.resultFiles : [];
  const resultFiles = [...existingResults, ...newResultFiles];
  const primary = resultFiles[0];
  const deliveryFile =
    primary && primary.fileId ? `/api/files/${String(primary.fileId)}/download` : '';

  const prevStatus = order.status;
  const hadAgent = order.agent;

  await Order.findByIdAndUpdate(
    id,
    {
      $set: {
        resultFiles,
        deliveryFile,
        completionNote: note,
        completedAt: new Date(),
        completionSubmittedAt: new Date(),
        status: 'completed',
        userConfirmationStatus: 'pending',
      },
    },
    { new: true, runValidators: false }
  );

  if (hadAgent && prevStatus !== 'completed') {
    await User.findByIdAndUpdate(hadAgent, { $inc: { completedOrders: 1, activeOrders: -1 } }, { runValidators: false });
    await recomputeAgentMeta(hadAgent);
  }

  const populated = await Order.findById(id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();

  const populatedResolved = await maybeAutoRelease(populated);

  if (populatedResolved.user && typeof populatedResolved.user === 'object' && populatedResolved.user._id) {
    const oid = String(id);
    await createNotification({
      userId: populatedResolved.user._id,
      role: 'user',
      title: 'Order complete',
      message: 'Your order is completed. Download now.',
      type: 'order_completed',
      event: 'order_result_ready',
      data: { name: populatedResolved.user.name || 'Customer', orderId: oid },
      dedupeKey: `order_completed_${oid}`,
    });
  }

  const formatted = formatOrder(populatedResolved, { includeUser: true });
  return good(200, formatted, { socketOrderUpdate: formatted });
}

async function confirmOrderCompletion(req) {
  const userId = req.user && req.user.userId;
  const { id } = req.params;
  if (!userId) return bad(401, { message: 'Unauthorized' });
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const order = await Order.findById(id).populate('user', '_id').lean();
  if (!order) return bad(404, { message: 'Not found' });
  const ownerId = order.user && typeof order.user === 'object' ? String(order.user._id) : String(order.user);
  if (ownerId !== String(userId)) return bad(403, { message: 'Forbidden' });
  if (order.status !== 'completed') {
    return bad(400, { message: 'Bad request', details: 'Order is not completed yet' });
  }
  if (order.paymentStatus !== 'held' && order.paymentStatus !== 'paid') {
    return bad(400, { message: 'Bad request', details: 'Payment is not captured yet' });
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
  if (updated.user && typeof updated.user === 'object' && updated.user._id) {
    const oid = String(updated._id);
    await createNotification({
      userId: updated.user._id,
      role: 'user',
      title: 'Payment released',
      event: 'payment_released',
      data: { name: updated.user.name || 'Customer', orderId: oid },
      type: 'payment',
      dedupeKey: `payment_released_${oid}_user`,
    });
  }
  if (updated.agent && typeof updated.agent === 'object' && updated.agent._id) {
    await creditAgentForOrderRelease(updated._id);
    await createNotification({
      userId: updated.agent._id,
      role: 'agent',
      title: 'Payment released',
      event: 'payment_released',
      data: { name: updated.agent.shopName || 'Agent', orderId: String(updated._id) },
      type: 'payment',
      dedupeKey: `payment_released_${String(updated._id)}_agent`,
    });
  }
  return good(200, formatOrder(updated, { includeUser: true }));
}

async function submitOrderRating(req) {
  const userId = req.user && req.user.userId;
  const { id } = req.params;
  const { rating, review } = req.body || {};
  if (!userId) return bad(401, { message: 'Unauthorized' });
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  const numericRating = Number(rating);
  if (Number.isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
    return bad(400, { message: 'Bad request', details: 'rating must be between 1 and 5' });
  }

  const order = await Order.findById(id).populate('user', '_id').lean();
  if (!order) return bad(404, { message: 'Not found' });
  const ownerId = order.user && typeof order.user === 'object' ? String(order.user._id) : String(order.user);
  if (ownerId !== String(userId)) return bad(403, { message: 'Forbidden' });
  if (order.paymentStatus !== 'released') {
    return bad(400, { message: 'Bad request', details: 'Rating is allowed after payment release only' });
  }
  if (!order.agent) {
    return bad(400, { message: 'Bad request', details: 'No assigned agent for this order' });
  }
  if (order.userRating && Number(order.userRating) > 0) {
    return bad(400, { message: 'Bad request', details: 'Rating already submitted' });
  }

  const updatedOrder = await Order.findByIdAndUpdate(
    id,
    {
      $set: {
        userRating: numericRating,
        userReview: typeof review === 'string' ? review.trim() : '',
        ratedAt: new Date(),
      },
    },
    { new: true, runValidators: false }
  );

  await User.findByIdAndUpdate(
    order.agent,
    {
      $push: {
        reviews: {
          orderId: String(id),
          userId: String(userId),
          rating: numericRating,
          review: typeof review === 'string' ? review.trim() : '',
          createdAt: new Date(),
        },
      },
    },
    { runValidators: false }
  );
  await recomputeAgentMeta(order.agent);

  const populated = await Order.findById(updatedOrder._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved avgRating totalReviews agentLevel isRestricted activeOrders')
    .lean();
  return good(200, formatOrder(populated, { includeUser: true }));
}

module.exports = {
  maybeAutoRelease,
  uploadResultAndCompleteOrder,
  confirmOrderCompletion,
  submitOrderRating,
};
