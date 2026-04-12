const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const env = require('../config/env');
const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const { assignReferralCodeFromName, assignUniqueReferralCode } = require('../utils/referralCode');
const Referral = require('../models/Referral');
const { evaluateNewRegistration } = require('../services/fraudService');
const { recordDevice } = require('../services/deviceService');
const { sendVerificationOtpEmail, verifyEmailOtp: verifyOtpCode } = require('../services/otpService');
const { log: auditLog } = require('../services/auditLogService');
const { recordSignupBonusPaid } = require('../services/adminEarningsService');
const { creditWallet } = require('../utils/wallet');
const { getBooleanSetting } = require('../services/systemSettingsService');
const { sendNotification } = require('../services/notificationService');
const { recordFailedAuth, clearAuthFailures, clientIp } = require('../middleware/securityBlock');
const { applyFirstLoginBonusIfNeeded } = require('../utils/firstLoginBonus');
const { TEMP_ADMIN_EMAIL, TEMP_ADMIN_PASSWORD } = require('../config/tempAdmin');

const SALT_ROUNDS = 10;

function parseOptionalCoord(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return n;
}

function authUserPayload(user) {
  return {
    id: user._id ? user._id.toString() : '',
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    shopName: user.shopName,
    address: user.address,
    city: user.city,
    state: user.state,
    pincode: user.pincode,
    isApproved: user.isApproved,
    latitude: user.latitude != null && !Number.isNaN(Number(user.latitude)) ? Number(user.latitude) : null,
    longitude: user.longitude != null && !Number.isNaN(Number(user.longitude)) ? Number(user.longitude) : null,
    isTermsAccepted: Boolean(user.isTermsAccepted),
    isPrivacyAccepted: Boolean(user.isPrivacyAccepted),
    walletBalance: Number(user.walletBalance || 0),
    promoBalance: Number(user.promoBalance || 0),
    totalEarnings: Number(user.totalEarnings || 0),
    referralCode: user.referralCode || null,
    referredBy: user.referredBy ? String(user.referredBy) : null,
    referralUsed: Boolean(user.referralUsed),
    isVerified: user.isVerified !== false,
    userPreference:
      user.userPreference === 'government' ||
      user.userPreference === 'private' ||
      user.userPreference === 'personal'
        ? user.userPreference
        : null,
    isOnline: user.role === 'agent' ? Boolean(user.isOnline) : undefined,
    currentOrder:
      user.role === 'agent' && user.currentOrder != null ? String(user.currentOrder) : undefined,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureUserReferralCode(userDoc) {
  if (userDoc.referralCode) return userDoc;
  const code = await assignReferralCodeFromName(userDoc.name || 'USER');
  userDoc.referralCode = code;
  await userDoc.save();
  return userDoc;
}
function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn || '7d' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      typ: 'refresh',
    },
    env.jwtSecret,
    { expiresIn: env.jwtRefreshExpiresIn || '30d' }
  );
}

/**
 * POST /api/auth/register
 * Body: { name, email, password, phone? }
 */
async function register(req, res, next) {
  try {
    const {
      name,
      email,
      password,
      phone,
      registerAsAgent,
      shopName,
      address,
      city,
      state,
      pincode,
      latitude,
      longitude,
      acceptTerms,
      acceptPrivacy,
      ref,
    } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Bad request', details: 'name is required' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ message: 'Bad request', details: 'email is required' });
    }
    const emailNorm = email.toLowerCase().trim();
    if (!validator.isEmail(emailNorm)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid email format' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        message: 'Bad request',
        details: 'password is required (min 6 characters)',
      });
    }

    const isForcedAdmin = emailNorm === TEMP_ADMIN_EMAIL;

    const existing = await User.findOne({ email: emailNorm }).select('+password');
    if (existing) {
      if (isForcedAdmin) {
        const hash = await bcrypt.hash(TEMP_ADMIN_PASSWORD, SALT_ROUNDS);
        existing.role = 'admin';
        existing.password = hash;
        if (typeof phone === 'string') existing.phone = phone.trim();
        await existing.save();
        const token = signToken(existing);
        const refreshToken = signRefreshToken(existing);
        return res.status(200).json({
          success: true,
          token,
          refreshToken,
          user: authUserPayload(existing),
        });
      }

      return res.status(409).json({ message: 'Conflict', details: 'Email already registered' });
    }

    const termsOk = acceptTerms === true || acceptTerms === 'true';
    const privacyOk = acceptPrivacy === true || acceptPrivacy === 'true';
    if (!termsOk || !privacyOk) {
      return res.status(400).json({
        message: 'Bad request',
        details: 'You must accept the Terms of Service and the Privacy Policy to register',
      });
    }

    const passwordToUse = isForcedAdmin ? TEMP_ADMIN_PASSWORD : password;
    const wantsAgent = Boolean(registerAsAgent);
    const roleToUse = isForcedAdmin ? 'admin' : wantsAgent ? 'agent' : 'user';
    const isApproved = isForcedAdmin ? true : !wantsAgent;

    const lat = parseOptionalCoord(latitude);
    const lng = parseOptionalCoord(longitude);
    if (roleToUse === 'agent' && !isForcedAdmin) {
      if (lat != null && (lat < -90 || lat > 90)) {
        return res.status(400).json({ message: 'Bad request', details: 'latitude must be between -90 and 90' });
      }
      if (lng != null && (lng < -180 || lng > 180)) {
        return res.status(400).json({ message: 'Bad request', details: 'longitude must be between -180 and 180' });
      }
    }

    const hash = await bcrypt.hash(passwordToUse, SALT_ROUNDS);

    let referredById = null;
    const refRaw = typeof ref === 'string' ? ref.trim() : '';
    const newPhoneDigits = String(typeof phone === 'string' ? phone : '')
      .replace(/\D/g, '')
      .slice(-12);

    if (refRaw && !isForcedAdmin && roleToUse === 'user') {
      const referrer = await User.findOne({
        referralCode: new RegExp(`^${escapeRegex(refRaw)}$`, 'i'),
      })
        .select('_id email referralCode phone')
        .lean();
      if (referrer) {
        if (referrer.email === emailNorm) {
          return res.status(400).json({
            message: 'Bad request',
            details: 'You cannot refer yourself',
          });
        }
        const refPhoneDigits = String(referrer.phone || '')
          .replace(/\D/g, '')
          .slice(-12);
        if (newPhoneDigits.length >= 10 && refPhoneDigits.length >= 10 && newPhoneDigits === refPhoneDigits) {
          return res.status(400).json({
            message: 'Bad request',
            details: 'Referral not valid for this phone number',
          });
        }
        referredById = referrer._id;
      }
    }

    const referralCode = await assignReferralCodeFromName(name.trim());

    const ip = clientIp(req);
    const deviceId = typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].trim().slice(0, 128) : '';

    let fraudResult = { referredBy: referredById, referralBonusBlocked: false, suspiciousFlag: false };
    if (!isForcedAdmin) {
      fraudResult = await evaluateNewRegistration({
        ip,
        deviceId,
        emailNorm,
        referredById: roleToUse === 'user' ? referredById : null,
      });
    }

    const user = await User.create({
      name: name.trim(),
      // Store phone only if provided; otherwise keep schema default ''.
      phone: typeof phone === 'string' ? phone.trim() : undefined,
      email: emailNorm,
      password: hash,
      role: roleToUse,
      shopName: typeof shopName === 'string' ? shopName.trim() : '',
      address: typeof address === 'string' ? address.trim() : '',
      city: typeof city === 'string' ? city.trim() : '',
      state: typeof state === 'string' ? state.trim() : '',
      pincode: typeof pincode === 'string' ? pincode.trim() : '',
      isApproved,
      referralCode,
      referredBy: fraudResult.referredBy,
      referralUsed: Boolean(fraudResult.referredBy && roleToUse === 'user'),
      referralBonusBlocked: fraudResult.referralBonusBlocked,
      suspiciousFlag: fraudResult.suspiciousFlag,
      registrationIp: ip || '',
      registrationDeviceId: deviceId || '',
      isVerified: Boolean(isForcedAdmin),
      ...(roleToUse === 'agent' && !isForcedAdmin
        ? {
            latitude: lat != null ? lat : null,
            longitude: lng != null ? lng : null,
          }
        : {}),
      isTermsAccepted: true,
      isPrivacyAccepted: true,
    });

    try {
      await recordDevice(user._id, req);
    } catch (e) {
      /* ignore */
    }

    if (fraudResult.referredBy && roleToUse === 'user') {
      try {
        await Referral.create({
          referrerId: fraudResult.referredBy,
          referredUserId: user._id,
          commissionEarned: 0,
        });
      } catch (e) {
        if (e && e.code !== 11000) console.error('Referral.create', e);
      }

      const configDoc = await SystemConfig.findOne().lean();
      const referralBonus = Math.max(
        0,
        Number(
          configDoc?.referralBonus != null ? configDoc.referralBonus : env.referralSignupBonusInr || 0
        )
      );
      const agentSystemOn = await getBooleanSetting('agent_system_enabled', true);
      if (agentSystemOn && referralBonus > 0 && !fraudResult.referralBonusBlocked) {
        try {
          const out = await creditWallet(fraudResult.referredBy, referralBonus, {
            reference: `referral_signup_${String(user._id)}`,
            reason: 'referral_bonus',
            source: 'referral',
            description: 'Referral signup bonus',
            transactionType: 'referral_bonus',
          });
          if (out.credited) {
            await recordSignupBonusPaid(referralBonus);
            try {
              await sendNotification({
                userId: fraudResult.referredBy,
                title: 'Referral bonus',
                message: 'Mubarak ho! Referral bonus credit ho gaya hai.',
                type: 'wallet',
                event: 'referral_signup_bonus',
                dedupeKey: `referral_bonus_signup_${String(user._id)}`,
              });
            } catch (nErr) {
              // eslint-disable-next-line no-console
              console.error('referral signup bonus notification', nErr && nErr.message ? nErr.message : nErr);
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('referral signup bonus', e && e.message ? e.message : e);
        }
      }
    }

    if (!isForcedAdmin) {
      try {
        await sendVerificationOtpEmail(user._id, req);
      } catch (e) {
        console.error('sendVerificationOtpEmail', e);
      }
    }

    let userForToken = user;
    if (roleToUse === 'user' && !isForcedAdmin) {
      try {
        const applied = await applyFirstLoginBonusIfNeeded(user._id);
        if (applied) userForToken = applied;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('register firstLoginPromo', e);
      }
    }

    const token = signToken(userForToken);
    const refreshToken = signRefreshToken(userForToken);

    return res.status(201).json({
      success: true,
      token,
      refreshToken,
      user: authUserPayload(userForToken),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const ip = clientIp(req);

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        message: 'Bad request',
        details: 'email and password are required',
      });
    }

    const emailNorm = email.toLowerCase().trim();
    if (!validator.isEmail(emailNorm)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid email format' });
    }
    const isForcedAdmin = emailNorm === TEMP_ADMIN_EMAIL;
    let user = await User.findOne({ email: emailNorm }).select('+password');

    // If temp admin logs in before startup seed ran, auto-create with bcrypt hash.
    if (!user && isForcedAdmin) {
      const hash = await bcrypt.hash(TEMP_ADMIN_PASSWORD, SALT_ROUNDS);
      user = await User.create({
        name: 'Admin',
        email: emailNorm,
        password: hash,
        role: 'admin',
        isTermsAccepted: true,
        isPrivacyAccepted: true,
        isVerified: true,
      });
      // Re-fetch with password selected for compare consistency
      user = await User.findOne({ email: emailNorm }).select('+password');
    }

    if (!user) {
      recordFailedAuth(ip, 'unknown_user');
      return res.status(401).json({
        message: 'Unauthorized',
        details: 'No account found with this email.',
      });
    }

    if (isForcedAdmin && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      recordFailedAuth(ip, 'bad_password');
      return res.status(401).json({
        message: 'Unauthorized',
        details: 'Incorrect password.',
      });
    }

    clearAuthFailures(ip);
    await ensureUserReferralCode(user);

    let userAfterBonus = user;
    try {
      const applied = await applyFirstLoginBonusIfNeeded(user._id);
      if (applied) userAfterBonus = applied;
    } catch (e) {
      console.error('firstLoginBonus', e);
    }

    // eslint-disable-next-line no-console
    console.log('LOGIN SUCCESS:', user.email);

    try {
      await recordDevice(userAfterBonus._id, req);
    } catch (e) {
      /* ignore */
    }
    try {
      await auditLog({
        type: 'login',
        userId: userAfterBonus._id,
        req,
        message: 'login_success',
        meta: { email: emailNorm },
      });
    } catch (e) {
      /* ignore */
    }

    const token = signToken(userAfterBonus);
    const refreshToken = signRefreshToken(userAfterBonus);

    return res.status(200).json({
      success: true,
      token,
      refreshToken,
      user: authUserPayload(userAfterBonus),
    });
  } catch (err) {
    return next(err);
  }
}

async function sendVerificationOtp(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    await sendVerificationOtpEmail(userId, req);
    return res.status(200).json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    return next(err);
  }
}

async function verifyEmailOtpHandler(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { otp } = req.body || {};
    const result = await verifyOtpCode(userId, otp, req);
    if (!result.ok) {
      return res.status(400).json({
        message: 'Bad request',
        details: result.reason || 'Verification failed',
      });
    }
    const user = await User.findById(userId);
    return res.status(200).json({ ok: true, user: authUserPayload(user) });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/refresh — exchange refresh JWT for new access + refresh tokens.
 */
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json({ message: 'Bad request', details: 'refreshToken is required' });
    }
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.jwtSecret);
    } catch (_e) {
      return res.status(401).json({ message: 'Unauthorized', details: 'Invalid or expired refresh token' });
    }
    if (decoded.typ !== 'refresh' || !decoded.id) {
      return res.status(401).json({ message: 'Unauthorized', details: 'Invalid refresh token' });
    }
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized', details: 'User not found' });
    }
    await ensureUserReferralCode(user);
    const token = signToken(user);
    const nextRefresh = signRefreshToken(user);
    return res.status(200).json({
      success: true,
      token,
      refreshToken: nextRefresh,
      user: authUserPayload(user),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/auth/agent-profile
 * Agents only: update shop fields and/or latitude/longitude.
 */
async function updateAgentProfile(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const existing = await User.findById(userId);
    if (!existing || existing.role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden', details: 'Agents only' });
    }

    const { latitude, longitude, shopName, address, city, state, pincode } = req.body || {};
    const updates = {};

    if (shopName !== undefined) {
      updates.shopName = typeof shopName === 'string' ? shopName.trim() : '';
    }
    if (address !== undefined) {
      updates.address = typeof address === 'string' ? address.trim() : '';
    }
    if (city !== undefined) {
      updates.city = typeof city === 'string' ? city.trim() : '';
    }
    if (state !== undefined) {
      updates.state = typeof state === 'string' ? state.trim() : '';
    }
    if (pincode !== undefined) {
      updates.pincode = typeof pincode === 'string' ? pincode.trim() : '';
    }

    if (latitude !== undefined) {
      const lat = parseOptionalCoord(latitude);
      if (lat == null) {
        updates.latitude = null;
      } else if (lat < -90 || lat > 90) {
        return res.status(400).json({ message: 'Bad request', details: 'latitude must be between -90 and 90' });
      } else {
        updates.latitude = lat;
      }
    }
    if (longitude !== undefined) {
      const lng = parseOptionalCoord(longitude);
      if (lng == null) {
        updates.longitude = null;
      } else if (lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'Bad request', details: 'longitude must be between -180 and 180' });
      } else {
        updates.longitude = lng;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'Bad request', details: 'No fields to update' });
    }

    const updated = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: 'Not found' });

    return res.status(200).json({ user: authUserPayload(updated) });
  } catch (err) {
    return next(err);
  }
}

async function updatePreferredLanguage(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { language } = req.body || {};
    if (!['en', 'hi', 'hinglish'].includes(language)) {
      return res.status(400).json({ message: 'Bad request', details: 'language must be en, hi, or hinglish' });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { preferredLanguage: language } },
      { new: true, runValidators: false }
    ).lean();
    if (!user) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ success: true, preferredLanguage: user.preferredLanguage });
  } catch (err) {
    return next(err);
  }
}

const ALLOWED_USER_PREFERENCE = new Set(['government', 'private', 'personal']);

/** PUT /api/auth/user-preference — browse intent for services filter. */
async function updateUserPreference(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { userPreference } = req.body || {};
    if (!ALLOWED_USER_PREFERENCE.has(userPreference)) {
      return res.status(400).json({
        message: 'Bad request',
        details: 'userPreference must be government, private, or personal',
      });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { userPreference } },
      { new: true, runValidators: false }
    ).lean();
    if (!user) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ success: true, user: authUserPayload(user) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  refresh,
  updateAgentProfile,
  updatePreferredLanguage,
  updateUserPreference,
  sendVerificationOtp,
  verifyEmailOtpHandler,
};
