const express = require('express');
const path = require('path');
const multer = require('multer');

const orderController = require('./order.controller');
const authMiddleware = require('../../middleware/authMiddleware');
const requireEmailVerified = require('../../middleware/requireEmailVerified');
const { requireFeatureEnabled } = require('../../middleware/systemFeatureMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const { agentOnly } = require('../../middleware/agentMiddleware');
const { UPLOAD_ROOT } = require('../files/file.service');
const { adminOrAssignedAgentForResultUpload } = require('../../middleware/orderResultUploadAuth');

const router = express.Router();

const uploadDir = path.join(UPLOAD_ROOT, 'orders');
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename: function (_req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'];
const upload = multer({
  storage,
  limits: {
    files: 8,
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Unsupported file type'));
    }
    return cb(null, true);
  },
});

try {
  require('fs').mkdirSync(uploadDir, { recursive: true });
} catch (_e) {
  // no-op
}

/** Agent status updates use multipart fields (`status`, optional `completionNote`, optional `proofFiles`). */
function requireMultipartAgentStatus(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().includes('multipart/form-data')) {
    return res.status(415).json({
      message: 'Unsupported Media Type',
      details: 'PUT /orders/:id/agent-status requires multipart/form-data',
    });
  }
  next();
}

const {
  createOrder,
  getMyOrders,
  getUserOrders,
  trackOrder,
  getOrderById,
  getAllOrders,
  getInvoicePdf,
  updateOrderStatus,
  assignOrderToAgent,
  triggerAutoAssignOrder,
  assignAgent,
  uploadDocuments,
  getAgentOrders,
  updateAgentOrderStatus,
  confirmOrderCompletion,
  raiseOrderIssue,
  adminForceRelease,
  adminResolveDispute,
  submitOrderRating,
  uploadResultAndCompleteOrder,
  createCustomOrder,
  createMinimalOrder,
  getOrderDetails,
  updateOrderAdminMeta,
} = orderController;

router.get('/track/:id', trackOrder);
router.get('/invoice/:id', authMiddleware, getInvoicePdf);

router.get('/user', authMiddleware, getUserOrders);
router.get('/admin', authMiddleware, adminOnly, getAllOrders);
router.get('/my', authMiddleware, getMyOrders);
router.get('/assigned', authMiddleware, agentOnly, getAgentOrders);

router.post(
  '/custom',
  authMiddleware,
  requireEmailVerified,
  requireFeatureEnabled('orders_enabled'),
  upload.any(),
  createCustomOrder
);
/**
 * POST /api/orders
 * - `Content-Type: application/json` + `{ "serviceId" }` → **rejected** (use `/api/checkout/session` + pay).
 * - Otherwise → full multipart flow (`createOrder`).
 */
router.post(
  '/',
  authMiddleware,
  requireFeatureEnabled('orders_enabled'),
  (req, res, next) => {
    if (req.is('application/json') && req.body && typeof req.body.serviceId === 'string' && req.body.serviceId.trim()) {
      return createMinimalOrder(req, res, next);
    }
    return next();
  },
  requireEmailVerified,
  upload.any(),
  createOrder
);
router.post('/upload', authMiddleware, requireFeatureEnabled('uploads_enabled'), upload.any(), uploadDocuments);
router.post(
  '/complete/:id',
  authMiddleware,
  requireFeatureEnabled('uploads_enabled'),
  adminOrAssignedAgentForResultUpload,
  upload.any(),
  uploadResultAndCompleteOrder
);

router.patch('/status/:id', authMiddleware, adminOnly, updateOrderStatus);
router.patch('/auto-assign/:id', authMiddleware, adminOnly, triggerAutoAssignOrder);
router.patch('/assign/:id', authMiddleware, adminOnly, assignAgent);

router.get('/', authMiddleware, adminOnly, getAllOrders);

router.put('/:id/status', authMiddleware, adminOnly, updateOrderStatus);
router.put('/:id/assign', authMiddleware, adminOnly, assignOrderToAgent);
router.put(
  '/:id/agent-status',
  authMiddleware,
  agentOnly,
  requireMultipartAgentStatus,
  upload.any(),
  updateAgentOrderStatus
);
router.put('/:id/confirm', authMiddleware, confirmOrderCompletion);
router.put('/:id/issue', authMiddleware, raiseOrderIssue);
router.put('/:id/review', authMiddleware, submitOrderRating);
router.put('/:id/force-release', authMiddleware, adminOnly, adminForceRelease);
router.put('/:id/resolve-dispute', authMiddleware, adminOnly, adminResolveDispute);
router.patch('/:id/admin-meta', authMiddleware, adminOnly, updateOrderAdminMeta);
router.put('/:id', authMiddleware, adminOnly, updateOrderStatus);

router.get('/:id', authMiddleware, getOrderDetails);

module.exports = router;
