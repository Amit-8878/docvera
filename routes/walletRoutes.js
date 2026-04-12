const express = require("express");
const auth = require("../middleware/auth");
const {
  getWalletDashboard,
  requestWithdrawal,
  getNotifications,
  getWalletTest,
} = require("../controllers/walletController");

const router = express.Router();

/** Safe probe — no auth (verify wallet router mounted). */
router.get("/test", getWalletTest);

/** Canonical user wallet summary (legacy /dashboard, /customer, GET /wallet/ → 308 /me in server.js). */
router.get("/me", auth, getWalletDashboard);

/** Withdraw: deduct balance, pending transaction + in-app notification */
router.post("/withdraw", auth, requestWithdrawal);

/** Notification list (newest first, limit 20) */
router.get("/notifications", auth, getNotifications);

module.exports = router;
