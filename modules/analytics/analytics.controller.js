const User = require('../../models/User');
const Order = require('../../models/Order');
const Payment = require('../../models/Payment');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

const SUCCESS_PAYMENT = { status: { $in: ['success', 'paid'] } };

async function getDashboardStats(req, res, next) {
  try {
    const [totalUsers, totalAgents, totalOrders] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'agent' }),
      Order.countDocuments(),
    ]);

    const totalRevAgg = await Payment.aggregate([
      { $match: SUCCESS_PAYMENT },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalRevenue = Number((totalRevAgg[0]?.total || 0).toFixed(2));

    const t0 = startOfToday();
    const t1 = endOfToday();

    const [todayOrders, todayRevAgg, pendingOrders, completedOrders, assignedCount, processingCount, cancelledCount] =
      await Promise.all([
        Order.countDocuments({ createdAt: { $gte: t0, $lte: t1 } }),
        Payment.aggregate([
          { $match: { ...SUCCESS_PAYMENT, createdAt: { $gte: t0, $lte: t1 } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Order.countDocuments({ status: { $in: ['pending', 'pending_payment'] } }),
        Order.countDocuments({ status: 'completed' }),
        Order.countDocuments({ status: 'assigned' }),
        Order.countDocuments({ status: 'processing' }),
        Order.countDocuments({ status: 'cancelled' }),
      ]);

    const todayRevenue = Number((todayRevAgg[0]?.total || 0).toFixed(2));

    const topAgentsRaw = await User.find({ role: 'agent' })
      .sort({ completedOrders: -1 })
      .limit(8)
      .select('shopName phone completedOrders avgRating city')
      .lean();

    const topAgents = topAgentsRaw.map((a) => ({
      id: String(a._id),
      shopName: a.shopName || '',
      phone: a.phone || '',
      completedOrders: Number(a.completedOrders || 0),
      avgRating: Number(a.avgRating || 0),
      city: a.city || '',
    }));

    return res.status(200).json({
      totalUsers,
      totalAgents,
      totalOrders,
      totalRevenue,
      todayOrders,
      todayRevenue,
      pendingOrders,
      completedOrders,
      orderStatusBreakdown: {
        pending: pendingOrders,
        completed: completedOrders,
        assigned: assignedCount,
        processing: processingCount,
        cancelled: cancelledCount,
      },
      topAgents,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getDashboardStats,
};
