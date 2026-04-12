const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ReferralCommission = require('../models/referral.model');

/** Successful payment = captured revenue (single source; ignore pending/failed). */
const PAID_STATUSES = ['held', 'paid', 'released'];

function orderLineTotal() {
  return {
    $ifNull: ['$finalCalculatedPrice', { $ifNull: ['$totalPrice', '$amount'] }],
  };
}

/** Date used for reporting when paidAt missing (legacy rows). */
function effectivePaidDate() {
  return { $ifNull: ['$paidAt', '$updatedAt'] };
}

/**
 * @returns {Promise<{
 *   totalRevenue: number,
 *   totalOrders: number,
 *   totalCommissionPaid: number,
 *   totalWalletBalance: number,
 *   todayRevenue: number,
 *   monthlyRevenue: number,
 * }>}
 */
async function getFinanceOverview() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonthExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const baseMatch = { paymentStatus: { $in: PAID_STATUSES } };

  const [
    totalsAgg,
    walletAgg,
    commissionAgg,
    todayAgg,
    monthAgg,
  ] = await Promise.all([
    Order.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: orderLineTotal() },
          totalOrders: { $sum: 1 },
        },
      },
    ]),
    User.aggregate([{ $group: { _id: null, totalWalletBalance: { $sum: '$walletBalance' } } }]),
    ReferralCommission.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, totalCommissionPaid: { $sum: '$commissionAmount' } } },
    ]),
    Order.aggregate([
      {
        $match: baseMatch,
      },
      {
        $addFields: {
          _paid: effectivePaidDate(),
        },
      },
      {
        $match: {
          _paid: { $gte: startOfToday, $lt: endOfToday },
        },
      },
      {
        $group: {
          _id: null,
          todayRevenue: { $sum: orderLineTotal() },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: baseMatch,
      },
      {
        $addFields: {
          _paid: effectivePaidDate(),
        },
      },
      {
        $match: {
          _paid: { $gte: startOfMonth, $lt: endOfMonthExclusive },
        },
      },
      {
        $group: {
          _id: null,
          monthlyRevenue: { $sum: orderLineTotal() },
        },
      },
    ]),
  ]);

  const t = totalsAgg[0] || {};
  const w = walletAgg[0] || {};
  const c = commissionAgg[0] || {};
  const td = todayAgg[0] || {};
  const mo = monthAgg[0] || {};

  return {
    totalRevenue: Number(Number(t.totalRevenue || 0).toFixed(2)),
    totalOrders: Number(t.totalOrders || 0),
    totalCommissionPaid: Number(Number(c.totalCommissionPaid || 0).toFixed(2)),
    totalWalletBalance: Number(Number(w.totalWalletBalance || 0).toFixed(2)),
    todayRevenue: Number(Number(td.todayRevenue || 0).toFixed(2)),
    monthlyRevenue: Number(Number(mo.monthlyRevenue || 0).toFixed(2)),
  };
}

/**
 * Daily revenue for charts (successful orders only).
 * @param {{ from?: Date, to?: Date }} [range] — defaults last 30 days
 */
async function getDailyRevenueChart(range = {}) {
  const to = range.to instanceof Date ? range.to : new Date();
  const from =
    range.from instanceof Date
      ? range.from
      : new Date(to.getFullYear(), to.getMonth(), to.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);

  const rows = await Order.aggregate([
    {
      $match: {
        paymentStatus: { $in: PAID_STATUSES },
      },
    },
    {
      $addFields: {
        _paid: effectivePaidDate(),
        _line: orderLineTotal(),
      },
    },
    {
      $match: {
        _paid: { $gte: from, $lte: toEnd },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$_paid' },
        },
        revenue: { $sum: '$_line' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({
    date: r._id,
    revenue: Number(Number(r.revenue || 0).toFixed(2)),
  }));
}

/**
 * @param {{
 *   from?: string|Date,
 *   to?: string|Date,
 *   userId?: string,
 *   type?: 'all'|'order_payment'|'referral_commission'|'wallet_credit',
 *   limit?: number,
 *   skip?: number,
 * }} query
 */
async function getFinanceTransactions(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const skip = Math.max(Number(query.skip) || 0, 0);

  const filter = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { ...filter.createdAt, $gte: d };
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { ...filter.createdAt, $lte: d };
  }
  if (query.userId && mongoose.Types.ObjectId.isValid(String(query.userId))) {
    filter.userId = new mongoose.Types.ObjectId(String(query.userId));
  }

  const t = query.type || 'all';
  if (t === 'order_payment') {
    filter.type = 'debit';
    filter.reason = 'order_payment';
  } else if (t === 'referral_commission') {
    filter.type = 'credit';
    filter.reason = 'referral_bonus';
  } else if (t === 'wallet_credit') {
    filter.type = 'credit';
    filter.reason = { $nin: ['referral_bonus'] };
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email role')
      .populate('orderId', 'finalCalculatedPrice totalPrice amount paymentStatus')
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  return {
    total,
    items: items.map((tx) => ({
      id: String(tx._id),
      type: tx.type,
      amount: Number(tx.amount || 0),
      status: tx.status,
      reference: tx.reference || '',
      reason: tx.reason || '',
      source: tx.source || '',
      description: tx.description || '',
      category:
        tx.type === 'debit' && tx.reason === 'order_payment'
          ? 'order_payment'
          : tx.type === 'credit' && tx.reason === 'referral_bonus'
            ? 'referral_commission'
            : tx.type === 'credit'
              ? 'wallet_credit'
              : 'other',
      user: tx.userId
        ? {
            id: String(tx.userId._id || tx.userId),
            name: tx.userId.name,
            email: tx.userId.email,
            role: tx.userId.role,
          }
        : null,
      orderId: tx.orderId ? String(tx.orderId._id || tx.orderId) : null,
      createdAt: tx.createdAt,
    })),
  };
}

module.exports = {
  getFinanceOverview,
  getDailyRevenueChart,
  getFinanceTransactions,
  PAID_STATUSES,
};
