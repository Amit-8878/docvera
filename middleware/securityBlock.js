/**
 * Temporary IP blocks after repeated failed auth attempts.
 * In-memory only — resets on process restart (acceptable for basic hardening).
 */

const { notifyRoleUsers } = require('../services/notificationService');

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS_BEFORE_BLOCK = 8;
const BLOCK_DURATION_MS = 15 * 60 * 1000;
const ADMIN_ALERT_AT_FAILS = 5;

/** ip -> { fails: number[], blockedUntil: number|null, alerted: boolean } */
const state = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function pruneOldFails(fails, now) {
  return fails.filter((t) => now - t < FAIL_WINDOW_MS);
}

function recordFailedAuth(ip, reason) {
  const now = Date.now();
  let row = state.get(ip);
  if (!row) {
    row = { fails: [], blockedUntil: null, alerted: false };
    state.set(ip, row);
  }
  row.fails = pruneOldFails(row.fails, now);
  row.fails.push(now);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'warn',
      type: 'auth_failure',
      ip,
      reason: reason || 'login',
      failCount: row.fails.length,
      at: new Date().toISOString(),
    })
  );

  if (row.fails.length >= ADMIN_ALERT_AT_FAILS && !row.alerted) {
    row.alerted = true;
    notifyRoleUsers('admin', {
      title: 'Security: repeated login failures',
      message: `IP ${ip}: ${row.fails.length} failed attempts in ~10 minutes.`,
      type: 'system',
      event: 'auth_failures',
      data: { ip, count: row.fails.length },
    }).catch(() => {});
  }

  if (row.fails.length >= MAX_FAILS_BEFORE_BLOCK) {
    row.blockedUntil = now + BLOCK_DURATION_MS;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'error',
        type: 'ip_blocked',
        ip,
        until: new Date(row.blockedUntil).toISOString(),
      })
    );
    notifyRoleUsers('admin', {
      title: 'Security: IP temporarily blocked',
      message: `IP ${ip} blocked for failed login attempts.`,
      type: 'system',
      event: 'ip_blocked',
      data: { ip, blockedUntil: row.blockedUntil },
    }).catch(() => {});
  }
}

function clearAuthFailures(ip) {
  state.delete(ip);
}

function isIpBlocked(ip) {
  const row = state.get(ip);
  if (!row || !row.blockedUntil) return false;
  if (Date.now() >= row.blockedUntil) {
    row.blockedUntil = null;
    row.fails = [];
    row.alerted = false;
    return false;
  }
  return true;
}

function blockMiddleware(req, res, next) {
  const ip = clientIp(req);
  if (isIpBlocked(ip)) {
    return res.status(429).json({
      success: false,
      data: null,
      message: 'Too many failed attempts. Try again later.',
      errorCode: 'AUTH_BLOCKED',
    });
  }
  next();
}

module.exports = {
  clientIp,
  recordFailedAuth,
  clearAuthFailures,
  isIpBlocked,
  blockMiddleware,
};
