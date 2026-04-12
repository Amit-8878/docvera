const mongoose = require('mongoose');

/**
 * Pre-payment checkout: documents uploaded here; {@link Order} is created only after payment succeeds.
 */
const checkoutSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    totalPrice: { type: Number, required: true, min: 0 },
    finalCalculatedPrice: { type: Number, required: true, min: 0 },
    /** User opted in to courier; `courierFee` is the INR add-on included in totals. */
    courierSelected: { type: Boolean, default: false },
    courierFee: { type: Number, default: 0, min: 0 },
    plan: { type: String, enum: ['', 'basic', 'standard', 'premium'], default: '' },
    preferredAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedTo: { type: String, default: '', trim: true },
    customerLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    /** Relative paths under uploads/local/checkout/{sessionId}/ */
    files: {
      type: [
        {
          relativePath: { type: String, required: true },
          originalName: { type: String, default: '' },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'fulfilled', 'expired'],
      default: 'pending',
      index: true,
    },
    /** Set when {@link Order} is created from this session. */
    fulfilledOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);
