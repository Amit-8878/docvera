const mongoose = require('mongoose');

/**
 * Canonical storage under server/uploads/local/ — fileUrl holds path relative to server/uploads/
 * (e.g. local/orders/<orderId>/<filename>). Served only via authenticated GET .../download.
 */
const fileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    fileType: { type: String, default: '', trim: true },
    uploadedBy: { type: String, enum: ['user', 'agent', 'admin'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

fileSchema.index({ orderId: 1, createdAt: -1 });

module.exports = mongoose.model('File', fileSchema);
