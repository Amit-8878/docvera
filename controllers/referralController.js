const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const ReferralCommission = require('../models/referral.model');
const {
  getBooleanSetting,
  getNumberSetting,
  getStringSetting,
  setSetting,
} = require('../services/systemSettingsService');
const { getSnapshot } = require('../services/adminEarningsService');

async function getReferralSummary(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const me = await User.findById(userId).lean();
    if (!me) return res.status(404).json({ message: 'Not found' });

    let code = me.referralCode;
    if (!code) {
      const { assignReferralCodeFromName } = require('../utils/referralCode');
      code = await assignReferralCodeFromName(me.name || 'USER');
      await User.findByIdAndUpdate(userId, { $set: { referralCode: code } }, { runValidators: false });
    }

    const [earningsAgg, invited, txs, commissionOrders] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(String(userId)),
            type: 'credit',
            reason: 'referral_bonus',
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      User.find({ referredBy: userId })
        .select('name email createdAt')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Transaction.find({ userId, reason: 'referral_bonus' })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      ReferralCommission.find({ referrerId: userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('orderId', 'finalCalculatedPrice totalPrice amount paymentStatus')
        .populate('referredUserId', 'name email')
        .lean(),
    ]);

    const referralEarnings = Number(earningsAgg?.[0]?.total || 0);
    const commissionPercent = await getNumberSetting('referral_commission_percent', 5);
    const minOrderInr = await getNumberSetting('referral_min_order_inr', 100);
    const commissionType = await getStringSetting('referral_commission_type', 'all_orders');

    return res.status(200).json({
      referralCode: code,
      walletBalance: Number(me.walletBalance || 0),
      totalEarnings: Number(me.totalEarnings || 0),
      commissionPercent,
      minOrderInr,
      commissionType: commissionType === 'first_order' ? 'first_order' : 'all_orders',
      referralEarnings,
      invited: invited.map((u) => ({
        id: String(u._id),
        name: u.name || '',
        email: u.email || '',
        joinedAt: u.createdAt,
      })),
      recentBonuses: txs.map((t) => ({
        id: String(t._id),
        amount: Number(t.amount || 0),
        reference: t.reference || '',
        createdAt: t.createdAt,
      })),
      commissionOrders: commissionOrders.map((row) => ({
        id: String(row._id),
        orderId: row.orderId ? String(row.orderId._id || row.orderId) : '',
        commissionAmount: Number(row.commissionAmount || 0),
        status: row.status,
        createdAt: row.createdAt,
        referredUser: row.referredUserId
          ? {
              id: String(row.referredUserId._id || row.referredUserId),
              name: row.referredUserId.name || '',
              email: row.referredUserId.email || '',
            }
          : null,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function getReferralConfig(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const commissionPercent = await getNumberSetting('referral_commission_percent', 5);
    const minOrderInr = await getNumberSetting('referral_min_order_inr', 100);
    const referralEnabled = await getBooleanSetting('referral_enabled', true);
    const commissionType = await getStringSetting('referral_commission_type', 'all_orders');
    return res.status(200).json({
      commissionPercent,
      minOrderInr,
      referralEnabled,
      commissionType: commissionType === 'first_order' ? 'first_order' : 'all_orders',
    });
  } catch (err) {
    return next(err);
  }
}

async function putReferralConfig(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { commissionPercent, minOrderInr, referralEnabled, commissionType } = req.body || {};
    if (commissionPercent !== undefined) {
      const n = Number(commissionPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ message: 'Bad request', details: 'commissionPercent must be 0–100' });
      }
      await setSetting('referral_commission_percent', n);
    }
    if (minOrderInr !== undefined) {
      const n = Number(minOrderInr);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Bad request', details: 'minOrderInr invalid' });
      }
      await setSetting('referral_min_order_inr', n);
    }
    if (referralEnabled !== undefined) {
      if (typeof referralEnabled !== 'boolean') {
        return res.status(400).json({ message: 'Bad request', details: 'referralEnabled must be boolean' });
      }
      await setSetting('referral_enabled', referralEnabled);
    }
    if (commissionType !== undefined) {
      const ct = String(commissionType);
      if (ct !== 'first_order' && ct !== 'all_orders') {
        return res.status(400).json({ message: 'Bad request', details: 'commissionType must be first_order or all_orders' });
      }
      await setSetting('referral_commission_type', ct);
    }
    const out = {
      commissionPercent: await getNumberSetting('referral_commission_percent', 5),
      minOrderInr: await getNumberSetting('referral_min_order_inr', 100),
      referralEnabled: await getBooleanSetting('referral_enabled', true),
      commissionType: (await getStringSetting('referral_commission_type', 'all_orders')) === 'first_order' ? 'first_order' : 'all_orders',
    };
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    return next(err);
  }
}

async function getAdminEarningsDashboard(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const snap = await getSnapshot();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const [todayAgg, monthAgg, ledgerTransactionCount] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            reason: 'referral_bonus',
            type: 'credit',
            status: 'completed',
            createdAt: { $gte: startOfDay },
          },
        },
        { $group: { _id: null, t: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            reason: 'referral_bonus',
            type: 'credit',
            status: 'completed',
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, t: { $sum: '$amount' } } },
      ]),
      Transaction.countDocuments({ status: 'completed' }),
    ]);

    return res.status(200).json({
      ...snap,
      ledgerTransactionCount,
      todayReferralCommissionPaid: Number(todayAgg[0]?.t || 0),
      monthReferralCommissionPaid: Number(monthAgg[0]?.t || 0),
    });
  } catch (err) {
    return next(err);
  }
}

async function getReferralLogs(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await ReferralCommission.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('referrerId', 'name email referralCode')
      .populate('referredUserId', 'name email')
      .populate('orderId', 'finalCalculatedPrice totalPrice amount paymentStatus')
      .lean();
    return res.status(200).json({
      logs: rows.map((r) => ({
        id: String(r._id),
        referrer: r.referrerId
          ? {
              id: String(r.referrerId._id || r.referrerId),
              name: r.referrerId.name,
              email: r.referrerId.email,
              referralCode: r.referrerId.referralCode,
            }
          : null,
        referredUser: r.referredUserId
          ? {
              id: String(r.referredUserId._id || r.referredUserId),
              name: r.referredUserId.name,
              email: r.referredUserId.email,
            }
          : null,
        orderId: r.orderId ? String(r.orderId._id || r.orderId) : '',
        commissionAmount: Number(r.commissionAmount || 0),
        status: r.status,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getReferralSummary,
  getReferralConfig,
  putReferralConfig,
  getAdminEarningsDashboard,
  getReferralLogs,
};
