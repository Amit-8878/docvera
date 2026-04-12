const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true },
    stack: { type: String, default: '' },
    route: { type: String, default: '', index: true },
    method: { type: String, default: '' },
    httpStatus: { type: Number, default: 500 },
    /** pending | fixed | dismissed */
    status: {
      type: String,
      enum: ['pending', 'fixed', 'dismissed'],
      default: 'pending',
      index: true,
    },
    /** Parsed hint from stack (best-effort). */
    fileHint: { type: String, default: '' },
    lineHint: { type: Number, default: null },
    requestId: { type: String, default: '', index: true },
    /** Simple Hindi explanation from AI. */
    aiExplanationHi: { type: String, default: '' },
    /** Human-readable fix steps (Hinglish/English). */
    aiFixSuggestion: { type: String, default: '' },
    aiAnalyzedAt: { type: Date, default: null },
    /** Last safe remediation label (no code changes). */
    lastSafeAction: { type: String, default: '' },
  },
  { timestamps: true }
);

errorLogSchema.index({ createdAt: -1 });
errorLogSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ErrorLog', errorLogSchema);
