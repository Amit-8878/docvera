const mongoose = require('mongoose');

/**
 * One document per order that paid a referral commission (audit + duplicate prevention).
 * Unique on orderId ensures at most one commission per order.
 */
const referralCommissionSchema = new mongoose.Schema(
  {
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    commissionAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'paid',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReferralCommission', referralCommissionSchema);
