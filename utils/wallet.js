const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { getIo } = require('../socket/ioSingleton');

function emitWalletUpdate(userId) {
  const io = getIo();
  if (!io) return;
  User.findById(userId)
    .select('walletBalance')
    .lean()
    .then((u) => {
      if (u) {
        io.to(String(userId)).emit('wallet_update', {
          walletBalance: Number(u.walletBalance || 0),
        });
      }
    })
    .catch(() => {});
}

function emitPromoBalanceUpdate(userId) {
  const io = getIo();
  if (!io) return;
  User.findById(userId)
    .select('promoBalance')
    .lean()
    .then((u) => {
      if (u) {
        io.to(String(userId)).emit('promo_balance_update', {
          promoBalance: Number(u.promoBalance || 0),
        });
      }
    })
    .catch(() => {});
}

/**
 * Single entry for all wallet credits. Idempotent by `opts.reference` (unique with userId+type).
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {number} amountInr
 * @param {object} opts
 * @param {string} opts.reference required stable idempotency key
 * @param {string} [opts.reason]
 * @param {import('mongoose').Types.ObjectId|null} [opts.orderId]
 * @param {string} [opts.source]
 * @param {string} [opts.description]
 * @param {boolean} [opts.incrementTotalEarnings] default true — set false for wallet top-ups (balance-only)
 * @param {string} [opts.transactionType] ledger `type` — default `'credit'`; use `'referral_bonus'` for signup/order referral credits.
 */
async function creditWallet(userId, amountInr, opts = {}) {
  const amount = Number(amountInr);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { skipped: true, reason: 'invalid_amount' };
  }
  const reference = opts.reference;
  if (!reference || typeof reference !== 'string') {
    throw new Error('creditWallet: opts.reference is required');
  }

  const txType = opts.transactionType || 'credit';

  const existing = await Transaction.findOne({ userId, type: txType, reference }).lean();
  if (existing) return { skipped: true, reason: 'Already credited' };

  const reason = opts.reason || 'wallet_credit';
  const orderId = opts.orderId || null;
  const source = opts.source || 'other';
  const description = opts.description || '';

  let tx;
  try {
    tx = await Transaction.create({
      userId,
      type: txType,
      amount,
      status: 'pending',
      reference,
      reason,
      orderId: orderId || undefined,
      source,
      description,
    });
  } catch (err) {
    if (err && err.code === 11000) return { skipped: true, reason: 'Already credited' };
    throw err;
  }

  const inc = { walletBalance: amount };
  if (opts.incrementTotalEarnings !== false) {
    inc.totalEarnings = amount;
  }
  await User.findByIdAndUpdate(userId, { $inc: inc }, { runValidators: false });
  await Transaction.findByIdAndUpdate(tx._id, { $set: { status: 'completed' } }, { runValidators: false });
  emitWalletUpdate(userId);
  return { credited: true, amount };
}

/**
 * Single entry for all wallet debits. Idempotent by `opts.reference`.
 * Only affects walletBalance — never promoBalance.
 */
async function debitWallet(userId, amountInr, opts = {}) {
  const amount = Number(amountInr);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid debit amount');
  }
  const reference = opts.reference;
  if (!reference || typeof reference !== 'string') {
    throw new Error('debitWallet: opts.reference is required');
  }

  const existing = await Transaction.findOne({ userId, type: 'debit', reference }).lean();
  if (existing) {
    const u = await User.findById(userId).select('walletBalance').lean();
    return { skipped: true, reason: 'Already debited', balance: Number(u?.walletBalance || 0) };
  }

  const filter = { _id: userId, walletBalance: { $gte: amount } };
  const inc = { walletBalance: -amount };
  if (opts.adjustTotalEarnings) {
    filter.totalEarnings = { $gte: amount };
    inc.totalEarnings = -amount;
  }

  const updated = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true, runValidators: false }).lean();
  if (!updated) {
    throw new Error(opts.adjustTotalEarnings ? 'Insufficient wallet or earnings to reverse' : 'Insufficient wallet balance');
  }

  await Transaction.create({
    userId,
    type: 'debit',
    amount,
    status: 'completed',
    reference,
    reason: opts.reason || 'debit',
    orderId: opts.orderId || undefined,
    source: opts.source || 'order_payment',
    description: opts.description || '',
  });
  emitWalletUpdate(userId);
  return { debited: true, amount, balance: Number(updated.walletBalance || 0) };
}

/** Backwards-compatible: map legacy `source` string + orderId to reference. */
async function creditWalletLegacy(userId, amount, source, orderId, extra = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    return { skipped: true, reason: 'invalid_amount' };
  }
  const src =
    source === 'payment'
      ? 'order_payment'
      : source === 'admin'
        ? 'admin_adjustment'
        : source === 'referral'
          ? 'referral'
          : 'other';
  const reference =
    extra.reference ||
    (orderId ? `wallet_credit_${src}_${String(orderId)}` : `wallet_credit_${src}_${String(userId)}_${Date.now()}`);
  return creditWallet(userId, n, {
    reference,
    reason: extra.reason || 'wallet_credit',
    orderId: orderId || undefined,
    source: src,
    description: extra.description || '',
  });
}

/**
 * Spec-friendly: credit by (userId, amount, source, orderId) — idempotent per order+source via reference.
 * Delegates to creditWalletLegacy (stable reference from orderId).
 */
async function creditWalletBySource(userId, amountInr, source, orderId) {
  return creditWalletLegacy(userId, amountInr, source || 'other', orderId);
}

/**
 * Debit for order payment using stable reference `order_wallet_<orderId>` (same as order flow).
 */
async function debitWalletForOrderAmount(userId, amountInr, orderId) {
  const n = Number(amountInr);
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

module.exports = {
  creditWallet,
  debitWallet,
  /** @deprecated use creditWallet with opts */
  creditWalletLegacy,
  creditWalletBySource,
  debitWalletForOrderAmount,
  emitPromoBalanceUpdate,
  emitWalletUpdate,
};
