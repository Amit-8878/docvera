/**
 * User document uploads on orders and invoice PDF resolution for download.
 */
const mongoose = require('mongoose');
const Order = require('../../../../models/Order');
const { bad, good, formatOrder } = require('../orderQueryService');

async function uploadOrderDocuments(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const orderIdRaw = req.body && req.body.orderId != null ? String(req.body.orderId).trim() : '';
  if (!orderIdRaw || !mongoose.Types.ObjectId.isValid(orderIdRaw)) {
    return bad(400, { message: 'Bad request', details: 'orderId is required' });
  }

  const order = await Order.findById(orderIdRaw).lean();
  if (!order) {
    return bad(404, { message: 'Not found' });
  }
  if (String(order.user) !== String(userId)) {
    return bad(403, { message: 'Forbidden' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    return bad(400, { message: 'Bad request', details: 'No files uploaded' });
  }

  const fileSvc = require('../../../files/file.service');
  const newDocs = await fileSvc.registerUserDocuments(orderIdRaw, userId, files);

  await Order.findByIdAndUpdate(
    orderIdRaw,
    { $push: { documents: { $each: newDocs } } },
    { new: false, runValidators: false }
  );

  const populated = await Order.findById(orderIdRaw).populate('service', 'name').lean();
  const formatted = formatOrder(populated);
  return good(200, formatted, { socketOrderUpdate: formatted });
}

async function getInvoicePdfForDownload(req) {
  const { id } = req.params;
  const uid = req.user?.userId;
  const role = req.user?.role;
  if (!uid) return bad(401, { message: 'Unauthorized' });
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }
  const order = await Order.findById(id).select('user').lean();
  if (!order) return bad(404, { message: 'Not found' });
  if (role !== 'admin' && role !== 'super_admin' && String(order.user) !== String(uid)) {
    return bad(403, { message: 'Forbidden' });
  }
  const { buildOrderInvoicePdfBuffer } = require('../../../../services/invoiceService');
  try {
    const pdfBuffer = await buildOrderInvoicePdfBuffer(id);
    return { ok: true, pdfBuffer, downloadName: `invoice-${id}.pdf` };
  } catch (err) {
    if (err && err.statusCode === 404) {
      return bad(404, { message: 'Not found' });
    }
    throw err;
  }
}

module.exports = {
  uploadOrderDocuments,
  getInvoicePdfForDownload,
};
