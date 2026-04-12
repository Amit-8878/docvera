const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

const WALLET_TX_LIMIT = 50;

/**
 * Single handler for logged-in user wallet summary.
 * Served at `GET /api/wallet/me` (legacy `/customer`, `/dashboard`, `GET /wallet` → 308 in server.js):
 * - `walletBalance` + `balance` (same value)
 * - `promoBalance`, `totalEarnings`
 * - `transactions` (detailed, up to 50)
 * - `recentTransactions` (first 10, loose shape for older UI)
 * - `unreadNotificationsCount`
 */
async function getUnifiedWalletUser(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const me = await User.findById(userId)
      .select("walletBalance promoBalance totalEarnings")
      .lean();
    if (!me) return res.status(404).json({ message: "Not found" });

    const [txRows, unreadNotificationsCount] = await Promise.all([
      Transaction.find({ userId }).sort({ createdAt: -1 }).limit(WALLET_TX_LIMIT).lean(),
      Notification.countDocuments({ userId, read: false }),
    ]);

    const walletBalance = Number(me.walletBalance || 0);
    const promoBalance = Number(me.promoBalance || 0);
    const totalEarnings = Number(me.totalEarnings || 0);

    const transactions = txRows.map((t) => ({
      id: String(t._id),
      type: t.type,
      amount: Number(t.amount || 0),
      status: t.status,
      reference: t.reference || "",
      reason: t.reason || "",
      source: t.source || "",
      description: (t.description && String(t.description)) || (t.remark && String(t.remark)) || "",
      orderId: t.orderId != null ? String(t.orderId) : null,
      createdAt: t.createdAt,
    }));

    const recentTransactions = transactions.slice(0, 10).map((t) => ({
      id: t.id,
      _id: t.id,
      amount: t.amount,
      type: t.type,
      status: t.status,
      createdAt: t.createdAt,
      reference: t.reference,
      reason: t.reason,
      description: t.description,
      transactionType: t.type,
    }));

    return res.status(200).json({
      walletBalance,
      balance: walletBalance,
      promoBalance,
      totalEarnings,
      transactions,
      recentTransactions,
      unreadNotificationsCount,
    });
  } catch (err) {
    return next(err);
  }
}

/** @deprecated Alias — use `getUnifiedWalletUser` (same function). */
const getWalletDashboard = getUnifiedWalletUser;
/** @deprecated Alias — use `getUnifiedWalletUser` (same function). */
const getCustomerWallet = getUnifiedWalletUser;

async function requestWithdrawal(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const amount = Number((req.body && req.body.amount) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Bad request", details: "amount must be greater than 0" });
    }

    const updated = await User.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: amount } },
      { $inc: { walletBalance: -amount } },
      { new: true, runValidators: false }
    ).lean();
    if (!updated) {
      return res.status(400).json({ message: "Bad request", details: "Insufficient wallet balance" });
    }

    const tx = await Transaction.create({
      userId,
      type: "withdrawal",
      amount,
      status: "pending",
      reference: `withdraw_req_${String(userId)}_${Date.now()}`,
      reason: "withdrawal_request",
      source: "withdrawal",
      description: "Withdrawal request (pending)",
    });

    await Notification.create({
      userId,
      role: ["admin", "super_admin"].includes(updated.role) ? "admin" : updated.role === "agent" ? "agent" : "user",
      title: "Withdrawal",
      message: "Aapki withdrawal request process ho rahi hai.",
      type: "wallet",
      channel: "inApp",
      status: "sent",
      attempts: 1,
      read: false,
    });

    return res.status(201).json({
      success: true,
      walletBalance: Number(updated.walletBalance || 0),
      transaction: {
        id: String(tx._id),
        type: tx.type,
        amount: Number(tx.amount || 0),
        status: tx.status,
        reference: tx.reference || "",
        createdAt: tx.createdAt,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function getNotifications(req, res, next) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const list = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
    return res.status(200).json({
      notifications: list.map((n) => ({
        id: String(n._id),
        userId: String(n.userId),
        title: n.title,
        message: n.message,
        type: n.type,
        read: Boolean(n.read),
        isRead: Boolean(n.read),
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/wallet/test — health check for wallet route stack (no auth). */
function getWalletTest(req, res) {
  return res.status(200).json({ success: true });
}

module.exports = {
  getUnifiedWalletUser,
  getWalletDashboard,
  getCustomerWallet,
  requestWithdrawal,
  getNotifications,
  getWalletTest,
};
