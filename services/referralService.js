const User = require('../models/User');
const Order = require('../models/Order');
const Referral = require('../models/Referral');
const ReferralCommission = require('../models/referral.model');
const { log: auditLog } = require('./auditLogService');
const {
  getBooleanSetting,
  getNumberSetting,
  getStringSetting,
} = require('./systemSettingsService');
const { recordReferralCommissionPaid } = require('./adminEarningsService');
const { creditWallet } = require('../utils/wallet');

/**
 * Referral commission — ONLY called from handlePaymentSuccess (payment success path).
 * Idempotent: unique ReferralCommission per orderId + stable wallet reference.
 *
 * @param {import('mongoose').Document|object} order — must include _id, user, paymentStatus, finalCalculatedPrice?, totalPrice?, amount?
 */
async function triggerReferralCommission(order) {
  const orderId = order._id;
  if (!orderId) {
    return { skipped: true, reason: 'no_order' };
  }

  if (order.paymentStatus !== 'held' && order.paymentStatus !== 'paid') {
    return { skipped: true, reason: 'Order not paid' };
  }

  const referralOn = await getBooleanSetting('referral_enabled', true);
  if (!referralOn) {
    return { skipped: true, reason: 'referral_disabled' };
  }

  const existingCommission = await ReferralCommission.findOne({ orderId }).lean();
  if (existingCommission) {
    return { skipped: true, reason: 'commission_already_recorded' };
  }

  const pct = await getNumberSetting('referral_commission_percent', 5);
  const minOrder = await getNumberSetting('referral_min_order_inr', 100);
  const commissionTypeRaw = await getStringSetting('referral_commission_type', 'all_orders');
  const commissionType = commissionTypeRaw === 'first_order' ? 'first_order' : 'all_orders';
  const rate = Math.min(Math.max(Number(pct) || 0, 0), 100) / 100;

  const customerId = order.user;
  const customer = await User.findById(customerId)
    .select('referredBy isVerified referralBonusBlocked phone email')
    .lean();
  if (!customer?.referredBy) {
    return { skipped: true, reason: 'No referrer' };
  }

  if (customer.isVerified === false) {
    await auditLog({
      type: 'referral',
      userId: customerId,
      message: 'referral_skipped_not_verified',
      meta: { orderId: String(orderId) },
    });
    return { skipped: true, reason: 'not_verified' };
  }
  if (customer.referralBonusBlocked) {
    return { skipped: true, reason: 'referral_blocked' };
  }

  const referrerId = customer.referredBy;
  if (String(referrerId) === String(customerId)) {
    return { skipped: true, reason: 'Self-referral' };
  }

  const referrer = await User.findById(referrerId).select('phone email').lean();
  if (referrer) {
    const re = String(referrer.email || '').toLowerCase().trim();
    const ce = String(customer.email || '').toLowerCase().trim();
    if (re && ce && re === ce) {
      return { skipped: true, reason: 'referrer_same_email' };
    }
    const rp = normalizeDigits(referrer.phone);
    const cp = normalizeDigits(customer.phone);
    if (rp.length >= 10 && cp.length >= 10 && rp === cp) {
      await auditLog({
        type: 'referral',
        userId: customerId,
        message: 'referral_skipped_same_phone_as_referrer',
        meta: { orderId: String(orderId) },
      });
      return { skipped: true, reason: 'same_phone_as_referrer' };
    }
  }

  if (commissionType === 'first_order') {
    const priorHeld = await Order.countDocuments({
      user: customerId,
      paymentStatus: { $in: ['held', 'paid', 'released'] },
      _id: { $ne: orderId },
    });
    if (priorHeld > 0) {
      return { skipped: true, reason: 'not_first_paid_order' };
    }
  }

  const total = Number(order.finalCalculatedPrice ?? order.totalPrice ?? order.amount ?? 0);
  if (total < minOrder) {
    return { skipped: true, reason: 'below_minimum_order' };
  }

  const bonus = Math.round(total * rate * 100) / 100;
  if (bonus <= 0) {
    return { skipped: true, reason: 'No bonus' };
  }

  const reference = `referral_bonus_${String(orderId)}`;
  const out = await creditWallet(referrerId, bonus, {
    reference,
    reason: 'referral_bonus',
    orderId,
    source: 'referral',
    description: 'Referral commission',
  });

  const walletAlreadyDone = Boolean(out.skipped && String(out.reason || '').includes('Already credited'));

  if (!out.credited && !walletAlreadyDone) {
    return out;
  }

  try {
    await ReferralCommission.create({
      referrerId,
      referredUserId: customerId,
      orderId,
      commissionAmount: bonus,
      status: 'paid',
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return { skipped: true, reason: 'commission_row_exists' };
    }
    throw err;
  }

  if (out.credited) {
    await recordReferralCommissionPaid(bonus);
    await Referral.findOneAndUpdate(
      { referredUserId: customerId },
      {
        $inc: { commissionEarned: bonus },
        $setOnInsert: { referrerId, referredUserId: customerId },
      },
      { upsert: true }
    );
    await auditLog({
      type: 'referral',
      userId: referrerId,
      message: 'referral_bonus_credited',
      meta: { orderId: String(orderId), buyerId: String(customerId), amount: bonus },
    });
  }

  return out.credited ? out : { skipped: true, reason: 'Already credited', backfilled: true };
}

function normalizeDigits(s) {
  return String(s || '').replace(/\D/g, '').slice(-12);
}

module.exports = {
  triggerReferralCommission,
};
