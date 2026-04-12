import mongoose from 'mongoose';
import { AGENT_TYPES } from '../config/roles.config.js';

const agentTypeValues = [AGENT_TYPES.BASIC, AGENT_TYPES.PRO, AGENT_TYPES.BUSINESS];

const agentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },

    /** Optional link to login account when onboarding is tied to an existing User. */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true,
      unique: true,
    },

    location: {
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
    },

    education: {
      level: { type: String, trim: true, default: '' },
      field: { type: String, trim: true, default: '' },
    },

    workStatus: {
      type: String,
      enum: ['private', 'government', 'self-employed', 'student', 'unemployed'],
    },

    skills: [{ type: String, trim: true }],
    interests: [{ type: String, trim: true }],

    workType: {
      type: String,
      enum: ['part-time', 'full-time'],
    },

    experience: { type: String, trim: true, default: '' },

    preferredCategory: [{ type: String, trim: true }],

    documents: {
      aadhar: { type: String, trim: true, default: '' },
    },

    agentType: {
      type: String,
      enum: agentTypeValues,
      default: AGENT_TYPES.BASIC,
    },

    isBusinessPartner: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },

    approvedByAdmin: {
      type: Boolean,
      default: false,
    },

    subscription: {
      active: { type: Boolean, default: false },
      plan: { type: String, default: '', trim: true },
      expiresAt: { type: Date, default: null },
    },

    /** Admin: disable agent application / access without deleting the record. */
    isActive: { type: Boolean, default: true },

    /** Admin: allow or block taking new service work. */
    servicesEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

agentSchema.index({ status: 1, createdAt: -1 });
agentSchema.index({ phone: 1 });

/** Avoid "OverwriteModelError" under hot reload / repeated imports in dev. */
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;
