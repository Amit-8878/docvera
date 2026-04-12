/**
 * Standard API JSON shapes + optional Express helpers on `res`.
 * Unified envelope: { ok, success, data, error, message } — backward-compatible with `success`.
 */

function ok(data) {
  return {
    ok: true,
    success: true,
    data: data != null ? data : {},
    error: null,
    message: '',
  };
}

function fail(message, code, extra = {}) {
  return {
    ok: false,
    success: false,
    data: null,
    error: code || 'ERROR',
    message: message || 'Request failed',
    code: code || 'ERROR',
    ...extra,
  };
}

/** Explicit success envelope (optional top-level message). */
function standardSuccess(data, message = '') {
  return {
    ok: true,
    success: true,
    data: data != null ? data : null,
    error: null,
    ...(message ? { message } : {}),
  };
}

/** Explicit failure envelope. */
function standardFail(message, errorCode = 'ERROR', data = null) {
  return {
    ok: false,
    success: false,
    data,
    error: errorCode,
    message: message || 'Request failed',
  };
}

/**
 * Attaches `res.apiSuccess(data, status?)` and `res.apiError(message, code, status?)`.
 */
function attachApiResponseHelpers(req, res, next) {
  res.apiSuccess = (data, status = 200) => res.status(status).json(ok(data));
  res.apiError = (message, code, status = 400) => res.status(status).json(fail(message, code));
  next();
}

module.exports = {
  ok,
  fail,
  standardSuccess,
  standardFail,
  attachApiResponseHelpers,
};
