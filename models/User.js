const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Optional phone field for compatibility with earlier flows.
    // Intentionally NOT unique to avoid registration failures when phone is missing/empty.
    phone: { type: String, default: '', trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    role: { type: String, enum: ['user', 'admin', 'agent', 'super_admin'], default: 'user' },
    /** Denormalized flag for agent features; kept in sync with `role === 'agent'` on save. */
    isAgent: { type: Boolean, default: false },
    preferredLanguage: { type: String, enum: ['en', 'hi', 'hinglish'], default: 'en' },
    /** Browse intent: government | private | personal (set from services wizard). */
    userPreference: { type: String, default: null, trim: true },
    shopName: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    /** Agent shop coordinates (manual or device); used for nearby search. */
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    /** Agent availability for lightweight polling / UX (not real-time presence). */
    isOnline: { type: Boolean, default: false },
    /** Latest order id this agent is focused on (optional; cleared on reject/complete). */
    currentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    /** Legal consent (required at registration for new accounts). */
    isTermsAccepted: { type: Boolean, default: false },
    isPrivacyAccepted: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    /** INR; used for agent payouts and customer wallet (referrals / pay with wallet). */
    walletBalance: { type: Number, default: 0, min: 0 },
    /**
     * INR; promotional / service credits only. Not withdrawable, not transferable, not mixed into agent payouts.
     * Decremented only via order payment with paymentType=promo (see paymentController + paymentProcessor).
     */
    promoBalance: { type: Number, default: 0, min: 0 },
    /** True after first-login bonus (if any) has been granted. */
    isFirstLoginBonusGiven: { type: Boolean, default: false },
    /** Lifetime INR credited to this user (referral bonuses, agent earnings credits, etc.). */
    totalEarnings: { type: Number, default: 0, min: 0 },
    /** Unique invite code (assigned at signup / backfill). */
    referralCode: { type: String, trim: true, sparse: true, unique: true },
    /** Set when this user registered with ?ref=CODE (Mongo id of referrer). */
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /** True if this account consumed a referral link at signup (one referrer per user). */
    referralUsed: { type: Boolean, default: false },
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0, min: 0 },
    completedOrders: { type: Number, default: 0, min: 0 },
    /** In-flight orders (assigned / processing); incremented on assign, decremented on complete or cancel. */
    activeOrders: { type: Number, default: 0, min: 0 },
    cancelledOrders: { type: Number, default: 0, min: 0 },
    /**
     * Optional agent commission % of order gross (0–100). When set, platform fee = remainder.
     * When unset, order split uses env platform fee % (same as calculateSplit).
     */
    commissionPercent: { type: Number, default: null, min: 0, max: 100 },
    agentLevel: { type: String, enum: ['Beginner', 'Verified', 'Pro'], default: 'Beginner' },
    isRestricted: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviews: {
      type: [
        new mongoose.Schema(
          {
            orderId: { type: String, default: '', trim: true },
            userId: { type: String, default: '', trim: true },
            rating: { type: Number, min: 1, max: 5, required: true },
            review: { type: String, default: '', trim: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    /** Email OTP (login/signup verification). Not returned in default queries. */
    otp: { type: String, select: false, default: '' },
    otpExpiry: { type: Date, default: null },
    /** False until OTP verified (new accounts). Defaults true for legacy documents. */
    isVerified: { type: Boolean, default: true },
    devices: {
      type: [
        new mongoose.Schema(
          {
            deviceId: { type: String, default: '', trim: true },
            ip: { type: String, default: '', trim: true },
            userAgent: { type: String, default: '', trim: true },
            lastActive: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    registrationIp: { type: String, default: '', trim: true, index: true },
    registrationDeviceId: { type: String, default: '', trim: true, index: true },
    suspiciousFlag: { type: Boolean, default: false },
    /** When true, referral bonuses never credit for this user's orders. */
    referralBonusBlocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/** Keep `isAgent` aligned with `role` (wallet / agent / referral flows may read either). */
userSchema.pre('save', function syncIsAgent() {
  if (this.isModified('role') || this.isNew) {
    this.isAgent = this.role === 'agent';
  }
});

/**
 * Ensure every user has a `referralCode` (signup paths usually set it; this backfills on first save).
 * Uses lazy `require` to avoid circular dependency with `utils/referralCode.js`.
 */
userSchema.pre('save', async function ensureReferralCode() {
  const raw = this.referralCode;
  const code = raw != null && String(raw).trim();
  if (code) return;

  try {
    const { assignReferralCodeFromName, assignUniqueReferralCode } = require('../utils/referralCode');
    const name = this.name && String(this.name).trim();
    this.referralCode = name ? await assignReferralCodeFromName(name) : await assignUniqueReferralCode();
  } catch (err) {
    throw err;
  }
});

module.exports = mongoose.model('User', userSchema);
