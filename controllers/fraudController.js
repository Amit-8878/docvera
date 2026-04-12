const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { debitWallet } = require('../utils/wallet');
const AuditLog = require('../models/AuditLog');
const { log: auditLog } = require('../services/auditLogService');

async function overview(req, res, next) {
  try {
    const suspicious = await User.find({ suspiciousFlag: true })
      .select('name email registrationIp registrationDeviceId createdAt referralBonusBlocked isRestricted')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    const blocked = await User.find({ referralBonusBlocked: true })
      .select('name email registrationIp referredBy createdAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    const ipDup = await User.aggregate([
      { $match: { registrationIp: { $nin: ['', null] } } },
      { $group: { _id: '$registrationIp', count: { $sum: 1 }, users: { $push: '$_id' } } },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);

    return res.status(200).json({
      suspicious,
      referralBlocked: blocked,
      sharedIps: ipDup.map((r) => ({
        ip: r._id,
        count: r.count,
        userIds: (r.users || []).map((id) => String(id)),
      })),
    });
  } catch (e) {
    return next(e);
  }
}

async function recentLogs(req, res, next) {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const q = type ? { type } : {};
    const logs = await AuditLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.status(200).json({ logs });
  } catch (e) {
    return next(e);
  }
}

async function restrictUser(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }
    const u = await User.findByIdAndUpdate(
      id,
      { $set: { isRestricted: true } },
      { new: true, runValidators: false }
    ).lean();
    if (!u) return res.status(404).json({ message: 'Not found' });
    await auditLog({
      type: 'admin',
      userId: u._id,
      actorId: req.user?.userId,
      req,
      message: 'user_restricted',
      meta: {},
    });
    return res.status(200).json({ ok: true, userId: String(u._id) });
  } catch (e) {
    return next(e);
  }
}

async function clearReferralBlock(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }
    const u = await User.findByIdAndUpdate(
      id,
      { $set: { referralBonusBlocked: false } },
      { new: true, runValidators: false }
    ).lean();
    if (!u) return res.status(404).json({ message: 'Not found' });
    await auditLog({
      type: 'admin',
      userId: u._id,
      actorId: req.user?.userId,
      req,
      message: 'referral_block_cleared',
      meta: {},
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return next(e);
  }
}

/**
 * Reverse last referral_bonus credit for user (referrer) — best-effort.
 */
async function removeLastReferralBonus(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }
    const last = await Transaction.findOne({
      userId: id,
      type: 'credit',
      reason: 'referral_bonus',
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!last) {
      return res.status(404).json({ message: 'Not found', details: 'No referral bonus to reverse' });
    }
    const amount = Number(last.amount || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid amount' });
    }

    const ref = `reverse_referral_${String(last._id)}`;
    let out;
    try {
      out = await debitWallet(id, amount, {
        reference: ref,
        reason: 'referral_reversal',
        source: 'admin',
        description: 'Referral bonus reversal',
        adjustTotalEarnings: true,
      });
    } catch (e) {
      return res.status(400).json({ message: 'Bad request', details: e.message || 'Reverse failed' });
    }
    if (out.skipped) {
      return res.status(200).json({ ok: true, message: 'Already reversed' });
    }

    await auditLog({
      type: 'admin',
      userId: id,
      actorId: req.user?.userId,
      req,
      message: 'referral_bonus_reversed',
      meta: { originalTx: String(last._id), amount },
    });

    return res.status(200).json({ ok: true, reversed: amount });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  overview,
  recentLogs,
  restrictUser,
  clearReferralBlock,
  removeLastReferralBonus,
};
