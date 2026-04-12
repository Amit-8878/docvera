const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, default: '', trim: true },
    phoneMasked: { type: String, default: '', trim: true },
    text: { type: String, required: true, trim: true },
    /** Normalized text for duplicate checks */
    textNorm: { type: String, default: '', index: true },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    type: { type: String, enum: ['positive', 'negative'], default: 'positive' },
    source: { type: String, enum: ['admin', 'ai', 'user'], default: 'ai' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ source: 1, status: 1 });

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);
