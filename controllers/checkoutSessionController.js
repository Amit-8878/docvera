const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const CheckoutSession = require('../models/CheckoutSession');
const Service = require('../models/Service');
const { UPLOAD_ROOT } = require('../modules/files/file.service');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // no-op
  }
}

const CHECKOUT_TTL_MS = 60 * 60 * 1000; // 1 hour

function parseBool(v) {
  if (v === true || v === 1) return true;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/**
 * Base INR for simple checkout (tier + discount; courier added separately).
 */
function computeCheckoutServiceSubtotal(service, body) {
  let basePrice = service.basePrice != null ? Number(service.basePrice) : 0;
  if (basePrice === 0 && service.price != null) basePrice = Number(service.price);

  const tierRaw = typeof body.tier === 'string' ? body.tier.trim().toLowerCase() : '';
  if (tierRaw === 'basic' || tierRaw === 'standard' || tierRaw === 'premium') {
    const tierKey = `price${tierRaw.charAt(0).toUpperCase()}${tierRaw.slice(1)}`;
    const tierPrice =
      service[tierKey] != null && !Number.isNaN(Number(service[tierKey])) ? Number(service[tierKey]) : 0;
    if (tierPrice > 0) basePrice = tierPrice;
  }

  let subtotal = Math.max(0, Number(basePrice) || 0);
  const disc = Number(service.discountPercent || 0);
  if (disc > 0 && disc <= 100) {
    subtotal = (subtotal * (100 - disc)) / 100;
    subtotal = Math.round(subtotal * 100) / 100;
  }
  return subtotal;
}

/**
 * POST /api/checkout/session — multipart `documents` (required), JSON fields in body.
 * Does NOT create an Order; payment must succeed first.
 */
async function postCheckoutSession(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const uploaded = Array.isArray(req.files) ? req.files : [];
    const valid = uploaded.filter((f) => f && f.size > 0);
    if (!valid.length) {
      return res.status(400).json({ message: 'Bad request', details: 'Document required' });
    }

    const serviceId =
      typeof req.body.serviceId === 'string' ? req.body.serviceId.trim() : String(req.body.serviceId || '').trim();
    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: 'Bad request', details: 'serviceId is required' });
    }

    const service = await Service.findById(serviceId).lean();
    if (!service) {
      return res.status(404).json({ message: 'Not found', details: 'Service not found' });
    }
    if (service.isActive === false) {
      return res.status(400).json({ message: 'Bad request', details: 'Service is not available' });
    }

    const baseAmount = computeCheckoutServiceSubtotal(service, req.body);

    const courierEnabled = Boolean(service.courierEnabled);
    const configuredCourierFee = courierEnabled ? Math.max(0, Number(service.courierFee || 0)) : 0;
    const deliverViaCourier = parseBool(req.body.deliverViaCourier);
    if (deliverViaCourier && !courierEnabled) {
      return res.status(400).json({
        message: 'Bad request',
        details: 'Courier delivery is not available for this service',
      });
    }
    const courierAdd = deliverViaCourier ? configuredCourierFee : 0;
    const totalPrice = Math.round((baseAmount + courierAdd) * 100) / 100;

    const orderController = require('./orderController');
    const customerLocation = orderController.parseCustomerLocation(req.body);
    const preferredAgentId = orderController.parsePreferredAgentId(req.body);
    const assignedToClient = orderController.parseAssignedToFromBody(req.body);
    const assignedToEarly =
      assignedToClient === 'admin' && !preferredAgentId ? 'admin' : '';

    let plan = '';
    const tr = typeof req.body.tier === 'string' ? req.body.tier.trim().toLowerCase() : '';
    if (['basic', 'standard', 'premium'].includes(tr)) plan = tr;

    const sessionId = new mongoose.Types.ObjectId();
    const destDir = path.join(UPLOAD_ROOT, 'checkout', String(sessionId));
    ensureDir(destDir);

    const files = [];
    for (const f of valid) {
      const base = path.basename(f.path);
      const dest = path.join(destDir, base);
      try {
        fs.renameSync(f.path, dest);
      } catch (_e) {
        try {
          fs.copyFileSync(f.path, dest);
          fs.unlinkSync(f.path);
        } catch (_e2) {
          return res.status(500).json({ message: 'Failed to store upload' });
        }
      }
      files.push({
        relativePath: path.join('checkout', String(sessionId), base).replace(/\\/g, '/'),
        originalName: f.originalname || base,
      });
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);

    await CheckoutSession.create({
      _id: sessionId,
      user: userId,
      service: service._id,
      totalPrice,
      finalCalculatedPrice: totalPrice,
      courierSelected: deliverViaCourier,
      courierFee: courierAdd,
      plan,
      ...(preferredAgentId ? { preferredAgent: preferredAgentId } : {}),
      ...(assignedToEarly ? { assignedTo: assignedToEarly } : {}),
      ...(customerLocation ? { customerLocation } : {}),
      files,
      status: 'pending',
      expiresAt,
    });

    return res.status(201).json({
      success: true,
      checkoutSessionId: String(sessionId),
      amount: totalPrice,
      baseAmount,
      courierFee: courierAdd,
      courierSelected: deliverViaCourier,
      amountPaise: Math.round(totalPrice * 100),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  postCheckoutSession,
};
