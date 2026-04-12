const Order = require('../models/Order');
const User = require('../models/User');
const { formatOrder } = require('../controllers/orderController');
const ioSingleton = require('../socket/ioSingleton');
const { emitOrderUpdateFromPayment, getIo } = require('../socket/orderEvents');
const { triggerReferralCommission } = require('./referralService');
const { recordGrossOrderRevenue } = require('./adminEarningsService');
const { log: auditLog } = require('./auditLogService');
const { splitOrderTotalForCommission } = require('./orderPaymentSplit');
const { logPayment } = require('../utils/logger');
const { enqueueMainJob, JOB_NAMES } = require('../queues/mainQueue');
const { enqueueOrderJob, ORDER_JOB_NAMES } = require('../modules/jobs/jobQueue');

/**
 * Single place to mark order paid (gateway), platform/agent split, invoice, referral + admin earnings.
 * Idempotent: safe if already paid/held/released.
 * Commission split uses agent.commissionPercent when assigned; otherwise env platform fee %.
 * Agent assignment runs here after payment (not at order create).
 */
async function handlePaymentSuccess(req, orderId, uid, paymentIdStr, walletRupeesUsed, promoRupeesUsed = 0) {
  logPayment('handlePaymentSuccess_start', { orderId: String(orderId), userId: String(uid) });
  const existing = await Order.findById(orderId).lean();
  if (!existing || String(existing.user) !== String(uid)) {
    return null;
  }
  const existingPayId = String(existing.paymentId || '').trim();
  const fullyCaptured =
    existing.paymentStatus === 'held' ||
    existing.paymentStatus === 'released' ||
    (existing.paymentStatus === 'paid' && existingPayId !== '');
  if (fullyCaptured) {
    console.log('[safety] payment duplicate ignored (already captured)', {
      orderId: String(orderId),
      paymentStatus: existing.paymentStatus,
      paymentIdSet: existingPayId !== '',
    });
    return existing;
  }

  const total = Number(existing?.finalCalculatedPrice ?? existing?.totalPrice ?? existing?.amount ?? 0);

  let agentLean = null;
  if (existing.agent) {
    agentLean = await User.findById(existing.agent).select('commissionPercent role').lean();
  }
  const { platformFee, agentEarning } = splitOrderTotalForCommission(total, agentLean);

  const wUsed = Number(walletRupeesUsed || existing.walletAmountUsed || existing.walletUsed || 0);
  const pUsed = Number(
    promoRupeesUsed != null && promoRupeesUsed !== ''
      ? promoRupeesUsed
      : existing.promoAmountUsed != null
        ? existing.promoAmountUsed
        : 0
  );
  const st = String(existing.status || '');
  const nextOrderStatus = st === 'pending_payment' || st === 'pending' ? 'paid' : existing.status;

  const settleFilter = {
    _id: orderId,
    user: uid,
    $or: [
      { paymentStatus: { $in: ['unpaid', 'pending'] } },
      {
        paymentStatus: 'paid',
        $or: [{ paymentId: { $exists: false } }, { paymentId: '' }, { paymentId: null }],
      },
    ],
  };

  const updated = await Order.findOneAndUpdate(
    settleFilter,
    {
      $set: {
        paymentId: paymentIdStr,
        paymentStatus: 'paid',
        paid: true,
        paidAt: new Date(),
        platformFee,
        agentEarning,
        userConfirmationStatus: 'pending',
        walletAmountUsed: wUsed,
        walletUsed: wUsed,
        promoAmountUsed: pUsed,
        status: nextOrderStatus,
      },
    },
    { new: true, runValidators: false }
  );
  if (!updated) {
    console.error(
      JSON.stringify({
        type: 'handlePaymentSuccess_update_failed',
        orderId: String(orderId),
        userId: String(uid),
        paymentId: String(paymentIdStr || ''),
        paymentStatus: existing.paymentStatus,
      })
    );
    return null;
  }

  console.log(
    JSON.stringify({
      type: 'order_payment_settled',
      phase: 'handlePaymentSuccess',
      docveraOrderId: String(orderId),
      paymentId: String(paymentIdStr || ''),
      orderStatus: updated.status,
      paymentStatus: updated.paymentStatus,
      amount: Number(updated?.finalCalculatedPrice ?? updated?.totalPrice ?? updated?.amount ?? 0),
    })
  );

  const populated = await Order.findById(updated._id)
    .populate('service', 'name')
    .populate(
      'agent',
      'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
    )
    .lean();
  const io = getIo(req) || ioSingleton.getIo();
  if (io && populated) {
    emitOrderUpdateFromPayment(io, formatOrder(populated, { includeUser: true }));
  }
  auditLog({
    type: 'payment',
    userId: uid,
    req,
    message: 'order_payment_captured',
    meta: { orderId: String(orderId), walletRupees: wUsed, promoRupees: pUsed },
  }).catch(() => {});

  const amtForNotify = Number(updated?.finalCalculatedPrice ?? updated?.totalPrice ?? updated?.amount ?? 0);
  const logEnqueue = (name, r) => {
    if (r && r.ok) return;
    console.error(
      JSON.stringify({
        type: 'order_job_enqueue_failed',
        name,
        orderId: String(orderId),
        result: r || null,
      })
    );
  };
  void enqueueOrderJob(ORDER_JOB_NAMES.GENERATE_INVOICE, { orderId: String(orderId) })
    .then((r) => logEnqueue(ORDER_JOB_NAMES.GENERATE_INVOICE, r))
    .catch((e) => console.error(JSON.stringify({ type: 'order_job_enqueue_error', err: e.message })));
  void enqueueOrderJob(ORDER_JOB_NAMES.PAYMENT_SUCCESS_NOTIFY, {
    orderId: String(orderId),
    userId: String(uid),
    amount: amtForNotify,
  })
    .then((r) => logEnqueue(ORDER_JOB_NAMES.PAYMENT_SUCCESS_NOTIFY, r))
    .catch((e) => console.error(JSON.stringify({ type: 'order_job_enqueue_error', err: e.message })));
  void enqueueOrderJob(ORDER_JOB_NAMES.POST_PAYMENT_AUTO_ASSIGN, { orderId: String(orderId) })
    .then((r) => logEnqueue(ORDER_JOB_NAMES.POST_PAYMENT_AUTO_ASSIGN, r))
    .catch((e) => console.error(JSON.stringify({ type: 'order_job_enqueue_error', err: e.message })));

  try {
    await recordGrossOrderRevenue(
      Number(updated?.finalCalculatedPrice ?? updated?.totalPrice ?? updated?.amount ?? 0)
    );
    await triggerReferralCommission(updated);
  } catch (e) {
    console.error(JSON.stringify({ type: 'post_payment_wallet_hook', orderId: String(orderId), err: e.message }));
  }

  logPayment('handlePaymentSuccess_done', { orderId: String(orderId), paymentId: String(paymentIdStr || '') });
  enqueueMainJob(JOB_NAMES.PAYMENT_VERIFICATION, {
    orderId: String(orderId),
    paymentId: String(paymentIdStr || ''),
    userId: String(uid),
  }).catch(() => {});
  return updated;
}

/**
 * Razorpay webhook: same success path as verify API; idempotent if already paid.
 */
async function handlePaymentSuccessWebhook(orderId, paymentIdStr) {
  const existing = await Order.findById(orderId).lean();
  if (!existing) return null;
  const minimalReq = {
    headers: { 'x-source': 'razorpay-webhook' },
    get: () => null,
    ip: 'razorpay-webhook',
  };
  return handlePaymentSuccess(
    minimalReq,
    orderId,
    existing.user,
    paymentIdStr,
    Number(existing.walletAmountUsed || existing.walletUsed || 0)
  );
}

module.exports = { handlePaymentSuccess, handlePaymentSuccessWebhook };
