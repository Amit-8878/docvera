/**
 * Wrap async Express handlers so rejections become `next(err)` (never unhandled).
 * Use for new/refactored routes: `router.get('/x', safeAsync(ctrl.method))`.
 */
function safeAsync(fn) {
  return function safeAsyncHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (typeof next === 'function') return next(err);
      // eslint-disable-next-line no-console
      console.error('[safeAsync] missing next()', err);
    });
  };
}

module.exports = { safeAsync };
