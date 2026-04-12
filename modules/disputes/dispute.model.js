const mongoose = require('mongoose');

const proofFileSchema = new mongoose.Schema(
  {
    fileUrl: { type: String, default: '', trim: true },
    fileName: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const disputeSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    reason: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    proofFiles: { type: [proofFileSchema], default: [] },
    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'rejected'],
      default: 'open',
      index: true,
    },
    adminResponse: { type: String, default: '', trim: true },
    /** Set when status becomes resolved (audit). */
    resolutionAction: {
      type: String,
      enum: ['', 'release_payment', 'refund', 'reassign_agent'],
      default: '',
    },
  },
  { timestamps: true }
);

disputeSchema.index({ orderId: 1, status: 1 });

module.exports = mongoose.model('Dispute', disputeSchema);
