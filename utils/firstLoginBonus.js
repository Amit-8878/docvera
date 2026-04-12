const User = require('../models/User');
const env = require('../config/env');
const { getNumberSetting } = require('../services/systemSettingsService');

/**
 * One-time promo credit on first password login.
 * Atomic: only the first matching update succeeds (runs once per user).
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @returns {Promise<import('mongoose').Document | null>} Updated user doc if bonus applied, else null
 */
async function applyFirstLoginBonusIfNeeded(userId) {
  const amount = Math.max(0, await getNumberSetting('first_login_promo_inr', env.firstLoginPromoInr));
  if (amount <= 0) return null;

  const updated = await User.findOneAndUpdate(
    { _id: userId, isFirstLoginBonusGiven: { $ne: true } },
    { $inc: { promoBalance: amount }, $set: { isFirstLoginBonusGiven: true } },
    { new: true }
  );
  return updated;
}

module.exports = { applyFirstLoginBonusIfNeeded };
