/**
 * Order-related background work: invoice PDF, payment notifications, auto-assign after pay.
 * Invoked by BullMQ worker or in-memory drain (see jobQueue.js).
 */

const mongoose = require('mongoose');
const Order = require('../../models/Order');
const User = require('../../models/User');
const { formatOrder } = require('../../controllers/orderController');
const ioSingleton = require('../../socket/ioSingleton');
const { emitOrderUpdateFromPayment } = require('../../socket/orderEvents');
const { generateInvoiceForOrderIfNeeded } = require('../../services/invoiceService');
const { createNotification } = require('../../services/notificationService');
const { splitOrderTotalForCommission } = require('../../services/orderPaymentSplit');
const { logPaymentFailure } = require('../../utils/logger');
const jobLog = require('./orderJobLogService');

const ORDER_JOB_NAMES = {
  GENERATE_INVOICE: 'order_generate_invoice',
  PAYMENT_SUCCESS_NOTIFY: 'order_payment_success_notify',
  POST_PAYMENT_AUTO_ASSIGN: 'order_post_payment_auto_assign',
};

/**
 * BullMQ entrypoint: logging, idempotency, then {@link runOrderJob}.
 * @param {import('bullmq').Job} job
 */
async function processOrderJobFromBull(job) {
  const name = job.name;
  const data = job.data || {};
  const orderId = data.orderId != null ? String(data.orderId) : '';
  if (!orderId) {
    throw new Error('order_jobs: missing data.orderId');
  }

  if (await jobLog.isAlreadySuccessful({ jobName: name, orderId })) {
    return { ok: true, skipped: true, reason: 'job_log_success' };
  }

  const maxAttempts = Math.max(1, Number(job.opts && job.opts.attempts) || 5);
  const attemptsMade = Math.max(0, Number(job.attemptsMade) || 0);

  await jobLog.recordExecutionStart({
    jobName: name,
    orderId,
    bullJobId: job.id != null ? String(job.id) : '',
    attemptsMade,
    maxAttempts,
  });

  try {
    const result = await runOrderJob(name, data);
    if (result && result.ok === false) {
      throw new Error(String(result.reason || 'job_failed'));
    }
    await jobLog.recordExecutionSuccess({ jobName: name, orderId });
    return result;
  } catch (err) {
    await jobLog.recordRetryableError({
      jobName: name,
      orderId,
      errorMessage: err && err.message ? err.message : String(err),
      retryCount: attemptsMade,
    });
    throw err;
  }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} data
 */
async function runOrderJob(name, data) {
  if (name === ORDER_JOB_NAMES.GENERATE_INVOICE) {
    const orderId = data && data.orderId;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return { ok: false, reason: 'bad_order_id' };
    }
    await generateInvoiceForOrderIfNeeded(orderId);
    return { ok: true };
  }

  if (name === ORDER_JOB_NAMES.PAYMENT_SUCCESS_NOTIFY) {
    const orderId = data && data.orderId;
    const userId = data && data.userId;
    if (!orderId || !userId) return { ok: false, reason: 'missing_ids' };
    const amt = Number(data.amount != null ? data.amount : 0);
    await createNotification({
      userId,
      role: 'user',
      title: 'Payment successful',
      message: `Payment received for your order. Amount: ₹${amt.toFixed(2)}.`,
      type: 'payment_success',
      event: 'payment_success',
      data: { orderId: String(orderId), amount: amt },
      dedupeKey: `payment_success_${String(orderId)}`,
    });
    return { ok: true };
  }

  if (name === ORDER_JOB_NAMES.POST_PAYMENT_AUTO_ASSIGN) {
    const orderId = data && data.orderId;
    if (!orderId || !mongoose.Types.ObjectId.isValid(String(orderId))) {
      return { ok: false, reason: 'bad_order_id' };
    }
    await runPostPaymentAutoAssign(String(orderId));
    return { ok: true };
  }

  return { ok: false, reason: 'unknown_job', name };
}

async function runPostPaymentAutoAssign(orderId) {
  try {
    const orderController = require('../../controllers/orderController');
    await orderController.autoAssignAgent(orderId);
    const afterAssign = await Order.findById(orderId).lean();
    if (afterAssign && afterAssign.agent) {
      const ag = await User.findById(afterAssign.agent).select('commissionPercent role').lean();
      const t = Number(afterAssign.finalCalculatedPrice ?? afterAssign.totalPrice ?? afterAssign.amount ?? 0);
      const split = splitOrderTotalForCommission(t, ag);
      await Order.findByIdAndUpdate(
        orderId,
        { $set: { platformFee: split.platformFee, agentEarning: split.agentEarning } },
        { runValidators: false }
      );
    }
    const repop = await Order.findById(orderId)
      .populate('service', 'name')
      .populate(
        'agent',
        'shopName phone address city state pincode isApproved avgRating totalReviews rating completedOrders cancelledOrders agentLevel isRestricted activeOrders'
      )
      .lean();
    const io2 = ioSingleton.getIo();
    if (io2 && repop) {
      emitOrderUpdateFromPayment(io2, orderController.formatOrder(repop, { includeUser: true }));
    }
  } catch (e) {
    logPaymentFailure('post_payment_auto_assign', e, { orderId: String(orderId) });
    throw e;
  }
}

module.exports = {
  ORDER_JOB_NAMES,
  runOrderJob,
  processOrderJobFromBull,
};
