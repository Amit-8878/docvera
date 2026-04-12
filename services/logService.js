const AppLog = require('../models/AppLog');

function clientIp(req) {
  if (!req) return '';
  const xf = req.headers && req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

/**
 * Persist server/API errors (sanitized — no stack in meta in production).
 */
async function logApiError({ err, req, statusCode }) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const meta = {
      path: req?.originalUrl || '',
      method: req?.method || '',
      statusCode: statusCode || 500,
      name: err?.name || 'Error',
    };
    if (!isProd && err?.stack) meta.stack = String(err.stack).slice(0, 8000);
    await AppLog.create({
      type: 'error',
      level: 'error',
      message: String(err?.message || 'Error').slice(0, 2000),
      meta,
      userId: req?.user?.userId || null,
      orderId: null,
      requestId: req?.requestId || '',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('logApiError failed', e && e.message ? e.message : e);
  }
}

/**
 * Payment flow milestones (create, verify success/fail).
 */
async function logPaymentEvent({ phase, userId, orderId, amount, status, meta, req }) {
  try {
    await AppLog.create({
      type: 'payment',
      level: 'info',
      message: String(phase || 'payment').slice(0, 500),
      meta: {
        status: status || '',
        amount: amount != null ? amount : undefined,
        ...(meta && typeof meta === 'object' ? meta : {}),
        ip: req ? clientIp(req) : '',
      },
      userId: userId || null,
      orderId: orderId || null,
      requestId: req?.requestId || '',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('logPaymentEvent failed', e && e.message ? e.message : e);
  }
}

module.exports = {
  logApiError,
  logPaymentEvent,
  clientIp,
};
