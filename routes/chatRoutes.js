const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const { requireFeatureEnabled } = require('../middleware/systemFeatureMiddleware');
const { upload } = require('../config/chatMulter');

const router = express.Router();

function isStaffAdmin(role) {
  return role === 'admin' || role === 'super_admin';
}

const ALLOWED_EXPIRY_DAYS = new Set([1, 3, 7]);

function parseExpiryDays(raw) {
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (ALLOWED_EXPIRY_DAYS.has(n)) return n;
  return null;
}

function expiresAtFromDays(days) {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Hide messages that have passed their expiry (before hourly delete runs). */
function notExpiredMatch() {
  return {
    $or: [
      { expiresAt: null },
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  };
}

/** Single status for ticks — derived from existing isSeen / isDelivered (no duplicate DB field). */
function deriveMessageStatus(o) {
  const seen = !!o.isSeen;
  const delivered = o.isDelivered === true || o.isDelivered === undefined;
  if (seen) return 'seen';
  if (delivered) return 'delivered';
  return 'sent';
}

function inferMessageType(fileName) {
  if (!fileName) return 'text';
  const ext = path.extname(fileName).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  if (['.webm', '.ogg', '.mp3', '.m4a', '.wav'].includes(ext)) return 'audio';
  if (ext === '.pdf') return 'file';
  return 'file';
}

function formatMessageDoc(doc) {
  const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  if (!o) return null;
  const id = o._id ? String(o._id) : String(o.id);
  const fileUrl = o.file ? `/uploads/chat/${o.file}` : null;
  const type = o.type || inferMessageType(o.file);
  const sender = o.sender ? String(o.sender) : '';
  let receiverId = o.receiverId != null && o.receiverId !== '' ? String(o.receiverId) : null;
  if (!receiverId) {
    if (o.senderRole === 'admin' || o.senderRole === 'agent') {
      receiverId = o.threadUserId ? String(o.threadUserId) : null;
    } else {
      receiverId = 'support';
    }
  }
  const isDelivered = o.isDelivered === true || o.isDelivered === undefined;
  const isSeen = !!o.isSeen;
  const status = deriveMessageStatus(o);
  return {
    id,
    threadUserId: o.threadUserId,
    sender,
    senderId: sender,
    senderRole: o.senderRole,
    receiverId,
    text: o.text || '',
    message: o.text || '',
    file: o.file || null,
    fileUrl,
    type,
    isSeen,
    isDelivered,
    status,
    seenAt: o.seenAt || null,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt ? (o.expiresAt instanceof Date ? o.expiresAt.toISOString() : new Date(o.expiresAt).toISOString()) : null,
  };
}

router.get('/test', (req, res) => {
  res.status(200).send('chat router test ok');
});

router.use((req, res, next) => {
  if (req.path === '/test') return next();
  return authMiddleware(req, res, (err) => {
    if (err) return next(err);
    return requireFeatureEnabled('chat_enabled')(req, res, next);
  });
});

/** Admin inbox: distinct threads (by end-user) with last message preview. */
router.get('/threads', async (req, res, next) => {
  try {
    const role = req.user && req.user.role;
    if (!isStaffAdmin(role)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
    }

    const rows = await Message.aggregate([
      { $match: notExpiredMatch() },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$threadUserId',
          lastMessage: { $first: '$text' },
          lastAt: { $first: '$createdAt' },
          lastType: { $first: '$type' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isSeen', false] },
                    { $in: ['$senderRole', ['user', 'agent']] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: 300 },
    ]);

    const ids = rows.map((r) => r._id).filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    const users = await User.find({ _id: { $in: ids } })
      .select('name email')
      .lean();
    const byId = Object.fromEntries(users.map((u) => [String(u._id), u]));

    const threads = rows.map((r) => {
      const id = String(r._id);
      const u = byId[id];
      return {
        userId: id,
        userName: u && u.name ? u.name : 'User',
        userEmail: u && u.email ? u.email : '',
        lastMessage: r.lastMessage || '',
        lastAt: r.lastAt,
        lastType: r.lastType || 'text',
        unreadCount: Number(r.unreadCount || 0),
      };
    });

    return res.status(200).json({ threads });
  } catch (err) {
    return next(err);
  }
});

/** Mark incoming messages as read for the current viewer (user or admin). */
router.post('/read', async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const uid = String(req.user.userId);
    const role = req.user.role;

    let threadRoom;
    let query;

    if (isStaffAdmin(role)) {
      const tid = req.body.threadUserId != null ? String(req.body.threadUserId).trim() : '';
      if (!tid || !mongoose.Types.ObjectId.isValid(tid)) {
        return res.status(400).json({ message: 'Bad request', details: 'threadUserId required' });
      }
      threadRoom = tid;
      query = {
        $and: [
          { threadUserId: tid, senderRole: { $in: ['user', 'agent'] }, isSeen: false },
          notExpiredMatch(),
        ],
      };
    } else {
      threadRoom = uid;
      query = {
        $and: [
          { threadUserId: uid, senderRole: { $in: ['admin', 'agent'] }, isSeen: false },
          notExpiredMatch(),
        ],
      };
    }

    const docs = await Message.find(query).select('_id').lean();
    const messageIds = docs.map((d) => String(d._id));
    if (messageIds.length === 0) {
      return res.status(200).json({ ok: true, updated: 0, messageIds: [] });
    }

    const oids = messageIds.map((id) => new mongoose.Types.ObjectId(id));
    await Message.updateMany({ _id: { $in: oids } }, { $set: { isSeen: true, seenAt: new Date() } });

    if (io) {
      io.to(threadRoom).emit('messages_read', { threadUserId: threadRoom, messageIds });
    }

    return res.status(200).json({ ok: true, updated: messageIds.length, messageIds });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const uid = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!uid) return res.status(401).json({ message: 'Unauthorized' });

    let filter = {};
    if (isStaffAdmin(role)) {
      const tid = req.query.threadUserId;
      if (!tid || !mongoose.Types.ObjectId.isValid(String(tid))) {
        return res.status(200).json({ messages: [] });
      }
      filter = { threadUserId: String(tid) };
    } else {
      filter = { threadUserId: String(uid) };
    }

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const beforeId =
      req.query.beforeId && mongoose.Types.ObjectId.isValid(String(req.query.beforeId).trim())
        ? String(req.query.beforeId).trim()
        : null;

    const q = {
      $and: [filter, notExpiredMatch()],
    };
    if (beforeId) {
      q.$and.push({ _id: { $lt: new mongoose.Types.ObjectId(beforeId) } });
    }

    const batch = await Message.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    batch.reverse();

    const hasMore = batch.length === limit;
    const oldestId = batch.length ? String(batch[0]._id) : null;

    return res.status(200).json({
      messages: batch.map((m) => formatMessageDoc(m)),
      hasMore,
      oldestId,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const uid = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!uid) return res.status(401).json({ message: 'Unauthorized' });

    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';

    let threadUserId = String(uid);
    if (isStaffAdmin(role)) {
      const rawTid = req.body.threadUserId != null ? String(req.body.threadUserId).trim() : '';
      if (!rawTid || !mongoose.Types.ObjectId.isValid(rawTid)) {
        return res.status(400).json({ message: 'Bad request', details: 'threadUserId required for admin' });
      }
      threadUserId = rawTid;
    }

    const fileName = req.file ? req.file.filename : null;
    if (!text && !fileName) {
      return res.status(400).json({ message: 'Bad request', details: 'text or file required' });
    }

    const senderRole = isStaffAdmin(role) ? 'admin' : role === 'agent' ? 'agent' : 'user';
    const displayText =
      text || (fileName && req.file && req.file.originalname ? `[file] ${req.file.originalname}` : '[file]');

    const msgType = fileName ? inferMessageType(fileName) : 'text';
    const receiverId =
      isStaffAdmin(role) || role === 'agent' ? String(threadUserId) : 'support';

    const expiryDays = parseExpiryDays(req.body.expiryDays);
    const expiresAt = expiresAtFromDays(expiryDays);

    const msg = await Message.create({
      threadUserId,
      sender: String(uid),
      senderRole,
      receiverId,
      text: displayText,
      file: fileName,
      type: msgType,
      isDelivered: false,
      isSeen: false,
      expiresAt,
    });

    await Message.findByIdAndUpdate(msg._id, { isDelivered: true });
    const saved = await Message.findById(msg._id).lean();
    const payload = formatMessageDoc(saved);
    if (io && payload) {
      // Room name === thread user id (end customer). Same room user + admin join.
      io.to(String(threadUserId)).emit('receive_message', payload);
      // eslint-disable-next-line no-console
      console.log('[chat] socket event: receive_message (emit)', {
        messageId: payload.id,
        roomId: String(threadUserId),
        senderId: payload.senderId,
        receiverId: payload.receiverId,
        type: payload.type,
      });
    }

    const { notifyNewChatMessage } = require('../services/chatPushService');
    notifyNewChatMessage(saved).catch(() => {});

    if (senderRole === 'admin' || senderRole === 'agent') {
      const { createNotification } = require('../services/notificationService');
      createNotification({
        userId: threadUserId,
        role: 'user',
        title: senderRole === 'agent' ? 'New message from agent' : 'New message from support',
        message: displayText.slice(0, 500),
        type: 'chat',
        event: 'chat_reply',
      }).catch(() => {});
    }

    return res.status(201).json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.formatMessageDoc = formatMessageDoc;
module.exports.parseExpiryDays = parseExpiryDays;
module.exports.expiresAtFromDays = expiresAtFromDays;
module.exports.deriveMessageStatus = deriveMessageStatus;
