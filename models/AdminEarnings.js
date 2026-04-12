const mongoose = require('mongoose');

/** Singleton-style aggregates (key = global). Updated when orders pay platform fees and referral commissions credit. */
const adminEarningsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    /** Sum of platform fees from orders (INR). */
    totalRevenue: { type: Number, default: 0, min: 0 },
    /** Sum of referral bonuses paid to referrers (INR). */
    totalCommissionPaid: { type: Number, default: 0, min: 0 },
    /** Count of orders that reached paid/held status (incremented once per order). */
    totalPaidOrders: { type: Number, default: 0, min: 0 },
    /** Sum of signup referral bonuses (INR). */
    totalSignupBonusesPaid: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminEarnings', adminEarningsSchema);
