const mongoose = require('mongoose');

const withdrawRequestSchema = new mongoose.Schema(
  {
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WithdrawRequest', withdrawRequestSchema);

