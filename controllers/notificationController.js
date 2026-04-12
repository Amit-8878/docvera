const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const NotificationLog = require('../models/NotificationLog');
const User = require('../models/User');
const { sendNotification } = require('../services/notificationService');
const { getNotificationSettings, updateNotificationSettings } = require('../config/notificationSettings');
const { listTemplates, upsertTemplate } = require('../services/messageTemplateService');
const { getQueueStatus, TEST_MODE } = require('../services/whatsappService');

function isStaffNotificationAdmin(role) {
  return role === 'admin' || role === 'super_admin';
}

function mapNotification(n) {
  return {
    id: String(n._id),
    userId: String(n.userId),
    role: n.role,
    title: n.title,
    message: n.message,
    type: n.type,
    dedupeKey: n.dedupeKey || '',
    channel: n.channel || 'inApp',
    status: n.status || 'sent',
    attempts: Number(n.attempts || 0),
    failureReason: n.failureReason || '',
    read: Boolean(n.read),
    isRead: Boolean(n.read),
    createdAt: n.createdAt,
  };
}

async function getNotifications(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const filter = req.query?.filter;
    const query = { userId };
    if (filter === 'read') query.read = true;
    if (filter === 'unread') query.read = false;
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(100).lean();
    const unreadCount = await Notification.countDocuments({ userId, read: false });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ notifications: notifications.map(mapNotification), unreadCount });
  } catch (err) {
    return next(err);
  }
}

async function postNotification(req, res, next) {
  try {
    if (!isStaffNotificationAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const { userId, targetRole, broadcastAll, title, message, type, event, data, language } = req.body || {};
    const titleStr = typeof title === 'string' ? title.trim() : '';
    const messageStr = typeof message === 'string' ? message.trim() : '';
    if (!titleStr || !messageStr) {
      return res.status(400).json({ message: 'Bad request', details: 'title and message are required' });
    }

    if (broadcastAll === true) {
      const targets = await User.find({}).select('_id role').lean();
      const notifications = [];
      for (const target of targets) {
        // eslint-disable-next-line no-await-in-loop
        const n = await sendNotification({
          userId: target._id,
          title: titleStr,
          message: messageStr,
          type: type || 'system',
          role: target.role,
          event: event || 'admin_broadcast_all',
          data: data || {},
          language,
          dedupeKey: `admin_all_${String(target._id)}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        });
        if (n) notifications.push(mapNotification(n));
      }
      return res.status(201).json({ notifications, count: notifications.length });
    }

    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(String(userId))) {
        return res.status(400).json({ message: 'Bad request', details: 'Invalid userId' });
      }
      let tr = targetRole;
      if (!tr) {
        const u = await User.findById(userId).select('role').lean();
        tr = u?.role || 'user';
      }
      const created = await sendNotification({
        userId,
        title: titleStr,
        message: messageStr,
        type: type || 'system',
        role: tr,
        event: event || 'admin_message',
        data: data || {},
        language,
        dedupeKey:
          req.body?.dedupeKey ||
          `admin_${String(userId)}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      });
      return res.status(201).json({ notification: created ? mapNotification(created) : null });
    }

    if (targetRole) {
      const targets = await User.find({ role: targetRole }).select('_id role').lean();
      const notifications = [];
      for (const target of targets) {
        // eslint-disable-next-line no-await-in-loop
        const n = await sendNotification({
          userId: target._id,
          title: titleStr,
          message: messageStr,
          type: type || 'system',
          role: target.role,
          event: event || 'admin_broadcast_role',
          data: data || {},
          language,
          dedupeKey: `admin_broadcast_${String(target._id)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        });
        if (n) notifications.push(mapNotification(n));
      }
      return res.status(201).json({ notifications, count: notifications.length });
    }

    return res.status(400).json({
      message: 'Bad request',
      details: 'userId, targetRole, or broadcastAll is required',
    });
  } catch (err) {
    return next(err);
  }
}

async function markNotificationReadById(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: 'Bad request', details: 'Valid notification id is required' });
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { read: true } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ notification: mapNotification(updated) });
  } catch (err) {
    return next(err);
  }
}

async function markNotificationsRead(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { id, all } = req.body || {};

    if (all) {
      await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
      return res.status(200).json({ success: true });
    }
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: 'Bad request', details: 'Valid notification id is required' });
    }
    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { read: true } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ notification: mapNotification(updated) });
  } catch (err) {
    return next(err);
  }
}

async function deleteNotification(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: 'Bad request', details: 'Valid notification id is required' });
    }
    const deleted = await Notification.findOneAndDelete({ _id: id, userId }).lean();
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

function getSettings(req, res) {
  return res.status(200).json({ settings: getNotificationSettings(), queue: getQueueStatus(), testMode: TEST_MODE });
}

function updateSettings(req, res) {
  if (!isStaffNotificationAdmin(req.user?.role)) {
    return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
  }
  const settings = updateNotificationSettings(req.body || {});
  return res.status(200).json({ settings, queue: getQueueStatus(), testMode: TEST_MODE });
}

async function getTemplates(req, res, next) {
  try {
    if (!isStaffNotificationAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const templates = await listTemplates();
    return res.status(200).json({ templates });
  } catch (err) {
    return next(err);
  }
}

async function saveTemplate(req, res, next) {
  try {
    if (!isStaffNotificationAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const { event, messages } = req.body || {};
    if (!event || typeof event !== 'string') {
      return res.status(400).json({ message: 'Bad request', details: 'event is required' });
    }
    const template = await upsertTemplate(event, messages || {});
    return res.status(200).json({ template });
  } catch (err) {
    return next(err);
  }
}

async function getNotificationLogs(req, res, next) {
  try {
    if (!isStaffNotificationAdmin(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }
    const logs = await NotificationLog.find({}).sort({ createdAt: -1 }).limit(100).lean();
    return res.status(200).json({ logs });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getNotifications,
  postNotification,
  markNotificationReadById,
  markNotificationsRead,
  deleteNotification,
  getSettings,
  updateSettings,
  getTemplates,
  saveTemplate,
  getNotificationLogs,
};

