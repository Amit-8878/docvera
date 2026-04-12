const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Standard orders reference a catalog service; custom requests use the placeholder service + `requestType: custom`. */
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    /** `standard` (default) vs user-initiated `custom` when service not in catalog. */
    requestType: {
      type: String,
      enum: ['standard', 'custom'],
      default: 'standard',
      index: true,
    },
    customServiceName: { type: String, default: '', trim: true },
    customDescription: { type: String, default: '', trim: true },
    customPriority: { type: String, enum: ['normal', 'urgent'], default: 'normal' },
    /** Optional browse context from services flow (category / industry slugs). */
    customBrowseContext: {
      category: { type: String, default: '' },
      industry: { type: String, default: '' },
    },
    /** Optional client GPS at placement (nearest-agent auto-assign). No map APIs — browser geolocation only. */
    customerLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /**
     * Who fulfills the order: `'admin'` (internal / admin queue) or a string agent ObjectId after assignment.
     * Mirrors `agent` ref when set to an agent; use `'admin'` when no field agent (handled by staff).
     */
    assignedTo: { type: String, default: '', trim: true, index: true },
    /** Optional user-chosen agent before auto-assign (cleared after successful assignment). */
    preferredAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /**
     * After assign: pending until agent accepts. Legacy orders without this field are treated as accepted.
     * Reject → declined (then cleared) or use status none after unassign.
     */
    agentResponseStatus: {
      type: String,
      enum: ['none', 'pending', 'accepted', 'declined'],
      default: 'none',
    },

    // Compatibility field (used by existing UI + payment flow).
    // Always set equal to `totalPrice`.
    amount: { type: Number, required: true, min: 0 },

    // Dynamic order fields:
    selectedService: { type: String, default: '', trim: true },
    idempotencyKey: { type: String, default: '', trim: true, index: true },
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    totalPrice: { type: Number, required: true, min: 0 },
    // Advanced dynamic engine fields:
    filledFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    finalCalculatedPrice: { type: Number, default: 0, min: 0 },
    /** Courier add-on at checkout (physical delivery). */
    deliverViaCourier: { type: Boolean, default: false },
    courierFee: { type: Number, default: 0, min: 0 },
    userInputs: { type: mongoose.Schema.Types.Mixed, default: {} },

    /** INR deducted from user wallet toward this order (partial or full). */
    walletAmountUsed: { type: Number, default: 0, min: 0 },
    /** INR deducted from promo balance toward this order (full order from promo). */
    promoAmountUsed: { type: Number, default: 0, min: 0 },
    /** Mirrors walletAmountUsed (same INR); kept for API clarity. */
    walletUsed: { type: Number, default: 0, min: 0 },
    /** INR still to be collected via gateway after wallet is applied. */
    onlinePaid: { type: Number, default: 0, min: 0 },
    paymentId: { type: String, default: '', trim: true },
    /** True after successful payment capture (held/released); mirrors paymentStatus for clients. */
    paid: { type: Boolean, default: false },
    /** Dev/demo: payment was applied without a real gateway (see paymentSimulationService). */
    simulatedPayment: { type: Boolean, default: false },
    /** Set once when payment is captured (held); used for finance reporting (no duplicate revenue). */
    paidAt: { type: Date, default: null, index: true },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'pending', 'paid', 'held', 'released', 'refunded'],
      default: 'pending',
    },
    agentEarning: { type: Number, default: 0, min: 0 },
    platformFee: { type: Number, default: 0, min: 0 },
    proofFiles: {
      type: [
        new mongoose.Schema(
          {
            fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
            fileUrl: { type: String, default: '', trim: true },
            fileName: { type: String, default: '', trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /** Final deliverables (admin/agent upload via complete-order flow). */
    resultFiles: {
      type: [
        new mongoose.Schema(
          {
            fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
            fileUrl: { type: String, default: '', trim: true },
            fileName: { type: String, default: '', trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /** User-uploaded supporting documents (separate from agent proofFiles). */
    documents: {
      type: [
        new mongoose.Schema(
          {
            fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
            fileUrl: { type: String, default: '', trim: true },
            fileName: { type: String, default: '', trim: true },
            uploadedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    completionNote: { type: String, default: '', trim: true },
    completionSubmittedAt: { type: Date, default: null },
    /** When order reached "completed" with result (admin/agent complete flow). */
    completedAt: { type: Date, default: null },
    userConfirmationStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'issue_raised'],
      default: 'pending',
    },
    userRating: { type: Number, default: 0, min: 0, max: 5 },
    userReview: { type: String, default: '', trim: true },
    ratedAt: { type: Date, default: null },
    issueRaised: { type: Boolean, default: false },
    adminReviewRequired: { type: Boolean, default: false },
    /** Internal admin notes (not shown to end users in notifications by default). */
    adminRemarks: { type: String, default: '', trim: true },
    /** Ops priority for admin queue (separate from custom request urgency). */
    adminPriority: { type: String, enum: ['normal', 'high', 'urgent'], default: 'normal' },
    status: {
      type: String,
      enum: ['pending_payment', 'pending', 'paid', 'assigned', 'processing', 'completed', 'cancelled', 'failed'],
      default: 'pending_payment',
    },
    /** Service tier / plan (basic | standard | premium) when tier pricing is used. */
    plan: { type: String, enum: ['', 'basic', 'standard', 'premium'], default: '' },
    /** Relative path under server/uploads/ (e.g. invoices/inv_xxx.pdf); served as /uploads/... */
    invoicePdfPath: { type: String, default: '', trim: true },
    /** Primary delivery download URL (mirrors first result file or explicit link). */
    deliveryFile: { type: String, default: '', trim: true },
    /** Risk / ops flags (e.g. high_value). */
    flags: { type: [String], default: [] },
    /** Set when an agent is assigned (acceptance timeout / reassignment). */
    agentAssignedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ agent: 1, createdAt: -1 });

orderSchema.pre('validate', function orderServiceRequired() {
  const rt = this.requestType || 'standard';
  if (rt === 'custom') {
    return;
  }
  if (!this.service) {
    this.invalidate('service', 'Service is required for standard orders');
  }
});

module.exports = mongoose.model('Order', orderSchema);
