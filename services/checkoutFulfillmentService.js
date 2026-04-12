const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Service = require('../models/Service');
const CheckoutSession = require('../models/CheckoutSession');
const File = require('../modules/files/file.model');
const env = require('../config/env');
const { UPLOAD_ROOT, extToMime } = require('../modules/files/file.service');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // no-op
  }
}

function calculateSplit(totalPrice) {
  const total = Number(totalPrice || 0);
  const pct = Number(env.platformFeePercent || 0);
  const platformFee = Number((total * pct).toFixed(2));
  const agentEarning = Number((total - platformFee).toFixed(2));
  return { platformFee, agentEarning };
}

/**
 * Move files from checkout session into order storage and attach to order.documents.
 * @param {import('mongoose').Types.ObjectId} orderId
 * @param {string} userId
 * @param {Array<{ relativePath: string; originalName: string }>} fileEntries
 */
async function attachCheckoutFilesToOrder(orderId, userId, fileEntries) {
  const orderDir = path.join(UPLOAD_ROOT, 'orders', String(orderId));
  ensureDir(orderDir);
  const docs = [];
  for (const fe of fileEntries) {
    const rel = String(fe.relativePath || '').replace(/^\/+/, '').replace(/^local\/?/i, '');
    const src = path.join(UPLOAD_ROOT, ...rel.split('/'));
    if (!fs.existsSync(src)) continue;
    const base = path.basename(src);
    const dest = path.join(orderDir, base);
    try {
      fs.renameSync(src, dest);
    } catch (_e) {
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } catch (_e2) {
        continue;
      }
    }
    const storageRel = path.join('local', 'orders', String(orderId), base).replace(/\\/g, '/');
    const ext = path.extname(fe.originalName || base).toLowerCase();
    const doc = await File.create({
      userId,
      orderId,
      fileName: fe.originalName || base,
      fileUrl: storageRel,
      fileType: extToMime(ext),
      uploadedBy: 'user',
    });
    docs.push({
      fileId: doc._id,
      fileUrl: doc.fileUrl,
      fileName: doc.fileName,
      uploadedAt: new Date(),
    });
  }
  if (docs.length) {
    await Order.findByIdAndUpdate(
      orderId,
      { $push: { documents: { $each: docs } } },
      { runValidators: false }
    );
  }
  return docs.length;
}

/**
 * Create {@link Order} from a paid or paying checkout session and attach uploaded files.
 * Idempotent: if session already fulfilled, returns existing order id.
 */
async function fulfillCheckoutSession(sessionId, userId) {
  const sid = typeof sessionId === 'string' ? sessionId : String(sessionId);
  if (!mongoose.Types.ObjectId.isValid(sid)) {
    throw new Error('Invalid checkout session');
  }

  const existing = await CheckoutSession.findById(sid).lean();
  if (!existing) throw new Error('Checkout session not found');
  if (String(existing.user) !== String(userId)) {
    throw new Error('Forbidden');
  }
  if (existing.status === 'fulfilled' && existing.fulfilledOrderId) {
    const o = await Order.findById(existing.fulfilledOrderId);
    if (o) return o;
  }
  if (existing.status !== 'pending') {
    throw new Error('Checkout session is not payable');
  }
  if (!Array.isArray(existing.files) || existing.files.length === 0) {
    throw new Error('Checkout session has no documents');
  }

  const session = existing;

  const service = await Service.findById(session.service).lean();
  if (!service) throw new Error('Service not found');

  const orderController = require('../controllers/orderController');
  const orderFlags = orderController.buildOrderFlags(Number(session.totalPrice));

  const order = await Order.create({
    user: userId,
    service: session.service,
    requestType: 'standard',
    amount: Number(session.totalPrice),
    totalPrice: Number(session.totalPrice),
    finalCalculatedPrice: Number(session.finalCalculatedPrice ?? session.totalPrice),
    selectedService: String(session.service),
    idempotencyKey: `checkout_${sid}_${Date.now()}`,
    selectedOptions: {},
    filledFields: {},
    userInputs: {},
    status: 'pending_payment',
    paymentStatus: 'pending',
    paymentId: '',
    plan: session.plan || '',
    flags: orderFlags,
    ...(session.customerLocation?.lat != null && session.customerLocation?.lng != null
      ? { customerLocation: { lat: session.customerLocation.lat, lng: session.customerLocation.lng } }
      : {}),
    ...(session.preferredAgent ? { preferredAgent: session.preferredAgent } : {}),
    ...(session.assignedTo === 'admin' && !session.preferredAgent ? { assignedTo: 'admin' } : {}),
    deliverViaCourier: Boolean(session.courierSelected),
    courierFee: Math.max(0, Number(session.courierFee || 0)),
    ...calculateSplit(Number(session.totalPrice)),
  });

  await attachCheckoutFilesToOrder(order._id, userId, session.files);

  if (orderFlags.includes('high_value')) {
    await orderController.notifyHighValueOrderAlert(order._id, Number(session.totalPrice));
  }

  await CheckoutSession.findByIdAndUpdate(
    sid,
    {
      $set: {
        status: 'fulfilled',
        fulfilledOrderId: order._id,
      },
    },
    { runValidators: false }
  );

  return order;
}

module.exports = {
  fulfillCheckoutSession,
  attachCheckoutFilesToOrder,
  calculateSplit,
};
