const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { requireFeatureEnabled } = require('../middleware/systemFeatureMiddleware');
const { upload } = require('../config/simpleOrderMulter');
const simpleOrderController = require('../controllers/simpleOrderController');

const router = express.Router();

router.post(
  '/',
  authMiddleware,
  requireEmailVerified,
  requireFeatureEnabled('orders_enabled'),
  requireFeatureEnabled('uploads_enabled'),
  upload.array('files', 8),
  simpleOrderController.create
);
router.get('/', authMiddleware, simpleOrderController.list);
router.get('/:id', authMiddleware, simpleOrderController.getOne);

module.exports = router;
