/**
 * Pure helpers split from paymentController — same behavior.
 */
const path = require('path');
const fs = require('fs');
const { UPLOAD_ROOT } = require('../../files/file.service');

function checkoutSessionHasReadableFile(session) {
  if (!session || !Array.isArray(session.files) || session.files.length === 0) return false;
  for (const fe of session.files) {
    const rel = String(fe.relativePath || '').replace(/^\/+/, '').replace(/^local\/?/i, '');
    if (!rel) continue;
    const src = path.join(UPLOAD_ROOT, ...rel.split('/'));
    try {
      if (fs.existsSync(src) && fs.statSync(src).isFile()) return true;
    } catch (_e) {
      // ignore
    }
  }
  return false;
}

/**
 * How the customer pays for the order (bound order + amount match only).
 * Accepts legacy `paymentMode` for the same values.
 */
function normalizePaymentType(body) {
  const raw = body?.paymentType ?? body?.paymentMode ?? 'wallet';
  const s = String(raw).toLowerCase().trim();
  if (['wallet', 'promo', 'online'].includes(s)) return s;
  return 'wallet';
}

/** Razorpay `amount` must be a positive integer (paise). */
function intPaise(amount) {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

module.exports = {
  checkoutSessionHasReadableFile,
  normalizePaymentType,
  intPaise,
};
