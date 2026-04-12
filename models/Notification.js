const mongoose = require("mongoose");

/**
 * In-app notifications.
 *
 * Core fields (requested): userId, title, message, isRead (alias → DB `read`), type, createdAt.
 * Extra fields keep `notificationService` / WhatsApp / dedupe working.
 */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Recipient role for routing / templates (existing flows). */
    role: { type: String, enum: ['user', 'agent', 'admin'], required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    /**
     * Stored as `read` in MongoDB; use `isRead` in JS (Mongoose alias).
     */
    read: { type: Boolean, default: false, index: true, alias: 'isRead' },
    type: {
      type: String,
      enum: [
        'wallet',
        'system',
        'agent',
        'order',
        'payment',
        'chat',
        'order_created',
        'payment_success',
        'order_in_progress',
        'order_completed',
        'admin_message',
      ],
      default: 'system',
      index: true,
    },
    /** Idempotency: same user + same key → one in-app row. */
    dedupeKey: { type: String, trim: true },
    channel: { type: String, enum: ['inApp', 'whatsapp'], default: 'inApp', index: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    failureReason: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $exists: true, $type: 'string', $gt: '' } },
  }
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
