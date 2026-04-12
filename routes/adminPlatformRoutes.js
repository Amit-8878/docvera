const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const { safeAsync } = require('../middleware/safeAsync');
const adminPlatformController = require('../controllers/adminPlatformController');

const router = express.Router();

router.get('/platform', authMiddleware, adminOnly, safeAsync(adminPlatformController.getPlatform));
router.get('/platform/logs', authMiddleware, adminOnly, safeAsync(adminPlatformController.getLogs));

module.exports = router;
