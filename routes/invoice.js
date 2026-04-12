const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/authMiddleware');
const Order = require('../models/Order');
const { buildOrderInvoicePdfBuffer } = require('../services/invoiceService');

const router = express.Router();

router.get('/:orderId', authMiddleware, async (req, res, next) => {
  const id = req.params.orderId != null ? String(req.params.orderId).trim() : '';
  const uid = req.user?.userId;
  const role = req.user?.role;
  if (!uid) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Bad request', details: 'Invalid order id' });
  }
  try {
    const order = await Order.findById(id).select('user').lean();
    if (!order) {
      return res.status(404).json({ message: 'Not found' });
    }
    if (role !== 'admin' && role !== 'super_admin' && String(order.user) !== String(uid)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const buf = await buildOrderInvoicePdfBuffer(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`);
    return res.send(Buffer.from(buf));
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message || 'Error' });
    }
    return next(err);
  }
});

module.exports = router;
