const mongoose = require('mongoose');

/** Lightweight order requests (separate from the main Order workflow). */
const simpleOrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceName: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending', index: true },
    /** Public URLs or paths under /uploads/simple-orders */
    files: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SimpleOrder', simpleOrderSchema);
