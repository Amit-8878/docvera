const rateLimit = require('express-rate-limit');

const windowMs = Number(process.env.API_RATE_WINDOW_MS) || 15 * 60 * 1000;
const max = Number(process.env.API_RATE_MAX) || 100;

/** When true, no IP throttling (local dev or explicit opt-out). Never enable in production. */
function isRateLimitDisabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.DISABLE_API_RATE_LIMIT || '').toLowerCase() === 'true';
}

/**
 * Baseline API rate limit per IP (default: 100 requests / 15 minutes).
 * Set API_RATE_WINDOW_MS=60000 and API_RATE_MAX=20 in .env for stricter per-minute limits.
 * Disabled entirely when NODE_ENV !== production or DISABLE_API_RATE_LIMIT=true.
 * Skips /api/chat/*, health, public status, and auth/OTP-heavy routes (see skip).
 */
const globalApiLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again shortly.',
    errorCode: 'RATE_LIMITED',
    code: 'RATE_LIMITED',
  },
  skip: (req) => {
    if (isRateLimitDisabled()) return true;
    const u = req.originalUrl || req.url || '';
    if (u.includes('/chat')) return true;
    if (u.includes('/health')) return true;
    if (u.includes('/public/system-status')) return true;
    if (u.includes('/auth/send-verification-otp')) return true;
    if (u.includes('/auth/verify-email-otp')) return true;
    if (u.includes('/agent-onboarding/request-otp')) return true;
    return false;
  },
});

module.exports = {
  globalApiLimiter,
};
