const mongoose = require('mongoose');
const SimpleOrder = require('../models/SimpleOrder');

function format(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const id = o._id ? String(o._id) : String(o.id);
  if (o._id) delete o._id;
  if (o.__v !== undefined) delete o.__v;
  return {
    id,
    userId: o.userId ? String(o.userId) : null,
    serviceName: o.serviceName,
    description: o.description || '',
    status: o.status,
    files: Array.isArray(o.files) ? o.files : [],
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function create(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const serviceName = typeof req.body.serviceName === 'string' ? req.body.serviceName.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (!serviceName) {
      return res.status(400).json({ message: 'Bad request', details: 'serviceName is required' });
    }

    const uploaded = Array.isArray(req.files) ? req.files : [];
    const valid = uploaded.filter((f) => f && f.size > 0);
    if (!valid.length) {
      return res.status(400).json({ message: 'Bad request', details: 'Document required' });
    }
    const files = valid.map((f) => `/uploads/simple-orders/${f.filename}`);

    const doc = await SimpleOrder.create({
      userId,
      serviceName,
      description,
      status: 'pending',
      files,
    });

    return res.status(201).json(format(doc));
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const filter = role === 'admin' ? {} : { userId };
    const orders = await SimpleOrder.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.status(200).json({ orders: orders.map((o) => format(o)) });
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    const role = req.user && req.user.role;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }

    const doc = await SimpleOrder.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });

    if (role !== 'admin' && String(doc.userId) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json(format(doc));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  create,
  list,
  getOne,
};
