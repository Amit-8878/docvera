const mongoose = require('mongoose');

/** User ↔ admin support thread: keyed by end-user id (`threadUserId`). */
const messageSchema = new mongoose.Schema(
  {
    threadUserId: { type: String, required: true, trim: true },
    sender: { type: String, required: true, trim: true },
    senderRole: { type: String, enum: ['user', 'admin', 'agent'], default: 'user' },
    /** Intended recipient: e.g. end-user id when admin replies, or `support` when user writes. */
    receiverId: { type: String, default: null, trim: true },
    text: { type: String, default: '', trim: true },
    /** Stored filename under uploads/chat/ (null if text-only). */
    file: { type: String, default: null, trim: true },
    type: {
      type: String,
      enum: ['text', 'image', 'audio', 'file'],
      default: 'text',
    },
    /** Recipient has opened chat / read (WhatsApp blue ticks). */
    isSeen: { type: Boolean, default: false },
    /** Delivered to server + broadcast to thread (double tick gray). */
    isDelivered: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
    /** When set, message is removed after this time (hourly job). */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ threadUserId: 1, createdAt: -1 });
messageSchema.index({ expiresAt: 1 }, { sparse: true });

module.exports = mongoose.model('Message', messageSchema);
