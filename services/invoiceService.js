const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const env = require('../config/env');
const OrderModel = require('../models/Order');
const Template = require('../models/Template');
const { generateInvoiceHTML } = require('../utils/invoiceTemplate');
const { generatePDF } = require('../utils/pdfGenerator');

const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');
const INVOICE_DIR = path.join(UPLOADS_BASE, 'invoices');

function ensureInvoiceDir() {
  try {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
  } catch (_e) {
    // no-op
  }
}

function getPublicBaseUrl() {
  const raw =
    process.env.SERVER_URL ||
    process.env.PUBLIC_API_URL ||
    `http://127.0.0.1:${env.port}`;
  return String(raw).replace(/\/$/, '');
}

function resolveAssetUrl(base, u) {
  if (u == null) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const pathPart = s.startsWith('/') ? s : `/${s}`;
  return `${base}${pathPart}`;
}

function pickServiceName(populated) {
  if (populated.requestType === 'custom' && populated.customServiceName) {
    return String(populated.customServiceName).trim();
  }
  if (populated.service && typeof populated.service === 'object') {
    const n = populated.service.name;
    if (typeof n === 'string' && n.trim()) return n.trim();
    if (n && typeof n === 'object') {
      return String(n.en || n.hi || n.hinglish || '').trim() || 'Service';
    }
  }
  if (populated.selectedService && String(populated.selectedService).trim()) {
    return String(populated.selectedService).trim();
  }
  return 'Service';
}

function pickDescription(populated) {
  const c = populated.customDescription && String(populated.customDescription).trim();
  if (c) return c;
  const s = populated.selectedService && String(populated.selectedService).trim();
  if (s) return s;
  return '';
}

/**
 * @param {string} orderId
 * @returns {Promise<Buffer>}
 */
async function buildOrderInvoicePdfBuffer(orderId) {
  if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
    const e = new Error('Invalid order id');
    e.statusCode = 400;
    throw e;
  }
  const oid = String(orderId);
  const populated = await OrderModel.findById(oid)
    .populate('user', 'name email')
    .populate('service', 'name')
    .lean();
  if (!populated) {
    const e = new Error('Not found');
    e.statusCode = 404;
    throw e;
  }

  const user = populated.user && typeof populated.user === 'object' ? populated.user : null;
  const customerName = (user && (user.name || user.email)) || 'Customer';
  const customerEmail = (user && user.email) || '';

  const amount = Number(
    populated.finalCalculatedPrice ?? populated.totalPrice ?? populated.amount ?? 0
  );
  const amountLabel = `INR ${amount.toFixed(2)}`;

  const templateDoc = await Template.findOne({ type: 'invoice' }).lean();
  const tpl = templateDoc && typeof templateDoc === 'object' ? { ...templateDoc } : {};
  delete tpl._id;
  delete tpl.__v;
  delete tpl.createdAt;
  delete tpl.updatedAt;

  const base = getPublicBaseUrl();
  const resolvedTpl = {
    ...tpl,
    logoUrl: resolveAssetUrl(base, tpl.logoUrl),
    signatureUrl: resolveAssetUrl(base, tpl.signatureUrl),
    stampUrl: resolveAssetUrl(base, tpl.stampUrl),
  };

  const invoiceDate = populated.paidAt || populated.createdAt || new Date();
  const data = {
    orderId: oid,
    invoiceDate,
    customerName,
    customerEmail,
    serviceName: pickServiceName(populated),
    description: pickDescription(populated),
    amountLabel,
  };

  const html = generateInvoiceHTML(data, resolvedTpl);
  return generatePDF(html);
}

/**
 * Generate PDF once after payment is held; idempotent if invoicePdfPath already set.
 */
async function generateInvoiceForOrderIfNeeded(orderId) {
  if (!orderId) return null;
  const oid = String(orderId);
  const existing = await OrderModel.findById(oid).select('invoicePdfPath').lean();
  if (!existing) return null;
  if (existing.invoicePdfPath) return existing.invoicePdfPath;

  const buf = await buildOrderInvoicePdfBuffer(oid);
  ensureInvoiceDir();
  const safeId = oid.replace(/[^a-fA-F0-9]/g, '').slice(-12) || 'order';
  const filename = `inv_${safeId}_${Date.now()}.pdf`;
  const absPath = path.join(INVOICE_DIR, filename);
  const relPath = `invoices/${filename}`.replace(/\\/g, '/');
  fs.writeFileSync(absPath, buf);

  await OrderModel.findByIdAndUpdate(oid, { $set: { invoicePdfPath: relPath } }, { new: false, runValidators: false });
  return relPath;
}

module.exports = {
  generateInvoiceForOrderIfNeeded,
  buildOrderInvoicePdfBuffer,
  invoiceAbsolutePath(relPath) {
    if (!relPath || typeof relPath !== 'string') return null;
    const normalized = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
    return path.join(UPLOADS_BASE, ...normalized.split('/'));
  },
};
