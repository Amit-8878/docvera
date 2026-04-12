const User = require('../models/User');

/**
 * Blocks order placement until email OTP verified (new accounts).
 * Staff roles skip verification requirement.
 */
async function requireEmailVerified(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized', details: 'Missing user' });
    }
    const u = await User.findById(userId).select('isVerified isRestricted role').lean();
    if (!u) {
      return res.status(401).json({ message: 'Unauthorized', details: 'User not found' });
    }
    if (u.isRestricted) {
      return res.status(403).json({ message: 'Forbidden', details: 'Account is restricted' });
    }
    if (u.role === 'admin' || u.role === 'super_admin') {
      return next();
    }
    if (u.isVerified === false) {
      return res.status(403).json({
        message: 'Forbidden',
        details: 'Email verification required. Use POST /api/auth/send-verification-otp and /api/auth/verify-email-otp.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = requireEmailVerified;
