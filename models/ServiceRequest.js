const mongoose = require('mongoose');

const serviceRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    industry: { type: String, trim: true, default: '' },
    message: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['open', 'done', 'dismissed'], default: 'open' },
  },
  { timestamps: true }
);

serviceRequestSchema.index({ userId: 1, createdAt: -1 });
serviceRequestSchema.index({ status: 1, createdAt: -1 });
serviceRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
