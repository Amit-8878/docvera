const express = require('express');

const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const adminController = require('../controllers/adminController');
const adminSettingsRoutes = require('./adminSettingsRoutes');
const fraudController = require('../controllers/fraudController');
const referralController = require('../controllers/referralController');
const financeController = require('../controllers/financeController');
const serviceController = require('../modules/services/service.controller');
const aiDebugController = require('../controllers/aiDebugController');
const activityController = require('../controllers/activityController');
const projectIntelligenceController = require('../controllers/projectIntelligenceController');
const projectPatchController = require('../controllers/projectPatchController');
const projectControlController = require('../controllers/projectControlController');
const agentFoundationController = require('../controllers/agentFoundationController');
const agentOnboardingController = require('../controllers/agentOnboardingController');
const adminReviews = require('../modules/aiReviews/adminReviews');
const { requireAdminReviewKey } = require('../middleware/adminReviewKeyMiddleware');
const { optionalServiceIconUpload } = require('../middleware/serviceIconUpload');

const safeAdminWalletBalance = (req, res) => {
  res.status(200).json({ success: false, message: 'Not implemented yet' });
};

// GET /api/admin/dashboard — auth + admin only
router.get('/dashboard', authMiddleware, adminOnly, adminController.getDashboardStats);

/** GET /api/admin/payments — all Payment documents (newest first). Auth disabled for local testing. */
router.get('/payments', adminController.getPayments);

/** Settings: see `adminSettingsRoutes.js` (GET/PATCH /api/admin/global|pricing|toggles). */
router.use(adminSettingsRoutes);

router.get('/activity-logs', authMiddleware, adminOnly, activityController.listActivityLogs);

/** Project tree + module heuristics (read-only scan, cached). */
router.get('/project/overview', authMiddleware, adminOnly, projectIntelligenceController.getOverview);

/** Controlled patch apply (backup + admin approval only) — no auto-run from scanners. */
router.post('/project/preview-patch', authMiddleware, adminOnly, projectPatchController.postPreviewPatch);
router.post('/project/apply-patch', authMiddleware, adminOnly, projectPatchController.postApplyPatch);
router.post('/project/rollback', authMiddleware, adminOnly, projectPatchController.postRollback);

/** Whitelisted shell commands from repo root (VPS/PM2). */
router.get('/project/allowed-commands', authMiddleware, adminOnly, projectControlController.getAllowedCommands);
router.post('/project/run-command', authMiddleware, adminOnly, projectControlController.postRunCommand);

/** In-memory agent foundation (admin testing; resets on restart). */
router.post('/agent-foundation/register', authMiddleware, adminOnly, agentFoundationController.postRegister);
router.post('/agent-foundation/approve', authMiddleware, adminOnly, agentFoundationController.postApprove);
router.post('/agent-foundation/reject', authMiddleware, adminOnly, agentFoundationController.postReject);
router.get('/agent-foundation/list', authMiddleware, adminOnly, agentFoundationController.getList);

/** OTP onboarding (admin verifies code from server terminal) + admin profile/subscribe overrides. */
router.post('/agent-onboarding/verify-otp', authMiddleware, adminOnly, agentOnboardingController.postVerifyOtp);
router.post('/agent-onboarding/profile', authMiddleware, adminOnly, agentOnboardingController.postAdminProfile);
router.post('/agent-onboarding/subscribe', authMiddleware, adminOnly, agentOnboardingController.postAdminSubscribe);

router.get('/referral-config', authMiddleware, adminOnly, referralController.getReferralConfig);
router.put('/referral-config', authMiddleware, adminOnly, referralController.putReferralConfig);
router.get('/referral-logs', authMiddleware, adminOnly, referralController.getReferralLogs);
router.get('/earnings', authMiddleware, adminOnly, referralController.getAdminEarningsDashboard);

/** Platform fee totals (admin share) — same basis as finance overview platform slice. */
router.get('/wallet', authMiddleware, adminOnly, safeAdminWalletBalance);

router.get('/finance/overview', authMiddleware, adminOnly, financeController.overview);
router.get('/finance/chart', authMiddleware, adminOnly, financeController.chart);
router.get('/finance/transactions', authMiddleware, adminOnly, financeController.transactions);

router.get('/fraud/overview', authMiddleware, adminOnly, fraudController.overview);
router.get('/fraud/logs', authMiddleware, adminOnly, fraudController.recentLogs);
router.post('/fraud/users/:id/restrict', authMiddleware, adminOnly, fraudController.restrictUser);
router.post('/fraud/users/:id/clear-referral-block', authMiddleware, adminOnly, fraudController.clearReferralBlock);
router.post('/fraud/users/:id/remove-referral-bonus', authMiddleware, adminOnly, fraudController.removeLastReferralBonus);

/** Smart service control (admin + super_admin); POST upserts by name + catalog + industry. */
router.post(
  '/service',
  authMiddleware,
  adminOnly,
  optionalServiceIconUpload,
  serviceController.adminUpsertService
);
router.put('/service/:id', authMiddleware, adminOnly, serviceController.updateService);
router.patch('/service/toggle/:id', authMiddleware, adminOnly, serviceController.toggleService);

/** AI error monitor (5xx capture + OpenAI/Ollama hints). */
router.get('/errors', authMiddleware, adminOnly, aiDebugController.listErrors);
router.get('/errors/pending-count', authMiddleware, adminOnly, aiDebugController.pendingCount);
router.post('/errors/fix', authMiddleware, adminOnly, aiDebugController.postFix);
router.post('/errors/:id/reanalyze', authMiddleware, adminOnly, aiDebugController.reanalyze);

// Smoke test
router.get('/test', (req, res) => {
  res.status(200).send('admin router test ok');
});

/** Review moderation — optional x-admin-key when ADMIN_REVIEW_KEY is set. */
router.get('/reviews', requireAdminReviewKey, adminReviews.getReviews);
router.post('/reviews', requireAdminReviewKey, adminReviews.postReview);
router.patch('/reviews/:id', requireAdminReviewKey, adminReviews.patchReviewStatus);
router.delete('/reviews/:id', requireAdminReviewKey, adminReviews.deleteReview);

module.exports = router;
