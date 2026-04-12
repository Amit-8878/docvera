const AuditLog = require('../models/AuditLog');

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

/**
 * @param {import('express').Request} [req]
 */
async function log({ type, userId, actorId, req, message, meta }) {
  try {
    const ip = req ? clientIp(req) : '';
    const userAgent = req && req.get ? String(req.get('user-agent') || '') : '';
    await AuditLog.create({
      type,
      userId: userId || null,
      actorId: actorId || null,
      ip,
      userAgent: userAgent.slice(0, 500),
      message: message || '',
      meta: meta && typeof meta === 'object' ? meta : {},
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('auditLogService.log failed', e.message);
  }
}

module.exports = {
  log,
  clientIp,
};
