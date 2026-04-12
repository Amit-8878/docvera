const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const authController = require('../controllers/authController');
const referralController = require('../controllers/referralController');
const authMiddleware = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimit');

function skipAuthRateLimit() {
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.DISABLE_API_RATE_LIMIT || '').toLowerCase() === 'true';
}

const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many OTP requests. Try again later.', errorCode: 'OTP_RATE_LIMITED' },
  skip: () => skipAuthRateLimit(),
});
const { blockMiddleware, clientIp } = require('../middleware/securityBlock');

const authRouteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => `auth:${clientIp(req)}`,
});

router.post('/register', authRouteLimiter, blockMiddleware, authController.register);
router.post('/login', authRouteLimiter, blockMiddleware, authController.login);
router.post('/refresh', authRouteLimiter, authController.refresh);
router.put('/preferred-language', authMiddleware, authController.updatePreferredLanguage);
router.put('/user-preference', authMiddleware, authController.updateUserPreference);
router.put('/agent-profile', authMiddleware, authController.updateAgentProfile);
router.get('/referral', authMiddleware, referralController.getReferralSummary);
router.post('/send-verification-otp', authRouteLimiter, authMiddleware, otpSendLimiter, authController.sendVerificationOtp);
router.post('/verify-email-otp', authRouteLimiter, authMiddleware, authController.verifyEmailOtpHandler);

router.get('/test', (req, res) => {
  res.status(200).send('auth router test ok');
});

module.exports = router;
