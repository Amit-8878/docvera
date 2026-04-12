const webpush = require('web-push');
const mongoose = require('mongoose');
const User = require('../models/User');
const env = require('../config/env');

let configured = false;

function ensureWebPush() {
  if (configured) return true;
  if (env.vapidPublicKey && env.vapidPrivateKey) {
    webpush.setVapidDetails(
      env.vapidSubject || 'mailto:support@docvera.local',
      env.vapidPublicKey,
      env.vapidPrivateKey
    );
    configured = true;
    return true;
  }
  return false;
}

function isWebPushConfigured() {
  return ensureWebPush();
}

async function removeDeadSubscription(userId, endpoint) {
  try {
    await User.updateOne({ _id: userId }, { $pull: { webPushSubscriptions: { endpoint } } });
  } catch {
    /* ignore */
  }
}

async function sendPayloadToUserSubscriptions(userId, payload) {
  const user = await User.findById(userId).select('webPushSubscriptions').lean();
  if (!user?.webPushSubscriptions?.length) return;
  for (const sub of user.webPushSubscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (e) {
      if (e && e.statusCode === 410) {
        await removeDeadSubscription(userId, sub.endpoint);
      }
    }
  }
}

async function notifyAdmins(payload) {
  const admins = await User.find({ role: 'admin' })
    .select('_id webPushSubscriptions')
    .limit(50)
    .lean();
  for (const a of admins) {
    if (!a.webPushSubscriptions?.length) continue;
    for (const sub of a.webPushSubscriptions) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (e) {
        if (e && e.statusCode === 410) {
          await removeDeadSubscription(a._id, sub.endpoint);
        }
      }
    }
  }
}

/**
 * Fire-and-forget friendly: notify the intended recipient(s) of a new chat message (app closed).
 * Uses existing Message.receiverId + support routing.
 */
async function notifyNewChatMessage(doc) {
  if (!doc || !ensureWebPush()) return;
  const preview = (doc.text || '').trim().slice(0, 140) || 'New message';
  const payload = { title: 'DOCVERA', body: preview };

  const rid = doc.receiverId != null ? String(doc.receiverId).trim() : '';

  if (rid === 'support' || rid === '') {
    await notifyAdmins(payload);
    return;
  }

  if (mongoose.Types.ObjectId.isValid(rid)) {
    await sendPayloadToUserSubscriptions(rid, payload);
  }
}

/** Call once at process startup so VAPID details are set before any send. */
function initWebPushAtStartup() {
  ensureWebPush();
}

module.exports = {
  isWebPushConfigured,
  notifyNewChatMessage,
  sendPayloadToUserSubscriptions,
  initWebPushAtStartup,
};
