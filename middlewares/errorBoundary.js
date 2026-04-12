/**
 * Safe module loading + async route wrapper.
 * Prevents a failed require() or thrown sync error during router setup from taking down the process.
 */

const { logModuleError } = require('../utils/logger');

/**
 * @template T
 * @param {string} label
 * @param {() => T} factory
 * @returns {T}
 */
function safeRouter(label, factory) {
  try {
    return factory();
  } catch (err) {
    logModuleError(label, err, { phase: 'router_load' });
    const express = require('express');
    const r = express.Router();
    // Do not end the request with 503 — that breaks clients that treat 503 as "server down".
    // Forward so the app stack can still match another mount or return 404.
    r.use((req, res, next) => {
      next();
    });
    return r;
  }
}

/**
 * Express 4 async handler wrapper — forwards rejections to `next(err)`.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn
 */
function wrapAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Isolated error handler for a single router (optional use in sub-routers).
 */
function routerErrorHandler(err, req, res, next) {
  if (!err) return next();
  logModuleError('router', err, { path: req.originalUrl, phase: 'request' });
  if (res.headersSent) return next(err);
  res.status(err.statusCode || err.status || 500).json({
    success: false,
    message: 'Request failed in this module',
    errorCode: err.errorCode || 'MODULE_REQUEST_ERROR',
  });
}

module.exports = {
  safeRouter,
  wrapAsync,
  routerErrorHandler,
};
