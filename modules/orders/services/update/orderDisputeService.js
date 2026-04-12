/**
 * User-raised order issues / disputes (creates dispute record).
 */
const mongoose = require('mongoose');
const Order = require('../../../../models/Order');
const { bad, good, formatOrder } = require('../orderQueryService');

async function raiseOrderIssue(req) {
  const userId = req.user && req.user.userId;
  const { id } = req.params;
  if (!userId) return bad(401, { message: 'Unauthorized' });
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const { createDisputeForOrder } = require('../../../disputes/dispute.service');
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Order issue';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  try {
    await createDisputeForOrder({ userId, orderId: id, reason, message, proofFiles: [] });
  } catch (e) {
    if (e && e.code === 'DISPUTE_EXISTS') {
      return bad(409, { message: 'Conflict', details: e.message });
    }
    if (e && e.code === 'FORBIDDEN') return bad(403, { message: 'Forbidden' });
    if (e && e.code === 'INVALID_STATE') {
      return bad(400, { message: 'Bad request', details: e.message });
    }
    if (e && e.code === 'NOT_FOUND') return bad(404, { message: 'Not found' });
    throw e;
  }

  const updated = await Order.findById(id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();
  return good(200, formatOrder(updated, { includeUser: true }));
}

module.exports = {
  raiseOrderIssue,
};
