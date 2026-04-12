const mongoose = require("mongoose");

/**
 * Wallet / ledger transactions.
 *
 * Core shape (requested):
 * - `type`: deposit | withdrawal | referral_bonus | commission
 * - `status`: pending | success | failed
 *
 * Legacy values kept in enums so existing `wallet.js` / `paymentProcessor` flows (`credit`/`debit`, `completed`) remain valid.
 */
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      required: true,
      enum: ['deposit', 'withdrawal', 'referral_bonus', 'commission', 'credit', 'debit'],
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'completed'],
      default: 'pending',
      index: true,
    },
    remark: { type: String, trim: true },
    /** @deprecated Prefer `remark`; kept for older API responses. */
    description: { type: String, default: '', trim: true },
    /** Idempotency key for wallet credits/debits (see `utils/wallet.js`). */
    reference: { type: String, default: '', trim: true },
    /** Machine reason e.g. referral_bonus, order_payment */
    reason: { type: String, default: '', trim: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    source: {
      type: String,
      enum: [
        'referral',
        'service',
        'admin_adjustment',
        'order_payment',
        'promo_order_payment',
        'agent_release',
        'withdrawal',
        'wallet_topup',
        'other',
      ],
      default: 'other',
    },
  },
  { timestamps: true }
);

transactionSchema.index({ userId: 1, type: 1, reference: 1 }, { unique: true });

module.exports = mongoose.model('Transaction', transactionSchema);
