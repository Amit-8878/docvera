const Order = require('../models/Order');
const Payment = require('../models/payment.model');

/**
 * GET /api/admin/dashboard
 * Admin-only (enforced in routes).
 */
async function getDashboardStats(req, res, next) {
  try {
    const totalOrders = await Order.countDocuments();

    const pendingOrders = await Order.countDocuments({
      status: { $in: ['pending', 'pending_payment'] },
    });

    const completedOrders = await Order.countDocuments({ status: 'completed' });

    const revenueResult = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalRevenue = revenueResult[0] && revenueResult[0].total != null
      ? Number(revenueResult[0].total)
      : 0;

    return res.status(200).json({
      totalOrders,
      totalRevenue,
      pendingOrders,
      completedOrders,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/admin/payments — webhook-saved payments (newest first).
 */
async function getPayments(req, res, next) {
  try {
    if (!req.headers.authorization) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const payments = await Payment.find()
      .select('paymentId amount status method email createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json(payments);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getDashboardStats,
  getPayments,
};
