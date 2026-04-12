/**
 * Browser/dev: GET /api/notifications without Authorization returns raw notification docs.
 * Authenticated requests pass through to the real notification router.
 */
async function notificationsPublicList(req, res, next) {
  const pathOnly = req.originalUrl.split('?')[0];
  const isRoot = pathOnly === '/api/notifications' || pathOnly === '/api/notifications/';
  if (req.method === 'GET' && isRoot && !req.headers.authorization) {
    res.set('Cache-Control', 'no-store');
    // Never leak DB or 500 for unauthenticated poll; clients expect { success, data }.
    return res.status(200).json({ success: true, data: [] });
  }
  return next();
}

module.exports = notificationsPublicList;
