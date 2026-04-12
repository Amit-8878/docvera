const otpGenerator = require('otp-generator');
const User = require('../models/User');
const env = require('../config/env');
const { sendMail } = require('./emailService');
const { log: auditLog } = require('./auditLogService');

function generateOtpDigits() {
  return otpGenerator.generate(6, {
    digits: true,
    lowerCaseAlphabets: false,
    upperCaseAlphabets: false,
    specialChars: false,
  });
}

async function sendVerificationOtpEmail(userId, req) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const otp = generateOtpDigits();
  const expiry = new Date(Date.now() + (env.otpTtlSeconds || 300) * 1000);

  user.otp = otp;
  user.otpExpiry = expiry;
  await user.save();

  const { sent, devLog } = await sendMail({
    to: user.email,
    subject: 'Your DOCVERA verification code',
    text: `Your verification code is: ${otp}\nIt expires in ${Math.floor((env.otpTtlSeconds || 300) / 60)} minutes.`,
  });

  await auditLog({
    type: 'otp',
    userId: user._id,
    req,
    message: sent ? 'otp_sent' : 'otp_generated_email_skipped',
    meta: { sent },
  });

  return { sent, devLog };
}

async function verifyEmailOtp(userId, otpRaw, req) {
  const code = typeof otpRaw === 'string' ? otpRaw.trim() : String(otpRaw || '');
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, reason: 'invalid_format' };
  }

  const user = await User.findById(userId).select('+otp +otpExpiry');
  if (!user) return { ok: false, reason: 'user_not_found' };
  if (!user.otp || !user.otpExpiry) return { ok: false, reason: 'no_otp' };
  if (user.otpExpiry.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  const saved = String(user.otp ?? '').trim();
  if (saved !== code) return { ok: false, reason: 'mismatch' };

  user.isVerified = true;
  user.otp = '';
  user.otpExpiry = null;
  await user.save();

  await auditLog({
    type: 'otp',
    userId: user._id,
    req,
    message: 'email_verified',
    meta: {},
  });

  return { ok: true };
}

module.exports = {
  sendVerificationOtpEmail,
  verifyEmailOtp,
};
