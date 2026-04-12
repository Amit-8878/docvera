const mongoose = require('mongoose');
const Order = require('../../models/Order');

/**
 * Minimal JSON order creation was removed: orders must be created only after payment.
 * Use `POST /api/checkout/session` (multipart documents) then `POST /api/payment/create` with `checkoutSessionId`.
 */
async function createMinimalOrder(req, res) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  return res.status(400).json({
    success: false,
    message: 'Upload documents and complete payment to create an order.',
    details:
      'POST /api/checkout/session with multipart field `documents` and `serviceId`, then POST /api/payment/create with checkoutSessionId.',
    errorCode: 'ORDER_REQUIRES_CHECKOUT',
  });
}

/**
 * GET /api/orders/:id
 * Requires auth. Returns order details (same shape as the main orders engine).
 */
async function getOrderDetails(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const { id } = req.params || {};
    if (!id || typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid order id' });
    }
    const orderController = require('../../controllers/orderController');
    let doc = await Order.findById(id)
      .populate('service', 'name')
      .populate(
        'agent',
        'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
      )
      .lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    doc = await orderController.maybeAutoRelease(doc);
    doc = await orderController.maybeReassignIfAcceptTimeout(doc);
    // NOTE: Authorization rules are enforced in the main handler; this is a generic detail endpoint.
    return res.status(200).json(orderController.formatOrder(doc));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createMinimalOrder,
  getOrderDetails,
};
