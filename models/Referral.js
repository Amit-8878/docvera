const mongoose = require('mongoose');

/** One row per referred user (referredUserId is unique). */
const referralSchema = new mongoose.Schema(
  {
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    commissionEarned: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Referral', referralSchema);
