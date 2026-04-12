/**
 * Admin settings (unified SystemConfig + SystemSetting).
 *
 * Mounted from `adminRoutes.js` via `router.use(adminSettingsRoutes)` under `/api/admin`.
 * Canonical paths:
 *   GET   /api/admin/global
 *   PATCH /api/admin/pricing
 *   PATCH /api/admin/toggles
 *
 * Legacy `/api/admin-settings/*` → 308 to the paths above (see `legacyApiRedirects.js`).
 *
 * All routes use authMiddleware + adminOnly.
 */
const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const {
  getGlobalSettings,
  updatePricing,
  updateToggles,
} = require('../controllers/adminSettingsController');

const router = express.Router();

router.get('/global', authMiddleware, adminOnly, getGlobalSettings);
router.patch('/pricing', authMiddleware, adminOnly, updatePricing);
router.patch('/toggles', authMiddleware, adminOnly, updateToggles);

module.exports = router;
