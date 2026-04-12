/**
 * Standard and custom order creation flows.
 */
const mongoose = require('mongoose');
const Order = require('../../../models/Order');
const Service = require('../../../models/Service');
const User = require('../../../models/User');
const { createNotification, notifyRoleUsers } = require('../../../services/notificationService');
const ph = require('../parts/orderPureHelpers');
const { DUPLICATE_ORDER_SHORT_WINDOW_MS } = require('../parts/orderConstants');
const { bad, good, formatOrder, pickServiceName } = require('./orderQueryService');
const {
  notifyHighValueOrderAlert,
  postCustomRequestWelcomeMessage,
} = require('./orderNotificationService');

let customPlaceholderServiceIdCache = null;

async function getCustomPlaceholderServiceId() {
  if (customPlaceholderServiceIdCache && mongoose.Types.ObjectId.isValid(customPlaceholderServiceIdCache)) {
    return customPlaceholderServiceIdCache;
  }
  let s = await Service.findOne({ excludeFromBrowse: true, name: /^Custom service request$/i }).lean();
  if (!s) {
    const created = await Service.create({
      name: 'Custom service request',
      nameI18n: { en: 'Custom service request', hi: '', hinglish: '' },
      category: 'Personal',
      catalogCategory: 'personal',
      description: 'Internal placeholder for catalog custom requests.',
      basePrice: 0,
      pricingType: 'fixed',
      deliveryOptions: [{ type: 'soft_copy', price: 0 }],
      isActive: false,
      active: false,
      excludeFromBrowse: true,
    });
    s = created.toObject();
  }
  customPlaceholderServiceIdCache = String(s._id);
  return customPlaceholderServiceIdCache;
}

async function createOrder(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const consentUser = await User.findById(userId).select('isTermsAccepted isPrivacyAccepted').lean();
  if (
    consentUser &&
    (consentUser.isTermsAccepted === false || consentUser.isPrivacyAccepted === false)
  ) {
    return bad(403, {
      message: 'Forbidden',
      details:
        'Terms and Privacy Policy must be accepted to place orders. Please contact support if you need help.',
    });
  }

  const idempotencyKeyRaw =
    req.headers['x-idempotency-key'] || req.headers['X-Idempotency-Key'] || req.body?.idempotencyKey;
  const idempotencyKey =
    typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim().slice(0, 120) : '';
  if (!idempotencyKey) {
    return bad(400, {
      success: false,
      data: null,
      message: 'Bad request',
      errorCode: 'MISSING_IDEMPOTENCY_KEY',
    });
  }
  const existingOrder = await Order.findOne({ user: userId, idempotencyKey }).lean();
  if (existingOrder) {
    return good(200, formatOrder(existingOrder));
  }

  const { serviceId } = req.body || {};
  if (!serviceId || typeof serviceId !== 'string') {
    return bad(400, { message: 'Bad request', details: 'serviceId is required' });
  }

  const service = await Service.findById(serviceId);
  if (!service) {
    return bad(404, { message: 'Service not found' });
  }
  if (service.isActive === false) {
    return bad(400, { message: 'Bad request', details: 'Service is not available' });
  }

  const fastDup = await Order.findOne({
    user: userId,
    service: service._id,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_ORDER_SHORT_WINDOW_MS) },
  }).lean();
  if (fastDup) {
    return bad(409, {
      success: false,
      message: 'Duplicate order detected',
      details: 'Please wait before placing another order for this service.',
      errorCode: 'DUPLICATE_ORDER_FAST',
    });
  }

  const DUPLICATE_ORDER_WINDOW_MS = 5 * 60 * 1000;
  const recentDup = await Order.findOne({
    user: userId,
    service: service._id,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_ORDER_WINDOW_MS) },
    status: { $in: ['pending_payment', 'pending', 'paid', 'assigned', 'processing'] },
  }).lean();
  if (recentDup) {
    return bad(409, {
      success: false,
      message: 'Conflict',
      details:
        'You already have an active order for this service. Open that order or wait before creating another.',
      errorCode: 'DUPLICATE_ORDER',
    });
  }

  const pricingType = service.pricingType || 'fixed';
  let basePrice = service.basePrice != null ? Number(service.basePrice) : 0;
  if (basePrice === 0 && service.price != null) basePrice = Number(service.price);

  const tierRaw =
    typeof req.body.serviceTier === 'string' ? req.body.serviceTier.trim().toLowerCase() : '';
  let serviceTier = null;
  if (tierRaw === 'basic' || tierRaw === 'standard' || tierRaw === 'premium') {
    const tierKey = `price${tierRaw.charAt(0).toUpperCase()}${tierRaw.slice(1)}`;
    const tierPrice =
      service[tierKey] != null && !Number.isNaN(Number(service[tierKey])) ? Number(service[tierKey]) : 0;
    if (tierPrice > 0) {
      basePrice = tierPrice;
      serviceTier = tierRaw;
    }
  }

  const priceRules = Array.isArray(service.priceRules) ? service.priceRules : [];
  const serviceOptions = Array.isArray(service.options) ? service.options : [];
  const deliveryOptions =
    Array.isArray(service.deliveryOptions) && service.deliveryOptions.length > 0
      ? service.deliveryOptions
      : [{ type: 'soft_copy', price: 0 }];
  const requiredFields = Array.isArray(service.requiredFields) ? service.requiredFields : [];
  const conditionalFields = Array.isArray(service.conditionalFields) ? service.conditionalFields : [];
  const documentTypes = Array.isArray(service.documentTypes) ? service.documentTypes : [];

  const selectedDeliveryType =
    typeof req.body.selectedDeliveryType === 'string'
      ? req.body.selectedDeliveryType
      : deliveryOptions[0]?.type;

  const deliveryOption = deliveryOptions.find((d) => d.type === selectedDeliveryType);
  if (!deliveryOption) {
    return bad(400, { message: 'Bad request', details: 'Invalid delivery option' });
  }

  let pricingAdd = 0;
  const selectedOptions = {
    pricingType,
    selectedDeliveryOption: { type: deliveryOption.type, price: Number(deliveryOption.price) },
    ...(serviceTier ? { serviceTier } : {}),
  };

  const selectedOptionsRaw = ph.parseJsonMaybe(req.body.selectedOptions, req.body.selectedOptions || []);
  const selectedOptionNames = Array.isArray(selectedOptionsRaw)
    ? selectedOptionsRaw.map((n) => String(n).trim()).filter(Boolean)
    : [];

  const selectedServiceOptions = [];
  for (const optionName of selectedOptionNames) {
    const opt = serviceOptions.find((o) => o.name === optionName);
    if (opt) {
      selectedServiceOptions.push({
        name: opt.name,
        type: opt.type,
        price: Number(opt.price),
      });
    }
  }

  const selectedRadioOptions = selectedServiceOptions.filter((o) => o.type === 'radio');
  if (selectedRadioOptions.length > 1) {
    return bad(400, { message: 'Bad request', details: 'Only one radio option can be selected' });
  }

  const selectedDocumentType =
    typeof req.body.selectedDocumentType === 'string' ? req.body.selectedDocumentType.trim() : '';
  if (documentTypes.length > 0) {
    if (!selectedDocumentType) {
      return bad(400, { message: 'Bad request', details: 'Document type is required' });
    }
    if (!documentTypes.includes(selectedDocumentType)) {
      return bad(400, { message: 'Bad request', details: 'Invalid document type' });
    }
    selectedOptions.selectedDocumentType = selectedDocumentType;
  }

  if (pricingType === 'fixed') {
    pricingAdd = 0;
  } else if (pricingType === 'per_page') {
    if (priceRules.length === 0) {
      return bad(400, { message: 'Bad request', details: 'priceRules not configured for per_page' });
    }
    const idxRaw = req.body.selectedPriceRuleIndex;
    const idx = typeof idxRaw === 'string' ? Number(idxRaw) : idxRaw;
    if (idx == null || Number.isNaN(Number(idx)) || idx < 0 || idx >= priceRules.length) {
      return bad(400, { message: 'Bad request', details: 'Invalid price rule selection' });
    }
    const rule = priceRules[idx];
    pricingAdd = Number(rule.price);
    selectedOptions.selectedPriceRule = { label: rule.label, price: Number(rule.price) };
  } else if (pricingType === 'custom') {
    const custom = req.body.customPrice;
    const customPrice = typeof custom === 'string' ? Number(custom) : Number(custom);
    if (customPrice == null || Number.isNaN(customPrice) || customPrice < 0) {
      return bad(400, { message: 'Bad request', details: 'customPrice is required for custom pricing' });
    }
    pricingAdd = customPrice;
    selectedOptions.customPrice = customPrice;
  } else {
    return bad(400, { message: 'Bad request', details: 'Invalid pricingType' });
  }

  const dynamicOptionsPrice = selectedServiceOptions.reduce((sum, o) => sum + Number(o.price || 0), 0);
  const totalPrice =
    Number(basePrice) + pricingAdd + Number(deliveryOption.price) + Number(dynamicOptionsPrice);
  if (Number.isNaN(totalPrice) || totalPrice < 0) {
    return bad(400, { message: 'Bad request', details: 'Invalid computed total price' });
  }

  selectedOptions.basePrice = Number(basePrice);
  selectedOptions.pricingAdd = Number(pricingAdd);
  selectedOptions.dynamicOptions = selectedServiceOptions;
  selectedOptions.dynamicOptionsPrice = Number(dynamicOptionsPrice);
  selectedOptions.totalPrice = Number(totalPrice);

  const filledFields = {};
  const files = Array.isArray(req.files) ? req.files : [];

  for (let i = 0; i < requiredFields.length; i++) {
    const rf = requiredFields[i];
    const label = rf.label;
    if (rf.type === 'file') {
      const expectedFieldname = `requiredField_${i}`;
      const file = files.find((f) => f.fieldname === expectedFieldname);
      if (!file) {
        return bad(400, { message: 'Bad request', details: `Missing required file: ${label}` });
      }
      filledFields[label] = {
        type: 'file',
        fileUrl: '',
        fileName: file.originalname,
      };
    } else {
      const bodyKey = `requiredFieldText_${i}`;
      const val = req.body[bodyKey];
      if (val == null || (typeof val === 'string' && !val.trim())) {
        return bad(400, { message: 'Bad request', details: `Missing required field: ${label}` });
      }

      if (rf.type === 'number' && Number.isNaN(Number(val))) {
        return bad(400, { message: 'Bad request', details: `Invalid number field: ${label}` });
      }
      if (rf.type === 'date' && Number.isNaN(Date.parse(String(val)))) {
        return bad(400, { message: 'Bad request', details: `Invalid date field: ${label}` });
      }
      filledFields[label] = { type: rf.type, value: typeof val === 'string' ? val.trim() : val };
    }
  }

  const selectedNameSet = new Set(selectedServiceOptions.map((o) => o.name));
  for (const rule of conditionalFields) {
    if (!selectedNameSet.has(rule.dependsOn)) continue;

    const fields = Array.isArray(rule.fields) ? rule.fields : [];
    for (let i = 0; i < fields.length; i++) {
      const cf = fields[i];
      const keyBase = `conditionalField_${rule.dependsOn}_${i}`;

      if (cf.type === 'file') {
        const file = files.find((f) => f.fieldname === keyBase);
        if (!file) {
          return bad(400, {
            message: 'Bad request',
            details: `Missing conditional file: ${cf.label} (depends on ${rule.dependsOn})`,
          });
        }
        filledFields[`${rule.dependsOn}:${cf.label}`] = {
          type: 'file',
          fileUrl: '',
          fileName: file.originalname,
        };
      } else {
        const val = req.body[keyBase];
        if (val == null || (typeof val === 'string' && !val.trim())) {
          return bad(400, {
            message: 'Bad request',
            details: `Missing conditional field: ${cf.label} (depends on ${rule.dependsOn})`,
          });
        }
        if (cf.type === 'number' && Number.isNaN(Number(val))) {
          return bad(400, { message: 'Bad request', details: `Invalid number: ${cf.label}` });
        }
        if (cf.type === 'date' && Number.isNaN(Date.parse(String(val)))) {
          return bad(400, { message: 'Bad request', details: `Invalid date: ${cf.label}` });
        }
        filledFields[`${rule.dependsOn}:${cf.label}`] = {
          type: cf.type,
          value: typeof val === 'string' ? val.trim() : val,
        };
      }
    }
  }

  let planField = '';
  if (serviceTier) planField = serviceTier;
  else if (typeof req.body.plan === 'string') {
    const p = req.body.plan.trim().toLowerCase();
    if (['basic', 'standard', 'premium'].includes(p)) planField = p;
  }

  const customerLocation = ph.parseCustomerLocation(req.body);
  const preferredAgentId = ph.parsePreferredAgentId(req.body);
  const assignedToClient = ph.parseAssignedToFromBody(req.body);
  const assignedToEarly = assignedToClient === 'admin' && !preferredAgentId ? 'admin' : '';
  const orderFlags = ph.buildOrderFlags(totalPrice);

  const order = await Order.create({
    user: userId,
    service: service._id,
    amount: totalPrice,
    totalPrice,
    finalCalculatedPrice: totalPrice,
    selectedService: service._id.toString(),
    idempotencyKey,
    selectedOptions,
    filledFields,
    userInputs: filledFields,
    status: 'pending_payment',
    paymentStatus: 'pending',
    paymentId: '',
    plan: planField,
    flags: orderFlags,
    ...(customerLocation ? { customerLocation } : {}),
    ...(preferredAgentId ? { preferredAgent: preferredAgentId } : {}),
    ...(assignedToEarly ? { assignedTo: assignedToEarly } : {}),
    ...ph.calculateSplit(totalPrice),
  });

  if (orderFlags.includes('high_value')) {
    console.log('[safety] suspicious order — high_value', { orderId: String(order._id), amount: totalPrice });
    await notifyHighValueOrderAlert(order._id, totalPrice);
  }

  const fileSvc = require('../../files/file.service');
  if (files.length) {
    await fileSvc.attachEmbeddedFilesAfterOrderCreate(order._id, userId, files, filledFields);
    await Order.findByIdAndUpdate(
      order._id,
      { $set: { filledFields, userInputs: filledFields } },
      { runValidators: false }
    );
  }

  await createNotification({
    userId,
    role: 'user',
    title: 'Order placed',
    type: 'order_created',
    event: 'order_placed',
    data: { name: 'Customer', orderId: String(order._id), serviceName: pickServiceName(service) },
    dedupeKey: `order_created_${String(order._id)}`,
  });
  await notifyRoleUsers('admin', {
    title: 'New order received',
    event: 'admin_new_order',
    data: { name: 'Customer', orderId: String(order._id), serviceName: pickServiceName(service) },
    type: 'order_created',
    dedupeKey: `admin_new_order_${String(order._id)}`,
  });

  const populated = await Order.findById(order._id)
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();
  const formatted = formatOrder(populated);
  return good(201, formatted, { socketNewOrder: formatted });
}

async function createCustomOrder(req) {
  const userId = req.user && req.user.userId;
  if (!userId) {
    return bad(401, { message: 'Unauthorized' });
  }

  const customServiceName =
    typeof req.body.customServiceName === 'string' ? req.body.customServiceName.trim() : '';
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const priorityRaw = typeof req.body.priority === 'string' ? req.body.priority.trim().toLowerCase() : 'normal';
  const priority = priorityRaw === 'urgent' ? 'urgent' : 'normal';
  const catRaw = typeof req.body.browseCategory === 'string' ? req.body.browseCategory.trim().toLowerCase() : '';
  const indRaw = typeof req.body.browseIndustry === 'string' ? req.body.browseIndustry.trim().toLowerCase() : '';

  if (!customServiceName || customServiceName.length < 2) {
    return bad(400, { message: 'Bad request', details: 'customServiceName is required (min 2 chars)' });
  }

  const placeholderId = await getCustomPlaceholderServiceId();
  const nameRx = new RegExp(`^${ph.escapeRx(customServiceName)}$`, 'i');

  const dup = await Order.findOne({
    user: userId,
    requestType: 'custom',
    status: { $in: ['pending', 'pending_payment'] },
    customServiceName: nameRx,
  }).lean();

  const rawFiles = Array.isArray(req.files) ? req.files : [];
  const files = rawFiles.filter((f) => f && f.size > 0);
  if (!files.length) {
    return bad(400, { message: 'Bad request', details: 'Document required' });
  }
  const fileSvc = require('../../files/file.service');

  if (dup) {
    const newDocs = await fileSvc.registerUserDocuments(String(dup._id), userId, files);
    const update = {
      customDescription: description,
      customPriority: priority,
    };
    if (catRaw && ['government', 'private', 'personal'].includes(catRaw)) {
      update.customBrowseContext = { category: catRaw, industry: indRaw || '' };
    }
    const push = newDocs.length ? { $push: { documents: { $each: newDocs } } } : {};
    await Order.findByIdAndUpdate(
      dup._id,
      { $set: update, ...push },
      { runValidators: false }
    );
    const populated = await Order.findById(dup._id)
      .populate('user', 'name phone')
      .populate('service', 'name')
      .lean();
    const formatted = formatOrder(populated, { includeUser: true });
    return good(200, { order: formatted, updated: true }, { socketNewOrder: formatted });
  }

  const order = await Order.create({
    user: userId,
    service: new mongoose.Types.ObjectId(placeholderId),
    requestType: 'custom',
    customServiceName,
    customDescription: description,
    customPriority: priority,
    ...(catRaw && ['government', 'private', 'personal'].includes(catRaw)
      ? { customBrowseContext: { category: catRaw, industry: indRaw || '' } }
      : {}),
    amount: 0,
    totalPrice: 0,
    finalCalculatedPrice: 0,
    status: 'paid',
    paymentStatus: 'paid',
    paid: true,
    paidAt: new Date(),
    selectedService: customServiceName,
  });

  const newDocs = await fileSvc.registerUserDocuments(String(order._id), userId, files);
  await Order.findByIdAndUpdate(
    order._id,
    { $push: { documents: { $each: newDocs } } },
    { runValidators: false }
  );

  const populated = await Order.findById(order._id)
    .populate('user', 'name phone')
    .populate('service', 'name')
    .lean();
  const formatted = formatOrder(populated, { includeUser: true });
  await postCustomRequestWelcomeMessage(req, userId);
  await createNotification({
    userId,
    role: 'user',
    title: 'Order request received',
    message: `We received your request for "${customServiceName}".`,
    type: 'order_created',
    event: 'custom_order_placed',
    data: { orderId: String(order._id), customServiceName },
    dedupeKey: `order_created_${String(order._id)}`,
  });
  const adminNote = {
    title: 'Custom service request',
    message: `${customServiceName}${description ? `: ${description.slice(0, 120)}` : ''}`,
    type: 'order_created',
    event: 'custom_request',
    data: { orderId: String(order._id) },
    dedupeKey: `admin_custom_order_${String(order._id)}`,
  };
  await notifyRoleUsers('admin', adminNote);
  await notifyRoleUsers('super_admin', adminNote);

  return good(201, { order: formatted, updated: false }, { socketNewOrder: formatted });
}

module.exports = {
  createOrder,
  createCustomOrder,
};
