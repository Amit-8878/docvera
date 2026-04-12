const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const Message = require('../models/Message');
const { formatMessageDoc, parseExpiryDays, expiresAtFromDays } = require('../routes/chatRoutes');

/** userId -> number of connected sockets (tabs). */
const onlineCount = new Map();

function bumpOnline(io, userId, role, delta) {
  const n = (onlineCount.get(userId) || 0) + delta;
  if (n <= 0) {
    onlineCount.delete(userId);
    io.to(userId).emit('presence', {
      threadUserId: userId,
      userId,
      role,
      online: false,
    });
  } else {
    onlineCount.set(userId, n);
    if (delta > 0 && n === 1) {
      io.to(userId).emit('presence', {
        threadUserId: userId,
        userId,
        role,
        online: true,
      });
    }
  }
}

/**
 * Realtime chat: authenticated sockets, per-thread rooms, typing.
 * Persisted messages are emitted from POST /api/chat only (no duplicate relay).
 */
function attachChatSocket(io) {
  io.use((socket, next) => {
    const token =
      socket.handshake.auth && socket.handshake.auth.token
        ? socket.handshake.auth.token
        : socket.handshake.query && socket.handshake.query.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('Unauthorized'));
    }
    try {
      const decoded = jwt.verify(token, env.jwtSecret);
      if (decoded.typ === 'refresh') {
        return next(new Error('Unauthorized'));
      }
      socket.userId = String(decoded.id);
      socket.userRole = decoded.role || 'user';
      return next();
    } catch (_e) {
      return next(new Error('Unauthorized'));
    }
  });

  io.use(async (socket, next) => {
    try {
      const { getBooleanSetting } = require('../services/systemSettingsService');
      const ok = await getBooleanSetting('chat_enabled', true);
      const r = socket.userRole;
      if (ok || r === 'admin' || r === 'super_admin') {
        return next();
      }
      return next(new Error('Chat disabled'));
    } catch (e) {
      return next(e);
    }
  });

  io.on('connection', (socket) => {
    // Room id === end-user id (thread key). User + admin chatting about that user join this same room.
    socket.join(socket.userId);
    if (socket.userRole === 'admin' || socket.userRole === 'super_admin' || socket.userRole === 'agent') {
      socket.join('orders:staff');
    }
    bumpOnline(io, socket.userId, socket.userRole, 1);
    // eslint-disable-next-line no-console
    console.log('[chat] socket event: connection', { socketId: socket.id, userId: socket.userId, role: socket.userRole });

    socket.on('join_thread', (payload) => {
      const threadUserId =
        payload && typeof payload.threadUserId === 'string' ? payload.threadUserId.trim() : '';
      if (!threadUserId) return;
      socket.join(threadUserId);
      socket.to(threadUserId).emit('presence', {
        threadUserId,
        userId: socket.userId,
        role: socket.userRole,
        online: true,
      });
      // eslint-disable-next-line no-console
      console.log('[chat] join_thread', { socketId: socket.id, roomId: threadUserId });
    });

    socket.on('leave_thread', (payload) => {
      const threadUserId =
        payload && typeof payload.threadUserId === 'string' ? payload.threadUserId.trim() : '';
      if (!threadUserId) return;
      socket.to(threadUserId).emit('presence', {
        threadUserId,
        userId: socket.userId,
        role: socket.userRole,
        online: false,
      });
      socket.leave(threadUserId);
      // eslint-disable-next-line no-console
      console.log('[chat] leave_thread', { socketId: socket.id, roomId: threadUserId });
    });

    socket.on('typing', (payload) => {
      const threadUserId =
        payload && typeof payload.threadUserId === 'string' ? payload.threadUserId.trim() : '';
      if (!threadUserId) return;
      const typing = !!(payload && payload.typing);
      socket.to(threadUserId).emit('typing', {
        threadUserId,
        typing,
        userId: socket.userId,
        role: socket.userRole,
      });
      // eslint-disable-next-line no-console
      console.log('[chat] socket event: typing', { threadUserId, typing, role: socket.userRole });
    });

    /** Text-only messages: persist + realtime (files still use POST /api/chat). */
    socket.on('send_message', async (raw) => {
      const data = raw && typeof raw === 'object' ? raw : {};
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      const clientMsgId = typeof data.clientMsgId === 'string' ? data.clientMsgId : '';
      // eslint-disable-next-line no-console
      console.log('[chat] socket event: send_message', { len: text.length, clientMsgId: !!clientMsgId });

      if (!text || text.length > 8000) {
        return socket.emit('chat_error', { clientMsgId, message: 'Invalid message' });
      }

      const uid = socket.userId;
      const role = socket.userRole;
      let threadUserId = uid;
      if (role === 'admin' || role === 'super_admin') {
        const tid = data.threadUserId != null ? String(data.threadUserId).trim() : '';
        if (!tid || !mongoose.Types.ObjectId.isValid(tid)) {
          return socket.emit('chat_error', { clientMsgId, message: 'threadUserId required for admin' });
        }
        threadUserId = tid;
      }

      try {
        const senderRole =
          role === 'admin' || role === 'super_admin' ? 'admin' : role === 'agent' ? 'agent' : 'user';
        const receiverId =
          role === 'admin' || role === 'super_admin' || role === 'agent' ? String(threadUserId) : 'support';
        const expiryDays = parseExpiryDays(data.expiryDays);
        const expiresAt = expiresAtFromDays(expiryDays);

        const msg = await Message.create({
          threadUserId,
          sender: String(uid),
          senderRole,
          receiverId,
          text,
          file: null,
          type: 'text',
          isDelivered: false,
          isSeen: false,
          expiresAt,
        });

        await Message.findByIdAndUpdate(msg._id, { isDelivered: true });
        const saved = await Message.findById(msg._id).lean();
        const payload = formatMessageDoc(saved);
        const out = { ...payload, clientMsgId };

        /** Deliver to everyone in the thread room except this socket (same tab gets `message_sent`). */
        socket.to(String(threadUserId)).emit('receive_message', payload);
        socket.emit('message_sent', out);

        const { notifyNewChatMessage } = require('../services/chatPushService');
        notifyNewChatMessage(saved).catch(() => {});

        if (senderRole === 'admin' || senderRole === 'agent') {
          const { createNotification } = require('../services/notificationService');
          createNotification({
            userId: threadUserId,
            role: 'user',
            title: senderRole === 'agent' ? 'New message from agent' : 'New message from support',
            message: text.slice(0, 500),
            type: 'chat',
            event: 'chat_reply',
          }).catch(() => {});
        }
        /** Same payload shape as receive_message — clients use `status` / isDelivered; no extra `message_delivered` event (avoids duplicate pushes). */
      } catch (err) {
        const message = err && err.message ? String(err.message) : 'Send failed';
        socket.emit('chat_error', { clientMsgId, message });
      }
    });

    /** Mark one message as read (same DB fields as POST /chat/read). Emits `message_seen` with same shape as `messages_read`. */
    socket.on('mark_seen', async (raw) => {
      const data = raw && typeof raw === 'object' ? raw : {};
      const messageId =
        typeof data.messageId === 'string'
          ? data.messageId.trim()
          : typeof raw === 'string'
            ? raw.trim()
            : '';
      if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) return;

      const uid = socket.userId;
      const role = socket.userRole;

      try {
        const msg = await Message.findById(messageId).lean();
        if (!msg) return;

        const threadRoom = String(msg.threadUserId);

        if (role === 'admin' || role === 'super_admin' || role === 'agent') {
          const tid = data.threadUserId != null ? String(data.threadUserId).trim() : '';
          if (!tid || tid !== threadRoom || !mongoose.Types.ObjectId.isValid(tid)) return;
          const fromEndUser = msg.senderRole === 'user' || msg.senderRole === 'agent';
          if (!fromEndUser || String(msg.sender) === uid) return;
        } else {
          if (threadRoom !== uid) return;
          const fromSupport = msg.senderRole === 'admin' || msg.senderRole === 'agent';
          if (!fromSupport) return;
        }

        await Message.findByIdAndUpdate(messageId, {
          $set: { isSeen: true, seenAt: new Date(), isDelivered: true },
        });

        io.to(threadRoom).emit('message_seen', {
          threadUserId: threadRoom,
          messageIds: [String(messageId)],
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[chat] mark_seen failed', err && err.message ? err.message : err);
      }
    });

    socket.on('disconnect', (reason) => {
      bumpOnline(io, socket.userId, socket.userRole, -1);
      // eslint-disable-next-line no-console
      console.log('[chat] socket event: disconnect', { socketId: socket.id, reason });
    });
  });
}

module.exports = { attachChatSocket };
