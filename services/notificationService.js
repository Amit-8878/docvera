const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const { getNotificationSettings } = require('../config/notificationSettings');
const { buildMessage, ensureDefaultTemplates } = require('./messageTemplateService');
const { enqueueWhatsApp } = require('./whatsappService');
const { getIo } = require('../socket/ioSingleton');
const { isWebPushConfigured, sendPayloadToUserSubscriptions } = require('./chatPushService');

const CLEANUP_DAYS = Number(process.env.NOTIFICATION_CLEANUP_DAYS || 30);

/** Admin / API simple categories (subset of Notification schema enum). */
const SIMPLE_UI_TYPES = new Set(['order', 'payment', 'system', 'chat']);

function normalizeRole(role) {
  if (role === 'super_admin') return 'admin';
  if (role === 'user' || role === 'agent' || role === 'admin') return role;
  return 'user';
}

function logNotificationFailure(ctx, err) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      type: 'notification_delivery_failed',
      ...ctx,
      err: err && err.message ? err.message : String(err),
    })
  );
}

async function createInAppLog({ userId, role, event, message, language, status = 'sent', error = '', meta = {} }) {
  try {
    await NotificationLog.create({
      userId,
      role: normalizeRole(role),
      event,
      channel: 'in_app',
      language: language || 'en',
      message: message || '',
      status,
      error,
      meta,
    });
  } catch (e) {
    logNotificationFailure({ step: 'in_app_log' }, e);
  }
}

/**
 * Central entry: persist, socket, WhatsApp queue, web push. Never throws.
 * Prefer this for new call sites; `createNotification` remains for templates/events.
 */
async function sendNotification({
  userId,
  title,
  message,
  type = 'system',
  role,
  event,
  data = {},
  language,
  dedupeKey,
}) {
  try {
    if (!userId) {
      logNotificationFailure({ step: 'send_notification', reason: 'missing_userId' }, new Error('missing userId'));
      return null;
    }
    let resolvedRole = role;
    if (!resolvedRole) {
      const u = await User.findById(userId).select('role').lean();
      resolvedRole = u?.role || 'user';
    }
    const t = String(type || 'system');
    const storedType = SIMPLE_UI_TYPES.has(t) ? t : 'system';
    const ev = event || `notify_${storedType}`;
    return await createNotification({
      userId,
      role: resolvedRole,
      title: String(title || 'Notification').trim().slice(0, 200),
      message: String(message || '').trim().slice(0, 4000),
      type: storedType,
      event: ev,
      data,
      language,
      dedupeKey,
    });
  } catch (err) {
    logNotificationFailure({ step: 'send_notification', userId: String(userId) }, err);
    return null;
  }
}

async function createNotification({
  userId,
  role,
  title,
  message,
  type = 'system',
  event = 'system_message',
  data = {},
  language,
  dedupeKey,
}) {
  try {
    if (!userId) return null;
    const dk = typeof dedupeKey === 'string' && dedupeKey.trim() ? dedupeKey.trim().slice(0, 200) : '';
    if (dk) {
      const existing = await Notification.findOne({ userId, dedupeKey: dk }).lean();
      if (existing) {
        return Notification.findById(existing._id);
      }
    }
    await ensureDefaultTemplates();
    const settings = getNotificationSettings();
    const safeRole = normalizeRole(role);
    const user = await User.findById(userId).select('phone name role preferredLanguage').lean();
    const targetLang =
      language && ['en', 'hi', 'hinglish'].includes(language)
        ? language
        : user?.preferredLanguage || 'en';
    const builtMessage = message || (await buildMessage(event, data, targetLang));
    const builtTitle = title || event.replace(/_/g, ' ');
    let created = null;

    /** In-app row + socket + push (optional via settings). */
    if (settings.inApp) {
      try {
        created = await Notification.create({
          userId,
          role: safeRole,
          title: builtTitle,
          message: builtMessage,
          type,
          ...(dk ? { dedupeKey: dk } : {}),
          channel: 'inApp',
          status: 'pending',
          attempts: 1,
          read: false,
        });
      } catch (err) {
        if (err && err.code === 11000 && dk) {
          return Notification.findOne({ userId, dedupeKey: dk });
        }
        logNotificationFailure({ step: 'db_create', userId: String(userId) }, err);
        return null;
      }
      try {
        created = await Notification.findByIdAndUpdate(
          created._id,
          { $set: { status: 'sent', failureReason: '' } },
          { new: true, runValidators: false }
        );
      } catch (e) {
        logNotificationFailure({ step: 'db_mark_sent', userId: String(userId) }, e);
        return created;
      }
      await createInAppLog({
        userId,
        role: safeRole,
        event,
        message: builtMessage,
        language: targetLang,
        status: 'sent',
        meta: { notificationId: created?._id ? String(created._id) : '' },
      });

      try {
        const io = getIo();
        if (io && created) {
          const socketPayload = {
            id: String(created._id),
            userId: String(userId),
            role: safeRole,
            title: builtTitle,
            message: builtMessage,
            type,
            dedupeKey: dk || '',
            channel: 'inApp',
            status: 'sent',
            attempts: 1,
            failureReason: '',
            read: false,
            createdAt: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
          };
          io.to(String(userId)).emit('notification', socketPayload);
          io.to(String(userId)).emit('new_notification', socketPayload);
        }
      } catch (e) {
        logNotificationFailure({ step: 'socket_emit', userId: String(userId) }, e);
      }

      try {
        if (isWebPushConfigured() && created) {
          await sendPayloadToUserSubscriptions(userId, {
            title: builtTitle,
            body: String(builtMessage || '').slice(0, 180),
          });
        }
      } catch (e) {
        logNotificationFailure({ step: 'web_push', userId: String(userId) }, e);
      }
    }

    if (user && user.phone) {
      try {
        enqueueWhatsApp({
          phone: user.phone,
          message: builtMessage,
          context: {
            userId,
            role: safeRole,
            event,
            language: targetLang,
            meta: { title: builtTitle },
          },
        });
      } catch (e) {
        logNotificationFailure({ step: 'whatsapp_enqueue', userId: String(userId) }, e);
      }
    }

    return created;
  } catch (err) {
    logNotificationFailure({ step: 'create_notification', userId: String(userId) }, err);
    return null;
  }
}

async function cleanupOldNotifications(days = CLEANUP_DAYS) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await Notification.deleteMany({ createdAt: { $lt: cutoff } });
  return result.deletedCount || 0;
}

function startNotificationCleanupJob() {
  const intervalMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    cleanupOldNotifications().catch(() => {});
  }, intervalMs);
}

async function notifyRoleUsers(role, payload) {
  try {
    const users = await User.find({ role }).select('_id role').lean();
    if (!users.length) return [];
    const baseDedupe = payload.dedupeKey && typeof payload.dedupeKey === 'string' ? payload.dedupeKey.trim() : '';
    const { dedupeKey: _omit, ...rest } = payload;
    const out = [];
    for (const u of users) {
      // eslint-disable-next-line no-await-in-loop
      const n = await createNotification({
        userId: u._id,
        role: u.role,
        ...rest,
        ...(baseDedupe ? { dedupeKey: `${baseDedupe}_u_${String(u._id)}` } : {}),
      });
      if (n) out.push(n);
    }
    return out;
  } catch (e) {
    logNotificationFailure({ step: 'notify_role_users', role }, e);
    return [];
  }
}

module.exports = {
  sendNotification,
  createNotification,
  notifyRoleUsers,
  cleanupOldNotifications,
  startNotificationCleanupJob,
};
