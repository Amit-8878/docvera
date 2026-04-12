/**
 * Payment business logic: Razorpay capture assertion, post-gateway settlement, error payloads.
 * Controllers remain HTTP-only; this module has no req/res (except `req` passed through for logging in complete flow).
 */
const mongoose = require('mongoose');
const Order = require('../../../models/Order');
const Payment = require('../../../models/Payment');
const Service = require('../../../models/Service');
const CheckoutSession = require('../../../models/CheckoutSession');
const { handlePaymentSuccess } = require('../../../services/paymentSuccess');
const { debitWalletForOrderPayment } = require('../../../utils/paymentProcessor');
const razorpay = require('../../../services/razorpay');
const { fulfillCheckoutSession } = require('../../../services/checkoutFulfillmentService');
const ph = require('../parts/paymentPureHelpers');

function truncatePaymentErr(e, max = 500) {
  const s = e && (e.stack || e.message) ? String(e.stack || e.message) : String(e);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * After HMAC verification: confirm payment exists at Razorpay, is captured, and belongs to our order.
 */
async function assertRazorpayPaymentCaptured(razorpay_order_id, razorpay_payment_id) {
  const pay = await razorpay.payments.fetch(razorpay_payment_id);
  if (!pay) throw new Error('Payment not found at gateway');
  const st = String(pay.status || '').toLowerCase();
  if (st !== 'captured') {
    throw new Error(`Payment not captured (status: ${pay.status || 'unknown'})`);
  }
  if (String(pay.order_id || '') !== String(razorpay_order_id)) {
    throw new Error('Payment does not match Razorpay order');
  }
}

/**
 * After Razorpay ids are stored on Payment (`success_pending_order`), create order if needed, debit wallet, settle.
 */
async function completePaidOrderAfterGatewayCapture(req, uid, razorpay_order_id, razorpay_payment_id) {
  console.log(
    JSON.stringify({
      type: 'complete_paid_order_start',
      phase: 'completePaidOrderAfterGatewayCapture',
      razorpayOrderId: String(razorpay_order_id || ''),
      razorpayPaymentId: String(razorpay_payment_id || ''),
      userId: String(uid || ''),
    })
  );
  const row = await Payment.findOne({ razorpayOrderId: razorpay_order_id }).lean();
  if (!row) throw new Error('Payment not found');
  if (String(row.userId) !== String(uid)) throw new Error('Forbidden');

  let effectiveOrderId =
    row.orderId && mongoose.Types.ObjectId.isValid(String(row.orderId)) ? String(row.orderId) : null;

  const csidRaw = row.checkoutSessionId;
  const hasCheckout = csidRaw && mongoose.Types.ObjectId.isValid(String(csidRaw));

  if (!effectiveOrderId && hasCheckout) {
    const csid = String(csidRaw);
    const session = await CheckoutSession.findById(csid).lean();
    if (!session) throw new Error('Checkout session not found');
    if (String(session.user) !== String(uid)) throw new Error('Forbidden');

    if (
      session.status === 'fulfilled' &&
      session.fulfilledOrderId &&
      mongoose.Types.ObjectId.isValid(String(session.fulfilledOrderId))
    ) {
      effectiveOrderId = String(session.fulfilledOrderId);
    } else if (session.status === 'pending') {
      const serviceId = session.service;
      if (!serviceId || !mongoose.Types.ObjectId.isValid(String(serviceId))) {
        throw new Error('Invalid service');
      }
      const serviceDoc = await Service.findById(serviceId).lean();
      if (!serviceDoc) throw new Error('Service not found');
      if (!ph.checkoutSessionHasReadableFile(session)) throw new Error('Uploaded file missing');

      const paymentTypeForLog = ph.normalizePaymentType(req.body);
      console.log(
        '[payment verify] pre_order_create',
        JSON.stringify(
          {
            reqBody: req.body,
            serviceId: serviceId != null ? String(serviceId) : null,
            userId: uid != null ? String(uid) : null,
            file: session.files?.[0] ?? null,
            files: session.files,
            paymentType: paymentTypeForLog,
            paymentTypeRaw: req.body?.paymentType ?? req.body?.paymentMode ?? null,
          },
          null,
          2
        )
      );

      const created = await fulfillCheckoutSession(csid, uid);
      const uidStr = String(uid);
      if (
        !created?.user ||
        String(created.user) !== uidStr ||
        !created.service ||
        !mongoose.Types.ObjectId.isValid(String(created.service)) ||
        created.amount == null ||
        !Number.isFinite(Number(created.amount))
      ) {
        throw new Error('Order missing required fields (user, service, amount)');
      }
      effectiveOrderId = String(created._id);
      await Payment.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        {
          $set: {
            orderId: created._id,
            checkoutSessionId: null,
            lastOrderCreationError: '',
          },
        },
        { new: false }
      ).catch(() => {});
    } else {
      throw new Error('Checkout session is not payable');
    }
  }

  if (!effectiveOrderId) throw new Error('No order to settle');

  const existing = await Order.findById(effectiveOrderId).lean();
  if (!existing) throw new Error('Order not found');
  if (String(existing.user) !== String(uid)) throw new Error('Forbidden');

  const ordServiceId = existing.service;
  if (!ordServiceId || !mongoose.Types.ObjectId.isValid(String(ordServiceId))) {
    throw new Error('Invalid service');
  }
  const ordService = await Service.findById(ordServiceId).lean();
  if (!ordService) throw new Error('Service not found');

  const fresh = await Payment.findOne({ razorpayOrderId: razorpay_order_id }).lean();
  const walletPaise = Number(fresh?.walletAmountPaise || row.walletAmountPaise || 0);
  let walletRupeesUsed = 0;
  if (walletPaise > 0) {
    walletRupeesUsed = walletPaise / 100;
    await debitWalletForOrderPayment(uid, effectiveOrderId, walletRupeesUsed);
  }

  const settled = await handlePaymentSuccess(
    req,
    effectiveOrderId,
    uid,
    razorpay_payment_id,
    walletRupeesUsed
  );
  if (!settled) throw new Error('Settlement failed');

  await Payment.findOneAndUpdate(
    { razorpayOrderId: razorpay_order_id },
    {
      $set: {
        status: 'success',
        lastOrderCreationError: '',
      },
    },
    { new: false }
  ).catch(() => {});

  console.log(
    JSON.stringify({
      type: 'complete_paid_order_done',
      phase: 'completePaidOrderAfterGatewayCapture',
      docveraOrderId: String(effectiveOrderId),
      razorpayOrderId: String(razorpay_order_id || ''),
      razorpayPaymentId: String(razorpay_payment_id || ''),
      checkoutSessionId: row.checkoutSessionId ? String(row.checkoutSessionId) : null,
    })
  );
  return { orderId: effectiveOrderId };
}

/**
 * Persist error on Payment row and return the JSON body for HTTP 200 (client always receives JSON).
 */
async function buildOrderCompletionFailureResponse(razorpay_order_id, err) {
  const msg = truncatePaymentErr(err);
  console.error('ORDER FAIL', err);
  await Payment.findOneAndUpdate(
    { razorpayOrderId: razorpay_order_id },
    { $set: { lastOrderCreationError: msg } },
    { new: false }
  ).catch(() => {});
  return {
    success: false,
    paymentCaptured: true,
    orderCreationFailed: true,
    message: msg || 'Order creation failed after payment',
    razorpayOrderId: razorpay_order_id,
    retryCheckoutOrder: true,
  };
}

module.exports = {
  truncatePaymentErr,
  assertRazorpayPaymentCaptured,
  completePaidOrderAfterGatewayCapture,
  buildOrderCompletionFailureResponse,
};
