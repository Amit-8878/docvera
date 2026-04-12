const mongoose = require('mongoose');

/**
 * Audit trail for order background jobs (BullMQ). One document per (jobName, orderId).
 * Used for idempotency (success → skip), ops visibility, and post-mortems after restarts.
 */
const jobLogSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true, index: true },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    retryCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    errorMessage: { type: String, default: '' },
    bullJobId: { type: String, default: '' },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

jobLogSchema.index({ jobName: 1, orderId: 1 }, { unique: true });

module.exports = mongoose.model('JobLog', jobLogSchema);
