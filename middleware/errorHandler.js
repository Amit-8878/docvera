/**
 * Centralized error handling.
 * - notFoundHandler catches unmatched routes.
 * - errorHandler returns JSON errors consistently (no raw stack/message in production for 5xx).
 */

const { logApiError } = require('../services/logService');
const { recordAndAnalyzeError } = require('../services/aiDebugger');

function notFoundHandler(req, res, next) {
  // eslint-disable-next-line no-unused-vars
  res.status(404).json({
    ok: false,
    success: false,
    data: null,
    error: 'NOT_FOUND',
    message: `Not Found - ${req.originalUrl}`,
    errorCode: 'NOT_FOUND',
    code: 'NOT_FOUND',
  });
}

function errorHandler(err, req, res, next) {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({
      ok: false,
      success: false,
      data: null,
      error: 'UPLOAD_ERROR',
      message: err.message || 'File upload failed',
      errorCode: 'UPLOAD_ERROR',
      code: 'UPLOAD_ERROR',
    });
  }
  if (err && err.message === 'Unsupported file type') {
    return res.status(400).json({
      ok: false,
      success: false,
      data: null,
      error: 'INVALID_FILE_TYPE',
      message: 'Unsupported file type',
      errorCode: 'INVALID_FILE_TYPE',
      code: 'INVALID_FILE_TYPE',
    });
  }
  if (err && (err.message === 'Only PDF and images are allowed' || err.message === 'Only PDF, images, and audio are allowed')) {
    return res.status(400).json({
      ok: false,
      success: false,
      data: null,
      error: 'INVALID_FILE_TYPE',
      message: err.message,
      errorCode: 'INVALID_FILE_TYPE',
      code: 'INVALID_FILE_TYPE',
    });
  }

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: 'error',
      type: 'api_error',
      requestId: req.requestId || '',
      method: req.method,
      path: req.originalUrl,
      message: err?.message || 'Internal Server Error',
      stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
    })
  );

  const statusCode = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const hideDetails = isProd && statusCode >= 500;

  /** Isolate feature failures: no 5xx to client for /api (webhooks need real status for retries). */
  const url = typeof req.originalUrl === 'string' ? req.originalUrl : '';
  if (
    statusCode >= 500 &&
    url.startsWith('/api') &&
    !url.includes('/webhook')
  ) {
    // eslint-disable-next-line no-console
    console.error('Feature Error:', err?.message || err);
    return res.status(200).json({
      ok: false,
      success: false,
      data: null,
      error: 'FEATURE_UNAVAILABLE',
      message: 'This feature is temporarily unavailable',
      code: 'FEATURE_UNAVAILABLE',
      errorCode: 'FEATURE_UNAVAILABLE',
    });
  }

  if (statusCode >= 500) {
    logApiError({ err, req, statusCode }).catch(() => {});
    recordAndAnalyzeError({ err, req, statusCode }).catch(() => {});
  }

  const errCode = err.errorCode || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  const payload = {
    ok: false,
    success: false,
    data: null,
    error: errCode,
    message: hideDetails
      ? 'Something went wrong'
      : err.message || 'Internal Server Error',
    errorCode: errCode,
    code: err.code || errCode,
  };

  if (!isProd) {
    payload.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
