const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, unique: true, trim: true },
    messages: {
      en: { type: String, default: '', trim: true },
      hi: { type: String, default: '', trim: true },
      hinglish: { type: String, default: '', trim: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationTemplate', templateSchema);

