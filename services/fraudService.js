const User = require('../models/User');

/**
 * New registration: multi-account / shared-device rules.
 * @returns {{ referredBy: import('mongoose').Types.ObjectId | null, referralBonusBlocked: boolean, suspiciousFlag: boolean }}
 */
async function evaluateNewRegistration({ ip, deviceId, emailNorm, referredById }) {
  let referredBy = referredById || null;
  let referralBonusBlocked = false;
  let suspiciousFlag = false;

  const deviceTrim = typeof deviceId === 'string' ? deviceId.trim().slice(0, 128) : '';
  if (deviceTrim) {
    const dup = await User.findOne({
      registrationDeviceId: deviceTrim,
      email: { $ne: emailNorm },
    })
      .select('_id')
      .lean();
    if (dup) {
      referralBonusBlocked = true;
      referredBy = null;
    }
  }

  if (ip) {
    const sameIp = await User.countDocuments({ registrationIp: ip });
    if (sameIp >= 2) {
      suspiciousFlag = true;
    }
  }

  return { referredBy, referralBonusBlocked, suspiciousFlag };
}

module.exports = {
  evaluateNewRegistration,
};
