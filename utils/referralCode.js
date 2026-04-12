const crypto = require('crypto');
const User = require('../models/User');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomReferralCode(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[bytes[i] % CHARSET.length];
  }
  return out;
}

function sanitizeNamePrefix(name) {
  const s = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return s || 'USER';
}

/**
 * Human-friendly code: NAME + 4 digits (e.g. AMIT1234). Uniqueness enforced against User.referralCode.
 */
async function assignReferralCodeFromName(name) {
  const prefix = sanitizeNamePrefix(name);
  for (let attempt = 0; attempt < 40; attempt++) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const code = `${prefix}${digits}`.slice(0, 20);
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  return assignUniqueReferralCode();
}

async function assignUniqueReferralCode() {
  for (let attempt = 0; attempt < 16; attempt++) {
    const code = randomReferralCode(10);
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate referral code');
}

module.exports = {
  randomReferralCode,
  assignUniqueReferralCode,
  assignReferralCodeFromName,
  sanitizeNamePrefix,
};
