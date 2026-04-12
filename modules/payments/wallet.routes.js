const express = require('express');

const authMiddleware = require('../../middleware/authMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const walletController = require('./wallet.controller');

const router = express.Router();

/** GET /api/wallet (root) → 308 /api/wallet/me (server.js); no handler here. */

router.post(
  '/commission/release',
  authMiddleware,
  adminOnly,
  walletController.addCommissionToAgent
);

router.post('/add', authMiddleware, adminOnly, walletController.adminCreditUser);
router.post('/deduct', authMiddleware, adminOnly, walletController.adminDebitUser);

router.get('/agent', authMiddleware, walletController.getAgentWallet);

/** Logged-in user: balances only. */
router.get('/balance', authMiddleware, walletController.getWalletBalance);

/** Logged-in user: transaction history (optional ?limit=50). */
router.get('/history', authMiddleware, walletController.getWalletHistory);

/** Optional: platform fee split helper (uses PLATFORM_FEE_PERCENT from env) */
router.get('/platform-split', authMiddleware, walletController.deductPlatformFee);

router.get('/admin/revenue', authMiddleware, adminOnly, walletController.getAdminTotalRevenue);

module.exports = router;
