/**
 * Structured logging for modules, payments, and failures.
 * Uses JSON lines to stdout — safe for log aggregators; no PII by default.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const envLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const currentLevel = LEVELS[envLevel] != null ? LEVELS[envLevel] : LEVELS.info;

function emit(level, channel, event, meta = {}) {
  const n = LEVELS[level];
  if (n == null || n > currentLevel) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    channel,
    event,
    ...meta,
  });
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

function logModuleError(module, err, meta = {}) {
  emit('error', 'module', 'error', {
    module,
    message: err && err.message ? err.message : String(err),
    stack: process.env.NODE_ENV !== 'production' && err && err.stack ? err.stack : undefined,
    ...meta,
  });
}

function logPayment(event, meta = {}) {
  emit('info', 'payment', event, meta);
}

function logPaymentFailure(event, err, meta = {}) {
  emit('error', 'payment', 'failure', {
    step: event,
    message: err && err.message ? err.message : String(err),
    ...meta,
  });
}

function logFailure(area, err, meta = {}) {
  emit('error', area, 'failure', {
    message: err && err.message ? err.message : String(err),
    ...meta,
  });
}

function logInfo(channel, event, meta = {}) {
  emit('info', channel, event, meta);
}

module.exports = {
  logModuleError,
  logPayment,
  logPaymentFailure,
  logFailure,
  logInfo,
};
