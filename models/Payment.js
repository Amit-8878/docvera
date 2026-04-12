const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    /** Set when paying for a {@link CheckoutSession} before an order exists; cleared once order is created. */
    checkoutSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      default: null,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    /** Portion of `amount` paid from user wallet (paise, matches Razorpay units). */
    walletAmountPaise: { type: Number, default: 0, min: 0 },
    /** razorpay | manual | wallet (full wallet settlement) | promo (full promo balance) */
    paymentMethod: { type: String, enum: ['razorpay', 'manual', 'wallet', 'promo'], default: 'razorpay' },
    /** Legacy / display hint (card, upi, …) */
    method: { type: String, default: 'unknown', trim: true },
    razorpayOrderId: { type: String, default: '', trim: true, index: true },
    /** Razorpay payment id (pay_…); same as transactionId when from webhook */
    paymentId: { type: String, default: '', trim: true, index: true },
    transactionId: { type: String, default: '', trim: true, index: true },
    currency: { type: String, default: 'INR', trim: true },
    email: { type: String, default: '', trim: true },
    contact: { type: String, default: '', trim: true },
    status: {
      type: String,
      /**
       * `success_pending_order` — Razorpay capture recorded; order creation or settlement
       * still in progress or failed — use POST /payment/retry-checkout-order to continue.
       */
      enum: ['created', 'success', 'failed', 'pending', 'paid', 'success_pending_order'],
      default: 'created',
    },
    /** Last error when order/settlement failed after gateway capture (for support / retries). */
    lastOrderCreationError: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1, userId: 1, updatedAt: -1 });

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
