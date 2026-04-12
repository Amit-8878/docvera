const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, index: true, unique: true },
    companyName: { type: String, default: '', trim: true },
    logoUrl: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },
    gstin: { type: String, default: '', trim: true },
    terms: { type: [String], default: [] },
    signatureUrl: { type: String, default: '', trim: true },
    stampUrl: { type: String, default: '', trim: true },
    footerNote: { type: String, default: '', trim: true },
    layout: {
      type: [String],
      default: () => [
        'logo',
        'company',
        'title',
        'customer',
        'table',
        'terms',
        'signature',
        'stamp',
        'footer',
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Template', templateSchema);
