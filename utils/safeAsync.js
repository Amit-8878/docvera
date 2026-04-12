/**
 * Wrap an async Express handler so rejected promises call `next(err)`.
 * Prefer `require('express-async-errors')` globally; use this for explicit wrapping.
 */
function safeAsync(fn) {
  return function safeWrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { safeAsync };
