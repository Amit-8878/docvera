const mongoose = require('mongoose');

/**
 * Razorpay webhook captures (payment.captured) — single collection for webhook audit + admin listing.
 */
const webhookPaymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, trim: true, index: true },
    orderId: { type: String, default: '', trim: true },
    amount: { type: Number },
    currency: { type: String, default: '' },
    status: { type: String, default: '' },
    method: { type: String, default: '' },
    email: { type: String, default: '' },
    contact: { type: String, default: '' },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WebhookPayment', webhookPaymentSchema);
