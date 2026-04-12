const dotenv = require('dotenv');
const path = require('path');

// Load server/.env when config is required from project root; server.js also loads explicitly.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  /** Public API base for clients (e.g. https://api.example.com/api). No secrets. */
  apiBase: (process.env.API_BASE || 'http://localhost:5000/api').replace(/\/$/, ''),
  /** Frontend origin(s) for CORS — comma-separated, no trailing slash (see CLIENT_URL in .env.example). */
  clientUrl: (process.env.CLIENT_URL || '').trim(),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/docvera',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS || 300), // 5 minutes
  adminPhone: process.env.ADMIN_PHONE || '', // used to authorize admin-only endpoints
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
  notifInApp: String(process.env.NOTIF_INAPP || 'true').toLowerCase() === 'true',
  notifWhatsapp: String(process.env.NOTIF_WHATSAPP || 'false').toLowerCase() === 'true',
  testMode: String(process.env.TEST_MODE || 'true').toLowerCase() === 'true',
  /**
   * When true, clients may pass simulatePayment on order create and use payout simulation endpoints.
   * Also enabled when TEST_MODE is true (local dev).
   */
  simulatePaymentAllowed: (() => {
    const s = String(process.env.SIMULATE_PAYMENT || '').toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    return String(process.env.TEST_MODE || 'true').toLowerCase() === 'true';
  })(),
  /**
   * Optional: Redis URL. Set REDIS_DISABLED=1 (or true) to force memory mode and skip TCP
   * (stops ECONNREFUSED spam when REDIS_URL points at a local daemon that is not running).
   */
  redisUrl: (() => {
    const off = String(process.env.REDIS_DISABLED || '').toLowerCase();
    if (off === '1' || off === 'true' || off === 'yes') return '';
    return String(process.env.REDIS_URL || '').trim();
  })(),
  /** Web Push (VAPID) — generate with: npx web-push generate-vapid-keys */
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:support@docvera.local',
  /**
   * Platform fee on order payment (decimal 0.05–0.10). Default 0.08 (8%).
   * Clamped in payment flow — do not set outside range in production without review.
   */
  platformFeePercent: (() => {
    const n = Number(process.env.PLATFORM_FEE_PERCENT);
    if (Number.isFinite(n) && n >= 0.05 && n <= 0.1) return n;
    return 0.08;
  })(),
  /**
   * Optional default agent share of order gross (0–100), e.g. 70 for 70% to agent when
   * the agent has no per-user `commissionPercent`. If unset, split uses `platformFeePercent` (remainder to agent).
   */
  agentDefaultCommissionPercent: (() => {
    const n = Number(process.env.AGENT_COMMISSION_PERCENT);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    return null;
  })(),
  /** One-time INR to referrer when a new user signs up with a valid referral code. */
  referralSignupBonusInr: Math.max(0, Number(process.env.REFERRAL_SIGNUP_BONUS_INR || 50)),
  /**
   * Default INR credited to `promoBalance` on first login (if `isFirstLoginBonusGiven` is false).
   * Override via admin SystemSetting `first_login_promo_inr` or env `FIRST_LOGIN_PROMO_INR`.
   */
  firstLoginPromoInr: Math.max(0, Number(process.env.FIRST_LOGIN_PROMO_INR ?? 200)),
  /** Optional: required on /api/admin/reviews* and /api/reviews* (except public carousel/submit). */
  adminReviewKey: String(process.env.ADMIN_REVIEW_KEY || '').trim(),
};

module.exports = env;
