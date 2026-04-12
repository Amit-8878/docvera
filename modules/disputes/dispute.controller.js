const mongoose = require('mongoose');
const Dispute = require('./dispute.model');
const Order = require('../../models/Order');
const {
  createDisputeForOrder,
  applyDisputeResolutionToOrder,
} = require('./dispute.service');
const { formatOrder } = require('../../controllers/orderController');

const ALLOWED_STATUS = ['open', 'in_review', 'resolved', 'rejected'];
const RESOLUTION_ACTIONS = ['release_payment', 'refund', 'reassign_agent'];

function refId(ref) {
  if (!ref) return null;
  if (typeof ref === 'object' && ref._id) return String(ref._id);
  return String(ref);
}

function formatDispute(doc) {
  if (!doc) return null;
  const d = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const id = d._id;
  delete d._id;
  delete d.__v;

  const out = {
    id: id ? String(id) : null,
    orderId: refId(d.orderId),
    userId: refId(d.userId),
    agentId: refId(d.agentId),
    reason: d.reason || '',
    message: d.message || '',
    proofFiles: Array.isArray(d.proofFiles) ? d.proofFiles : [],
    status: d.status,
    adminResponse: d.adminResponse || '',
    resolutionAction: d.resolutionAction || '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };

  if (d.orderId && typeof d.orderId === 'object' && d.orderId._id) {
    out.order = {
      orderId: String(d.orderId._id),
      status: d.orderId.status,
      paymentStatus: d.orderId.paymentStatus,
      totalPrice: d.orderId.totalPrice,
    };
  }
  if (d.userId && typeof d.userId === 'object' && d.userId._id) {
    out.user = {
      name: d.userId.name || '',
      email: d.userId.email || '',
      phone: d.userId.phone || '',
    };
  }
  if (d.agentId && typeof d.agentId === 'object' && d.agentId._id) {
    out.agent = {
      shopName: d.agentId.shopName || '',
      phone: d.agentId.phone || '',
      city: d.agentId.city || '',
      state: d.agentId.state || '',
    };
  }

  return out;
}

async function createDispute(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const orderIdRaw = req.body && req.body.orderId != null ? String(req.body.orderId).trim() : '';
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';

    if (!orderIdRaw || !mongoose.Types.ObjectId.isValid(orderIdRaw)) {
      return res.status(400).json({ message: 'Bad request', details: 'orderId is required' });
    }
    if (!reason) {
      return res.status(400).json({ message: 'Bad request', details: 'reason is required' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const proofFiles = files.map((f) => ({
      fileUrl: `/uploads/disputes/${f.filename}`,
      fileName: f.originalname || f.filename,
    }));

    await createDisputeForOrder({
      userId,
      orderId: orderIdRaw,
      reason,
      message,
      proofFiles,
    });

    const populated = await Order.findById(orderIdRaw)
      .populate('user', 'name phone')
      .populate('service', 'name')
      .populate(
        'agent',
        'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
      )
      .lean();

    const latest = await Dispute.findOne({ orderId: orderIdRaw }).sort({ createdAt: -1 }).lean();

    return res.status(201).json({
      dispute: formatDispute(latest),
      order: formatOrder(populated, { includeUser: true }),
    });
  } catch (err) {
    if (err && err.code === 'DISPUTE_EXISTS') {
      return res.status(409).json({ message: 'Conflict', details: err.message });
    }
    if (err && err.code === 'FORBIDDEN') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (err && err.code === 'INVALID_STATE') {
      return res.status(400).json({ message: 'Bad request', details: err.message });
    }
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ message: 'Not found' });
    }
    return next(err);
  }
}

async function getUserDisputes(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const rows = await Dispute.find({ userId })
      .sort({ createdAt: -1 })
      .populate('orderId', 'totalPrice status paymentStatus')
      .lean();

    return res.status(200).json({ disputes: rows.map((r) => formatDispute(r)) });
  } catch (err) {
    return next(err);
  }
}

async function getAgentDisputes(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (req.user.role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden', details: 'Agent only' });
    }

    const rows = await Dispute.find({ agentId: userId })
      .sort({ createdAt: -1 })
      .populate('orderId', 'totalPrice status paymentStatus')
      .lean();

    return res.status(200).json({ disputes: rows.map((r) => formatDispute(r)) });
  } catch (err) {
    return next(err);
  }
}

async function getAllDisputes(req, res, next) {
  try {
    const rows = await Dispute.find({})
      .sort({ createdAt: -1 })
      .populate('orderId', 'totalPrice status paymentStatus')
      .populate('userId', 'name email phone')
      .populate('agentId', 'shopName phone city state')
      .lean();

    return res.status(200).json({ disputes: rows.map((r) => formatDispute(r)) });
  } catch (err) {
    return next(err);
  }
}

async function updateDisputeStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, resolutionAction, newAgentId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid dispute id' });
    }
    if (!status || typeof status !== 'string' || !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        message: 'Bad request',
        details: `status must be one of: ${ALLOWED_STATUS.join(', ')}`,
      });
    }

    const dispute = await Dispute.findById(id);
    if (!dispute) return res.status(404).json({ message: 'Not found' });

    let storedResolution = dispute.resolutionAction || '';

    if (status === 'resolved') {
      if (!resolutionAction || !RESOLUTION_ACTIONS.includes(resolutionAction)) {
        return res.status(400).json({
          message: 'Bad request',
          details: `resolutionAction is required for resolved and must be one of: ${RESOLUTION_ACTIONS.join(', ')}`,
        });
      }
      storedResolution = await applyDisputeResolutionToOrder(
        dispute.orderId,
        dispute.userId,
        { status: 'resolved', resolutionAction, newAgentId }
      );
    } else if (status === 'rejected') {
      storedResolution = await applyDisputeResolutionToOrder(dispute.orderId, dispute.userId, {
        status: 'rejected',
      });
    } else {
      dispute.status = status;
      await dispute.save();
      const freshOpen = await Dispute.findById(id)
        .populate('orderId', 'totalPrice status paymentStatus')
        .populate('userId', 'name email')
        .populate('agentId', 'shopName phone')
        .lean();
      return res.status(200).json({ dispute: formatDispute(freshOpen) });
    }

    dispute.status = status;
    if (storedResolution) dispute.resolutionAction = storedResolution;
    await dispute.save();

    const fresh = await Dispute.findById(id)
      .populate('orderId', 'totalPrice status paymentStatus')
      .populate('userId', 'name email')
      .populate('agentId', 'shopName phone')
      .lean();

    return res.status(200).json({ dispute: formatDispute(fresh) });
  } catch (err) {
    if (err && err.code === 'BAD_INPUT') {
      return res.status(400).json({ message: 'Bad request', details: err.message });
    }
    if (err && err.code === 'BAD_AGENT') {
      return res.status(400).json({ message: 'Bad request', details: err.message });
    }
    return next(err);
  }
}

async function addAdminResponse(req, res, next) {
  try {
    const { id } = req.params;
    const { adminResponse, status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid dispute id' });
    }
    if (adminResponse == null || typeof adminResponse !== 'string' || !adminResponse.trim()) {
      return res.status(400).json({ message: 'Bad request', details: 'adminResponse is required' });
    }

    const set = { adminResponse: adminResponse.trim() };
    if (status && ALLOWED_STATUS.includes(status)) {
      set.status = status;
      if (status === 'in_review' && !req.body.resolutionAction) {
        // optional: mark in review
      }
    }

    const dispute = await Dispute.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: false });
    if (!dispute) return res.status(404).json({ message: 'Not found' });

    const fresh = await Dispute.findById(dispute._id)
      .populate('orderId', 'totalPrice status paymentStatus')
      .lean();

    return res.status(200).json({ dispute: formatDispute(fresh) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createDispute,
  getUserDisputes,
  getAgentDisputes,
  getAllDisputes,
  updateDisputeStatus,
  addAdminResponse,
  formatDispute,
};
