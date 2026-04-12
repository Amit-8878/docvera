const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { debitWallet, emitPromoBalanceUpdate } = require('./wallet');

function roundPaiseFromRupees(r) {
  const n = Number(r);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/**
 * How much wallet (paise) vs Razorpay (paise). Backend clamps client request to balance and order total.
 */
function computeWalletRazorpayPaise(expectedPaise, balancePaise, walletAmountPaiseRequested) {
  const walletPaise = Math.round(
    Math.max(
      0,
      Math.min(Number(walletAmountPaiseRequested) || 0, expectedPaise, balancePaise)
    )
  );
  const razorpayPaise = Math.round(expectedPaise - walletPaise);
  return { walletPaise, razorpayPaise };
}

/**
 * Single idempotent wallet debit for an order payment (one debit reference per order).
 */
async function debitWalletForOrderPayment(userId, orderId, walletRupees) {
  const n = Number(walletRupees || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return { skipped: true, reason: 'no_wallet_amount' };
  }
  return debitWallet(userId, n, {
    reference: `order_wallet_${String(orderId)}`,
    reason: 'order_payment',
    orderId,
    source: 'order_payment',
    description: 'Order payment (wallet)',
  });
}

/**
 * Idempotent promo debit for full order payment (one debit reference per order).
 * promoBalance is service-use only: not withdrawable, not transferable to wallet or other users.
 */
async function debitPromoForOrderPayment(userId, orderId, promoRupees) {
  try {
    const n = Math.max(0, Number(Number(promoRupees || 0).toFixed(2)));
    if (!Number.isFinite(n) || n <= 0) {
      return { skipped: true, reason: 'no_promo_amount' };
    }
    const reference = `order_promo_${String(orderId)}`;
    const existing = await Transaction.findOne({ userId, type: 'debit', reference }).lean();
    if (existing) {
      return { skipped: true, reason: 'Already debited' };
    }

    const updated = await User.findOneAndUpdate(
      { _id: userId, promoBalance: { $gte: n } },
      { $inc: { promoBalance: -n } },
      { new: true, runValidators: false }
    ).lean();
    if (!updated) {
      throw new Error('Insufficient promo balance');
    }

    await Transaction.create({
      userId,
      type: 'debit',
      amount: n,
      status: 'completed',
      reference,
      reason: 'order_payment',
      orderId,
      source: 'promo_order_payment',
      description: 'Order payment (promo balance)',
    });
    emitPromoBalanceUpdate(userId);
    return { debited: true, amount: n };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        type: 'debit_promo_failed',
        userId: String(userId),
        orderId: String(orderId),
        err: e && e.message ? e.message : String(e),
      })
    );
    throw e;
  }
}

/**
 * Full-wallet-first split (INR). Does not debit unless executeDebit is true.
 * @param {import('mongoose').Types.ObjectId|string|{ _id?: import('mongoose').Types.ObjectId }} orderOrId
 * @param {{ executeDebit?: boolean }} [options]
 */
async function processPayment(orderOrId, options = {}) {
  const oid = orderOrId && orderOrId._id != null ? orderOrId._id : orderOrId;
  const doc = await Order.findById(oid).lean();
  if (!doc) throw new Error('Order not found');
  if (['held', 'paid', 'released'].includes(String(doc.paymentStatus || ''))) {
    return { alreadyProcessed: true, message: 'Already processed' };
  }

  const amount = Number(doc.finalCalculatedPrice ?? doc.totalPrice ?? doc.amount ?? 0);
  const userId = doc.user;
  const user = await User.findById(userId).lean();
  if (!user) throw new Error('User not found');

  const storedW = Number(doc.walletAmountUsed ?? doc.walletUsed ?? 0);
  const storedO = Number(doc.onlinePaid ?? 0);

  let walletUsed;
  let onlineAmount;

  if (storedW > 0 || storedO > 0) {
    walletUsed = storedW;
    onlineAmount = storedO > 0 ? storedO : Math.max(0, Number((amount - walletUsed).toFixed(2)));
  } else {
    const bal = Number(user.walletBalance || 0);
    if (bal >= amount) {
      walletUsed = amount;
      onlineAmount = 0;
    } else {
      walletUsed = bal;
      onlineAmount = Math.max(0, Number((amount - walletUsed).toFixed(2)));
    }
  }

  if (options.executeDebit && walletUsed > 0) {
    await debitWalletForOrderPayment(userId, doc._id, walletUsed);
  }

  return { walletUsed, onlineAmount, orderId: doc._id };
}

module.exports = {
  roundPaiseFromRupees,
  computeWalletRazorpayPaise,
  debitWalletForOrderPayment,
  debitPromoForOrderPayment,
  processPayment,
};
