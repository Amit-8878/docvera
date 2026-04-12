const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['user', 'agent', 'admin'], required: true },
    event: { type: String, required: true, trim: true, index: true },
    channel: { type: String, enum: ['in_app', 'whatsapp'], required: true, index: true },
    language: { type: String, enum: ['en', 'hi', 'hinglish'], default: 'en' },
    phone: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    status: { type: String, enum: ['sent', 'failed'], required: true, index: true },
    error: { type: String, default: '', trim: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationLog', notificationLogSchema);

