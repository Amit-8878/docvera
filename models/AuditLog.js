const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['login', 'referral', 'payment', 'otp', 'fraud', 'admin', 'device', 'activity'],
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, default: '', trim: true },
    userAgent: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
