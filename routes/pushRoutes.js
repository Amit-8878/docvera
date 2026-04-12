const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const User = require('../models/User');
const env = require('../config/env');

const router = express.Router();

/** Public key for client PushManager.subscribe (no auth). Always 200 so clients do not retry 503 loops. */
router.get('/vapid-public-key', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const hasPair = Boolean(env.vapidPublicKey && env.vapidPrivateKey);
  res.status(200).json({
    publicKey: env.vapidPublicKey || '',
    configured: hasPair,
  });
});

router.post('/subscribe', authMiddleware, async (req, res, next) => {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid subscription' });
    }
    const uid = req.user.userId;
    const user = await User.findById(uid);
    if (!user) {
      return res.status(404).json({ message: 'Not found' });
    }
    user.webPushSubscriptions = (user.webPushSubscriptions || []).filter((s) => s.endpoint !== sub.endpoint);
    user.webPushSubscriptions.push({
      endpoint: sub.endpoint,
      keys: {
        p256dh: String(sub.keys.p256dh),
        auth: String(sub.keys.auth),
      },
    });
    await user.save();
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
