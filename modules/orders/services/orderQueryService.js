/**
 * Order read model: HTTP result helpers, formatting, list/detail queries.
 */
const mongoose = require('mongoose');
const Order = require('../../../models/Order');
const User = require('../../../models/User');
const { effectiveAgentResponseStatus } = require('../../../utils/agentResponseStatus');
const ph = require('../parts/orderPureHelpers');

function bad(status, body) {
  return { ok: false, status, body };
}
function good(status, body, extra = {}) {
  return { ok: true, status, body, ...extra };
}

function formatOrder(doc, { includeUser = false } = {}) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

  const id = o._id;
  delete o._id;
  delete o.__v;

  let serviceName = null;
  if (o.requestType === 'custom' && o.customServiceName) {
    serviceName = o.customServiceName;
  } else if (o.service && typeof o.service === 'object' && o.service.name != null) {
    serviceName = o.service.name;
  }

  const price = o.totalPrice != null ? Number(o.totalPrice) : o.amount != null ? Number(o.amount) : null;

  const rfList = Array.isArray(o.resultFiles) ? o.resultFiles : [];
  const firstRf = rfList[0];
  const deliveryFileResolved =
    (o.deliveryFile && String(o.deliveryFile).trim()) ||
    (firstRf && firstRf.fileId ? `/api/files/${String(firstRf.fileId)}/download` : null);

  const serviceId =
    o.service && typeof o.service === 'object' && o.service._id
      ? String(o.service._id)
      : o.service
        ? String(o.service)
        : null;
  const userId =
    o.user && typeof o.user === 'object' && o.user._id ? String(o.user._id) : o.user ? String(o.user) : null;

  const out = {
    orderId: id ? String(id) : null,
    userId,
    serviceId,
    service: serviceName,
    price,
    totalPrice: price,
    finalCalculatedPrice:
      o.finalCalculatedPrice != null ? Number(o.finalCalculatedPrice) : price,
    walletAmountUsed: o.walletAmountUsed != null ? Number(o.walletAmountUsed) : 0,
    walletUsed: o.walletUsed != null ? Number(o.walletUsed) : Number(o.walletAmountUsed || 0),
    promoAmountUsed: o.promoAmountUsed != null ? Number(o.promoAmountUsed) : 0,
    onlinePaid: o.onlinePaid != null ? Number(o.onlinePaid) : 0,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    selectedOptions: o.selectedOptions || {},
    filledFields: o.filledFields || {},
    userInputs: o.userInputs || {},
    paymentStatus: o.paymentStatus || 'pending',
    paid: Boolean(o.paid),
    simulatedPayment: Boolean(o.simulatedPayment),
    platformFee: Number(o.platformFee || 0),
    agentEarning: Number(o.agentEarning || 0),
    commission: Number(o.agentEarning || 0),
    proofFiles: Array.isArray(o.proofFiles)
      ? o.proofFiles.map((d) => {
          if (!d || typeof d !== 'object') return d;
          const fid = d.fileId ? String(d.fileId) : null;
          return {
            ...d,
            fileId: fid,
            downloadUrl: fid ? `/api/files/${fid}/download` : null,
          };
        })
      : [],
    resultFiles: Array.isArray(o.resultFiles)
      ? o.resultFiles.map((d) => {
          if (!d || typeof d !== 'object') return d;
          const fid = d.fileId ? String(d.fileId) : null;
          return {
            ...d,
            fileId: fid,
            downloadUrl: fid ? `/api/files/${fid}/download` : null,
          };
        })
      : [],
    documents: Array.isArray(o.documents)
      ? o.documents.map((d) => {
          if (!d || typeof d !== 'object') return d;
          const fid = d.fileId ? String(d.fileId) : null;
          return {
            ...d,
            fileId: fid,
            downloadUrl: fid ? `/api/files/${fid}/download` : null,
          };
        })
      : [],
    completionNote: o.completionNote || '',
    completionSubmittedAt: o.completionSubmittedAt || null,
    completedAt: o.completedAt || null,
    userConfirmationStatus: o.userConfirmationStatus || 'pending',
    userRating: Number(o.userRating || 0),
    userReview: o.userReview || '',
    ratedAt: o.ratedAt || null,
    issueRaised: Boolean(o.issueRaised),
    adminReviewRequired: Boolean(o.adminReviewRequired),
    plan: o.plan || '',
    invoiceUrl: o.invoicePdfPath
      ? `/uploads/${String(o.invoicePdfPath).replace(/^\/+/, '')}`
      : null,
    deliveryFile: deliveryFileResolved,
    trackingProgress: ph.trackingProgressForOrder(o),
    agentResponseStatus: effectiveAgentResponseStatus(o),
    requestType: o.requestType || 'standard',
    customServiceName: o.customServiceName || '',
    customDescription: o.customDescription || '',
    customPriority: o.customPriority || 'normal',
    customBrowseContext: o.customBrowseContext || null,
    adminRemarks: o.adminRemarks != null ? String(o.adminRemarks) : '',
    adminPriority: o.adminPriority || 'normal',
    flags: Array.isArray(o.flags) ? o.flags : [],
    agentAssignedAt: o.agentAssignedAt || null,
    assignedTo: o.assignedTo && String(o.assignedTo).trim() ? String(o.assignedTo).trim() : '',
    deliverViaCourier: Boolean(o.deliverViaCourier),
    courierFee: Number(o.courierFee || 0),
  };

  const hasAgent = Boolean(o.agent);
  const ps = String(o.paymentStatus || '');
  const paymentCaptured = ['held', 'paid', 'released'].includes(ps);
  out.searchingForAgent =
    !hasAgent &&
    paymentCaptured &&
    String(o.status) !== 'pending_payment' &&
    (o.status === 'pending' || o.status === 'paid' || o.status === 'processing') &&
    o.assignedTo !== 'admin';

  if (includeUser && o.user && typeof o.user === 'object') {
    out.user = {
      name: o.user.name,
      phone: o.user.phone,
    };
  }
  if (o.agent && typeof o.agent === 'object') {
    const aid = o.agent._id ? String(o.agent._id) : null;
    out.assignedAgent = aid;
    out.agentId = aid;
    out.agent = {
      id: aid,
      shopName: o.agent.shopName || '',
      phone: o.agent.phone || '',
      address: o.agent.address || '',
      city: o.agent.city || '',
      state: o.agent.state || '',
      pincode: o.agent.pincode || '',
      isApproved: Boolean(o.agent.isApproved),
      avgRating: Number(o.agent.avgRating || 0),
      rating: Number(o.agent.rating || 0),
      totalReviews: Number(o.agent.totalReviews || 0),
      completedOrders: Number(o.agent.completedOrders || 0),
      cancelledOrders: Number(o.agent.cancelledOrders || 0),
      activeOrders: Number(o.agent.activeOrders || 0),
      agentLevel: o.agent.agentLevel || 'Beginner',
      isRestricted: Boolean(o.agent.isRestricted),
    };
  } else if (o.agent) {
    out.assignedAgent = String(o.agent);
    out.agentId = String(o.agent);
  }

  return out;
}

function pickServiceName(serviceDoc) {
  if (!serviceDoc) return 'Service';
  if (typeof serviceDoc.name === 'string') return serviceDoc.name;
  if (serviceDoc.name && typeof serviceDoc.name === 'object') {
    return serviceDoc.name.en || serviceDoc.name.hi || serviceDoc.name.hinglish || 'Service';
  }
  return 'Service';
}

async function getMyOrders(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const { maybeAutoRelease } = require('./orderUpdateService');

  const orders = await Order.find({ user: userId })
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .sort({ createdAt: -1 })
    .lean();
  const normalized = [];
  for (const o of orders) {
    const maybeUpdated = await maybeAutoRelease(o);
    normalized.push(formatOrder(maybeUpdated));
  }
  return good(200, { orders: normalized });
}

async function trackOrder(req) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const { maybeAutoRelease } = require('./orderUpdateService');
  const { maybeReassignIfAcceptTimeout } = require('./orderAssignmentService');

  const orderRaw = await Order.findById(id)
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .lean();
  if (!orderRaw) {
    return bad(404, { message: 'Not found' });
  }
  let order = await maybeAutoRelease(orderRaw);
  order = await maybeReassignIfAcceptTimeout(order);

  return good(200, formatOrder(order));
}

async function getOrderById(req) {
  const userId = req.user && req.user.userId;
  const isAdmin = req.user && req.user.role === 'admin';
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return bad(400, { message: 'Bad request', details: 'Invalid order id' });
  }

  const { maybeAutoRelease } = require('./orderUpdateService');
  const { maybeReassignIfAcceptTimeout } = require('./orderAssignmentService');

  const populatedRaw = await Order.findById(id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();

  if (!populatedRaw) {
    return bad(404, { message: 'Not found' });
  }
  let populated = await maybeAutoRelease(populatedRaw);
  populated = await maybeReassignIfAcceptTimeout(populated);

  const u = populated.user;
  const ownerId =
    u && typeof u === 'object' && u._id != null ? String(u._id) : String(u);
  const agentRef = populated.agent;
  const assignedAgentId =
    agentRef && typeof agentRef === 'object' && agentRef._id != null
      ? String(agentRef._id)
      : agentRef
        ? String(agentRef)
        : null;
  const isAssignedAgent =
    req.user.role === 'agent' && assignedAgentId && assignedAgentId === String(userId);

  if (!isAdmin && ownerId !== String(userId) && !isAssignedAgent) {
    return bad(403, { message: 'Forbidden' });
  }

  return good(200, formatOrder(populated, { includeUser: isAdmin || isAssignedAgent }));
}

async function getAllOrders(req) {
  const filter = typeof req.query.filter === 'string' ? req.query.filter.trim().toLowerCase() : '';
  const kind = typeof req.query.kind === 'string' ? req.query.kind.trim().toLowerCase() : '';

  const clauses = [];
  if (kind === 'custom') {
    clauses.push({ requestType: 'custom' });
  } else {
    clauses.push({ $or: [{ requestType: { $exists: false } }, { requestType: 'standard' }] });
  }

  if (filter === 'pending') {
    clauses.push({ status: { $nin: ['completed', 'cancelled', 'failed'] } });
  } else if (filter === 'completed') {
    clauses.push({ status: 'completed' });
  }

  const mongoQuery = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };

  const { maybeAutoRelease } = require('./orderUpdateService');

  const orders = await Order.find(mongoQuery)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate('agent', 'shopName phone address city state pincode isApproved activeOrders')
    .sort({ createdAt: -1 })
    .lean();
  const normalized = [];
  for (const o of orders) {
    normalized.push(await maybeAutoRelease(o));
  }
  return good(200, {
    orders: normalized.map((o) => formatOrder(o, { includeUser: true })),
  });
}

async function getAgentOrders(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const me = await User.findById(userId).lean();
  if (!me || me.role !== 'agent') {
    return bad(403, { message: 'Forbidden', details: 'Agent only' });
  }
  if (!me.isApproved) {
    return bad(403, { message: 'Forbidden', details: 'Agent approval pending' });
  }

  const { maybeAutoRelease } = require('./orderUpdateService');

  const orders = await Order.find({ agent: userId })
    .populate('user', 'name phone')
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .sort({ createdAt: -1 })
    .lean();
  const normalized = [];
  for (const o of orders) normalized.push(await maybeAutoRelease(o));
  return good(200, { orders: normalized.map((o) => formatOrder(o, { includeUser: true })) });
}

module.exports = {
  bad,
  good,
  formatOrder,
  pickServiceName,
  getMyOrders,
  trackOrder,
  getOrderById,
  getAllOrders,
  getAgentOrders,
};
