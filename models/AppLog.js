const mongoose = require('mongoose');

/** Operational logs (errors, payment milestones). TTL keeps the collection bounded. */
const appLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['error', 'payment'], required: true, index: true },
    level: { type: String, enum: ['error', 'warn', 'info'], default: 'info', index: true },
    message: { type: String, default: '', trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    requestId: { type: String, default: '', trim: true, index: true },
  },
  { timestamps: true }
);

appLogSchema.index({ userId: 1, createdAt: -1 });
appLogSchema.index({ orderId: 1, createdAt: -1 });
appLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('AppLog', appLogSchema);
