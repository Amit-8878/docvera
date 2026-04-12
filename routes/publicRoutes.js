const express = require('express');

const router = express.Router();

const demoOrEnvKey = () => process.env.VAPID_PUBLIC_KEY || 'demo_key';

/**
 * GET /api/public/push/vapid-public-key — public VAPID key for web push (no auth).
 * Also mounted as GET /api/push/vapid-public-key in server.js (before maintenance).
 */
function vapidPublicKeyHandler(req, res) {
  res.set('Cache-Control', 'no-store');
  const key = demoOrEnvKey();
  const hasPair = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  res.status(200).json({
    success: true,
    key,
    publicKey: key,
    configured: hasPair,
  });
}

router.get('/push/vapid-public-key', vapidPublicKeyHandler);

module.exports = router;
module.exports.vapidPublicKeyHandler = vapidPublicKeyHandler;
