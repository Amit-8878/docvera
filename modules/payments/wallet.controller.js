const mongoose = require('mongoose');
const Order = require('../../models/Order');
const env = require('../../config/env');
const walletController = require('../../controllers/walletController');
const { creditAgentForOrderRelease } = require('../../services/walletService');
const { creditWallet, debitWallet } = require('../../utils/wallet');

const PLATFORM_FEE_PERCENT = env.platformFeePercent;

/** Reuses existing agent wallet summary (balance + tx + withdraw requests). */
async function getAgentWallet(req, res, next) {
  return walletController.getAgentWalletSummary(req, res, next);
}

/** Any logged-in user: balance + transactions (see controllers/walletController). */
async function getCustomerWallet(req, res, next) {
  return walletController.getCustomerWallet(req, res, next);
}

async function getWalletBalance(req, res, next) {
  return walletController.getWalletBalance(req, res, next);
}

async function getWalletHistory(req, res, next) {
  return walletController.getWalletHistory(req, res, next);
}

/**
 * Admin: idempotently run agent credit for a released/completed payment order (wraps walletService).
 */
async function addCommissionToAgent(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const { orderId } = req.body || {};
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ message: 'Bad request', details: 'orderId required' });
    }
    const result = await creditAgentForOrderRelease(orderId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/** Read-only: split for a rupee amount (same % as orders). */
function deductPlatformFee(req, res) {
  const amount = Number(req.query.amount ?? req.body?.amount ?? 0);
  if (Number.isNaN(amount) || amount < 0) {
    return res.status(400).json({ message: 'Bad request', details: 'amount invalid' });
  }
  const platformFee = Number((amount * PLATFORM_FEE_PERCENT).toFixed(2));
  const agentEarning = Number((amount - platformFee).toFixed(2));
  return res.status(200).json({
    amount,
    platformFeePercent: PLATFORM_FEE_PERCENT,
    platformFee,
    agentEarning,
  });
}

/** Admin: rough platform revenue from stored order fees. */
async function getAdminTotalRevenue(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const agg = await Order.aggregate([
      { $match: { platformFee: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          totalPlatformFees: { $sum: '$platformFee' },
          orderCount: { $sum: 1 },
        },
      },
    ]);
    const row = agg[0] || {};
    return res.status(200).json({
      totalPlatformFees: Number(row.totalPlatformFees || 0),
      orderCount: Number(row.orderCount || 0),
    });
  } catch (err) {
    return next(err);
  }
}

/** Admin: credit another user’s wallet (manual adjustment). */
async function adminCreditUser(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { userId, amount, description } = req.body || {};
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: 'Bad request', details: 'userId required' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 500000) {
      return res.status(400).json({ message: 'Bad request', details: 'amount must be between 0 and 500000' });
    }
    const ref = `admin_credit_${String(userId)}_${Date.now()}_${String(req.user.userId).slice(-8)}`;
    const out = await creditWallet(userId, amt, {
      reference: ref,
      reason: 'admin_adjustment',
      source: 'admin_adjustment',
      description: typeof description === 'string' ? description.slice(0, 500) : 'Admin credit',
    });
    if (out.skipped) return res.status(200).json({ success: true, skipped: true, reason: out.reason });
    return res.status(200).json({ success: true, credited: true, amount: amt });
  } catch (err) {
    return next(err);
  }
}

/** Admin: debit another user’s wallet. */
async function adminDebitUser(req, res, next) {
  try {
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { userId, amount, description } = req.body || {};
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: 'Bad request', details: 'userId required' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 500000) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid amount' });
    }
    const ref = `admin_debit_${String(userId)}_${Date.now()}_${String(req.user.userId).slice(-8)}`;
    try {
      const out = await debitWallet(userId, amt, {
        reference: ref,
        reason: 'admin_adjustment',
        source: 'admin_adjustment',
        description: typeof description === 'string' ? description.slice(0, 500) : 'Admin debit',
      });
      if (out.skipped) {
        return res.status(200).json({
          success: true,
          skipped: true,
          reason: out.reason,
          balance: out.balance,
        });
      }
      return res.status(200).json({ success: true, debited: true, amount: amt, balance: out.balance });
    } catch (e) {
      if (e && String(e.message || '').includes('Insufficient')) {
        return res.status(400).json({ message: 'Bad request', details: e.message });
      }
      throw e;
    }
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getAgentWallet,
  getCustomerWallet,
  getWalletBalance,
  getWalletHistory,
  addCommissionToAgent,
  adminCreditUser,
  adminDebitUser,
  deductPlatformFee,
  getAdminTotalRevenue,
};
