const mongoose = require('mongoose');

/** Global app configuration (typically a single document). */
const systemConfigSchema = new mongoose.Schema(
  {
    signupBonusAmount: { type: Number, default: 200 },
    /** INR credited to referrer when a referred user signs up (see `authController` + admin PATCH pricing). */
    referralBonus: { type: Number, default: 50, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
