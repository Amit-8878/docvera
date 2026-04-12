const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['checkbox', 'radio'], required: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const deliveryOptionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['soft_copy', 'hard_copy', 'courier'],
      required: true,
    },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const priceRuleSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const requiredFieldSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    labelI18n: {
      en: { type: String, trim: true, default: '' },
      hi: { type: String, trim: true, default: '' },
      hinglish: { type: String, trim: true, default: '' },
    },
    type: { type: String, enum: ['text', 'number', 'date', 'file'], required: true },
  },
  { _id: false }
);

const conditionalFieldSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    labelI18n: {
      en: { type: String, trim: true, default: '' },
      hi: { type: String, trim: true, default: '' },
      hinglish: { type: String, trim: true, default: '' },
    },
    type: { type: String, enum: ['text', 'number', 'date', 'file'], required: true },
  },
  { _id: false }
);

const conditionalRuleSchema = new mongoose.Schema(
  {
    dependsOn: { type: String, required: true, trim: true },
    fields: { type: [conditionalFieldSchema], default: [] },
  },
  { _id: false }
);

// strict: false keeps legacy fields (like `price`, `category`) available for mapping/migration.
const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /** High-level browse bucket (government | private | personal). Legacy rows may rely on `category` only. */
    catalogCategory: {
      type: String,
      enum: ['government', 'private', 'personal'],
      default: 'personal',
      index: true,
    },
    /** Industry slug within the bucket, e.g. banking, id-services (optional). */
    industry: { type: String, default: '', trim: true, index: true },
    nameI18n: {
      en: { type: String, trim: true, default: '' },
      hi: { type: String, trim: true, default: '' },
      hinglish: { type: String, trim: true, default: '' },
    },
    category: { type: String, default: 'Personal', trim: true },
    subCategory: { type: String, default: '', trim: true },
    // New dynamic pricing config:
    basePrice: { type: Number, default: 0, min: 0 },
    pricingType: {
      type: String,
      enum: ['fixed', 'per_page', 'custom'],
      default: 'fixed',
    },
    options: { type: [optionSchema], default: [] },
    priceRules: { type: [priceRuleSchema], default: [] },
    deliveryOptions: { type: [deliveryOptionSchema], default: [] },
    // Admin-configured list of document types a user can choose from (e.g. "Aadhar", "PAN", "Passport").
    documentTypes: { type: [String], default: [] },
    turnaroundTime: { type: String, default: '', trim: true },
    requiredFields: { type: [requiredFieldSchema], default: [] },
    conditionalFields: { type: [conditionalRuleSchema], default: [] },
    description: { type: String, default: '', trim: true },
    descriptionI18n: {
      en: { type: String, trim: true, default: '' },
      hi: { type: String, trim: true, default: '' },
      hinglish: { type: String, trim: true, default: '' },
    },

    /** Display title (falls back to name / nameI18n in API map). */
    title: { type: String, default: '', trim: true },
    /** Hero image URL (relative /uploads/... or absolute). */
    imageUrl: { type: String, default: '', trim: true },
    /** Icon image URL (small thumbnail / badge for lists). */
    icon: { type: String, default: '', trim: true },
    /** Tiered catalog pricing (INR). When set, order flow can use `serviceTier` basic|standard|premium. */
    priceBasic: { type: Number, default: 0, min: 0 },
    priceStandard: { type: Number, default: 0, min: 0 },
    pricePremium: { type: Number, default: 0, min: 0 },
    featuresBasic: { type: [String], default: [] },
    featuresStandard: { type: [String], default: [] },
    featuresPremium: { type: [String], default: [] },
    deliveryTimeBasic: { type: String, default: '', trim: true },
    deliveryTimeStandard: { type: String, default: '', trim: true },
    deliveryTimePremium: { type: String, default: '', trim: true },
    /** Single display delivery label when tiers not used. */
    deliveryTime: { type: String, default: '', trim: true },

    // Legacy fields (may exist in existing DB docs):
    price: { type: Number, min: 0 },

    // Service catalog controls (smart engine); `active` mirrors `isActive` for API clarity
    isActive: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    processingTime: { type: String, default: '', trim: true },
    requiredDocuments: { type: [String], default: [] },
    /** Optional tags for search (e.g. pan, aadhaar, passport). */
    searchKeywords: { type: [String], default: [] },
    /** When true, hidden from public browse lists (e.g. internal placeholder for custom orders). */
    excludeFromBrowse: { type: Boolean, default: false, index: true },
    /** Promotional discount 0–100% applied to displayed / checkout price (admin-controlled). */
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    /** Optional physical courier add-on at checkout (INR). */
    courierEnabled: { type: Boolean, default: false },
    courierFee: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model('Service', serviceSchema);
