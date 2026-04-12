const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Service = require('../models/Service');
const { handlePaymentSuccess } = require('../services/paymentSuccess');
const { processPayment: processPaymentOrder } = require('../services/paymentProcessor');
const {
  roundPaiseFromRupees,
  computeWalletRazorpayPaise,
  debitWalletForOrderPayment,
  debitPromoForOrderPayment,
} = require('../utils/paymentProcessor');
const { logPaymentEvent } = require('../services/logService');
const razorpay = require('../services/razorpay');
const { publicRazorpayOrder } = require('../utils/razorpayOrderResponse');
const { creditWallet, debitWallet } = require('../utils/wallet');
const CheckoutSession = require('../models/CheckoutSession');
const { fulfillCheckoutSession } = require('../services/checkoutFulfillmentService');
const ph = require('../modules/payments/parts/paymentPureHelpers');
const paymentService = require('../modules/payments/services/paymentService');
const {
  truncatePaymentErr,
  assertRazorpayPaymentCaptured,
  completePaidOrderAfterGatewayCapture,
  buildOrderCompletionFailureResponse,
} = paymentService;

const isProd = process.env.NODE_ENV === 'production';

/** Razorpay verify applies only to gateway ledger rows. */
const VERIFY_ALLOWED_PAYMENT_METHODS = new Set(['razorpay']);

/**
 * POST /api/payment/create with `{ checkoutSessionId }` — no Order until payment succeeds.
 * Wallet-only path creates Order inside fulfill + handlePaymentSuccess; Razorpay path creates Order on verify.
 */
async function createPaymentFromCheckoutSession(req, res) {
  try {
    const uid = req.user?.userId;
    const checkoutSessionId = String(req.body.checkoutSessionId || '').trim();
    const session = await CheckoutSession.findById(checkoutSessionId).lean();
    if (!session || String(session.user) !== String(uid)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (session.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Checkout already used or expired' });
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Checkout expired' });
    }
    if (!Array.isArray(session.files) || session.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Checkout has no documents' });
    }

    const paymentType = ph.normalizePaymentType(req.body);
    if (paymentType === 'promo') {
      return res.status(400).json({
        success: false,
        message: 'Promo checkout is not supported for this flow; use wallet or online.',
      });
    }

    const amount = Number(session.totalPrice);
    const expectedPaise = roundPaiseFromRupees(amount);
    const user = await User.findById(uid).lean();
    if (!user) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const balancePaise = Math.floor(Number(user.walletBalance || 0) * 100);
    let walletAmountPaiseRaw = req.body.walletAmountPaise;
    if (paymentType === 'online') {
      walletAmountPaiseRaw = 0;
    }
    const { walletPaise, razorpayPaise } = computeWalletRazorpayPaise(
      expectedPaise,
      balancePaise,
      walletAmountPaiseRaw
    );
    const walletUsed = walletPaise / 100;
    const onlineAmount = razorpayPaise / 100;

    if (razorpayPaise === 0) {
      const debitRef = `checkout_wallet_${checkoutSessionId}`;
      if (walletUsed > 0) {
        try {
          await debitWallet(uid, walletUsed, {
            reference: debitRef,
            reason: 'order_payment',
            source: 'checkout_session',
            description: 'Order payment (checkout)',
          });
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: isProd ? 'Insufficient wallet balance' : e.message || 'Wallet payment failed',
          });
        }
      }

      let orderDoc;
      try {
        orderDoc = await fulfillCheckoutSession(checkoutSessionId, uid);
      } catch (e) {
        if (walletUsed > 0) {
          await creditWallet(uid, walletUsed, {
            reference: `refund_${debitRef}`,
            reason: 'wallet_credit',
            source: 'other',
            description: 'Checkout order creation failed — refund',
            incrementTotalEarnings: false,
          }).catch(() => {});
        }
        return res.status(400).json({
          success: false,
          message: isProd ? 'Could not create order' : e.message || 'Checkout failed',
        });
      }

      try {
        await Payment.create({
          userId: uid,
          orderId: orderDoc._id,
          amount: expectedPaise,
          walletAmountPaise: walletPaise,
          paymentMethod: 'wallet',
          razorpayOrderId: '',
          transactionId: 'wallet',
          status: 'success',
        });
      } catch (pe) {
        console.error('Payment record create failed:', pe);
      }

      void logPaymentEvent({
        phase: 'wallet_full_payment',
        userId: uid,
        orderId: orderDoc._id,
        amount: expectedPaise,
        status: 'success',
        meta: { paymentMethod: 'wallet', flow: 'checkout_session' },
        req,
      });

      await handlePaymentSuccess(req, orderDoc._id, uid, 'WALLET', walletUsed);

      return res.json({
        success: true,
        paid: true,
        walletUsed,
        docveraOrderId: String(orderDoc._id),
        orderId: String(orderDoc._id),
        message: 'Paid from wallet',
      });
    }

    if (razorpayPaise < 100) {
      return res.status(400).json({
        success: false,
        message: 'Pay at least ₹1 via Razorpay after wallet, or pay fully from wallet.',
      });
    }

    const receiptBound = `chk_${String(checkoutSessionId).slice(-10)}_${Date.now()}`;
    let rzOrder;
    try {
      rzOrder = await razorpay.orders.create({
        amount: Math.round(razorpayPaise),
        currency: 'INR',
        receipt: receiptBound.slice(0, 40),
        notes: {
          checkoutSessionId: String(checkoutSessionId),
          userId: String(uid),
          flow: 'checkout_razorpay',
        },
      });
    } catch (err) {
      console.error('RAZORPAY ERROR:', err);
      return res.status(500).json({
        success: false,
        message: isProd ? 'Payment service temporarily unavailable' : err.message || 'Payment create failed',
      });
    }

    try {
      await Payment.create({
        userId: uid,
        orderId: null,
        checkoutSessionId: session._id,
        amount: expectedPaise,
        walletAmountPaise: walletPaise,
        paymentMethod: 'razorpay',
        razorpayOrderId: rzOrder.id,
        status: 'created',
      });
      void logPaymentEvent({
        phase: 'razorpay_order_created',
        userId: uid,
        orderId: null,
        amount: expectedPaise,
        status: 'created',
        meta: { razorpayOrderId: rzOrder.id, flow: 'checkout_session' },
        req,
      });
    } catch (pe) {
      console.error('Payment record create failed:', pe);
    }

    const rzPublic = publicRazorpayOrder(rzOrder);
    return res.json({
      success: true,
      payOnline: true,
      amount: onlineAmount,
      orderId: rzOrder.id,
      amountPaise: rzOrder.amount,
      currency: rzPublic.currency,
      walletUsed,
      walletAmountPaise: walletPaise,
      razorpayOrder: rzPublic,
      data: rzPublic,
      checkoutSessionId: String(checkoutSessionId),
      message: 'Pay online to complete',
    });
  } catch (error) {
    console.error('createPaymentFromCheckoutSession:', error);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Payment create failed' : error.message || 'Payment create failed',
    });
  }
}

/**
 * POST /api/payment/create with body `{ orderId }` only — wallet-first split, optional Razorpay for remainder.
 */
async function createPaymentFromOrder(req, res) {
  try {
  const checkoutSessionId = req.body?.checkoutSessionId;
  const uidEarly = req.user?.userId;
  if (
    checkoutSessionId &&
    mongoose.Types.ObjectId.isValid(String(checkoutSessionId)) &&
    uidEarly &&
    (req.body.orderId == null || req.body.orderId === '')
  ) {
    return await createPaymentFromCheckoutSession(req, res);
  }

  const docOrderId = req.body.orderId;
  const uid = req.user?.userId;

  const ord = await Order.findById(docOrderId).lean();
  if (!ord || String(ord.user) !== String(uid)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const result = await processPaymentOrder(docOrderId);
  if (result.alreadyProcessed) {
    return res.json({
      success: true,
      paid: true,
      alreadyProcessed: true,
      message: 'Order already paid',
    });
  }

  const { walletUsed, onlineAmount } = result;

  await Order.findByIdAndUpdate(
    docOrderId,
    {
      $set: {
        walletAmountUsed: walletUsed,
        walletUsed: walletUsed,
        onlinePaid: onlineAmount,
      },
    },
    { runValidators: false }
  );

  const expectedPaise = roundPaiseFromRupees(ord.finalCalculatedPrice ?? ord.totalPrice ?? ord.amount ?? 0);

  if (onlineAmount <= 0) {
    const walletPaise = Math.round(Number(walletUsed) * 100);
    try {
      await Payment.create({
        userId: uid,
        orderId: docOrderId,
        amount: expectedPaise,
        walletAmountPaise: walletPaise,
        paymentMethod: 'wallet',
        razorpayOrderId: '',
        transactionId: 'wallet',
        status: 'success',
      });
    } catch (pe) {
      console.error('Payment record create failed:', pe);
    }

    void logPaymentEvent({
      phase: 'wallet_full_payment',
      userId: uid,
      orderId: docOrderId,
      amount: expectedPaise,
      status: 'success',
      meta: { paymentMethod: 'wallet', flow: 'orderId_only' },
      req,
    });

    await handlePaymentSuccess(req, docOrderId, uid, 'WALLET', walletUsed);

    return res.json({
      success: true,
      paid: true,
      walletUsed,
      message: 'Paid from wallet',
    });
  }

  const razorpayPaise = Math.round(Number(onlineAmount) * 100);
  if (razorpayPaise < 100) {
    return res.status(400).json({
      success: false,
      message: 'Pay at least ₹1 via Razorpay after wallet, or pay fully from wallet.',
    });
  }

  const receiptBound = `doc_${String(docOrderId).slice(-10)}_${Date.now()}`;
  const walletPaise = Math.round(Number(walletUsed) * 100);

  let rzOrder;
  try {
    rzOrder = await razorpay.orders.create({
      amount: Math.round(razorpayPaise),
      currency: 'INR',
      receipt: receiptBound,
      notes: { orderId: String(docOrderId) },
    });
  } catch (err) {
    console.error('RAZORPAY ERROR:', err);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Payment service temporarily unavailable' : err.message || 'Payment create failed',
    });
  }

  try {
    await Payment.create({
      userId: uid,
      orderId: docOrderId,
      amount: expectedPaise,
      walletAmountPaise: walletPaise,
      paymentMethod: 'razorpay',
      razorpayOrderId: rzOrder.id,
      status: 'created',
    });
    void logPaymentEvent({
      phase: 'razorpay_order_created',
      userId: uid,
      orderId: docOrderId,
      amount: expectedPaise,
      status: 'created',
      meta: { razorpayOrderId: rzOrder.id, flow: 'orderId_only' },
      req,
    });
  } catch (pe) {
    console.error('Payment record create failed:', pe);
  }

  const rzPublic = publicRazorpayOrder(rzOrder);
  return res.json({
    success: true,
    payOnline: true,
    amount: onlineAmount,
    orderId: rzOrder.id,
    amountPaise: rzOrder.amount,
    currency: rzPublic.currency,
    walletUsed,
    walletAmountPaise: walletPaise,
    razorpayOrder: rzPublic,
    data: rzPublic,
    message: 'Pay online to complete',
  });
  } catch (error) {
    console.error('createPaymentFromOrder:', error);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Payment create failed' : error.message || 'Payment create failed',
    });
  }
}

exports.createOrder = async (req, res) => {
  try {
    const uid = req.user?.userId;
    const docOrderId = req.body.orderId;
    const rawAmount = req.body.amount;
    const hasAmount =
      rawAmount != null &&
      rawAmount !== '' &&
      !Number.isNaN(Number(rawAmount)) &&
      Number(rawAmount) > 0;

    const checkoutOnly =
      req.body?.checkoutSessionId &&
      mongoose.Types.ObjectId.isValid(String(req.body.checkoutSessionId)) &&
      (!docOrderId || String(docOrderId).trim() === '');
    if (checkoutOnly && uid && !hasAmount) {
      return await createPaymentFromCheckoutSession(req, res);
    }

    if (docOrderId && mongoose.Types.ObjectId.isValid(String(docOrderId)) && uid && !hasAmount) {
      return await createPaymentFromOrder(req, res);
    }

    const amount = req.body.amount;
    if (!amount || Number(amount) <= 0 || Number.isNaN(Number(amount))) {
      return res.status(400).json({ success: false, message: 'Amount missing or invalid' });
    }
    const amountPaise = ph.intPaise(amount);
    if (!amountPaise) {
      return res.status(400).json({ success: false, message: 'Amount missing or invalid' });
    }
    if (amountPaise > 500000000) {
      return res.status(400).json({ success: false, message: 'Amount out of allowed range' });
    }

    /** Legacy: Razorpay order without DOCVERA order binding (wallet top-up when `uid` is present). */
    if (!docOrderId || !mongoose.Types.ObjectId.isValid(String(docOrderId)) || !uid) {
      const receiptRaw = req.body.receipt;
      const receipt =
        typeof receiptRaw === 'string' && receiptRaw.trim().length > 0
          ? receiptRaw.trim().slice(0, 40)
          : `order_rcptid_${Date.now()}`.slice(0, 40);
    const options = {
        amount: amountPaise,
        currency: 'INR',
        receipt,
      };
      if (uid) {
        options.notes = { purpose: 'wallet_topup' };
      }
      let rzOrder;
      try {
        rzOrder = await razorpay.orders.create(options);
      } catch (error) {
        console.error('RAZORPAY ERROR:', error);
        return res.status(500).json({
          success: false,
          message: isProd ? 'Payment service temporarily unavailable' : error.message || 'Payment create failed',
        });
      }
      if (uid) {
        try {
          await Payment.create({
            userId: uid,
            orderId: null,
            amount: amountPaise,
            paymentMethod: 'razorpay',
            razorpayOrderId: rzOrder.id,
            status: 'created',
          });
          void logPaymentEvent({
            phase: 'razorpay_wallet_topup_order_created',
            userId: uid,
            orderId: null,
            amount: amountPaise,
            status: 'created',
            meta: { razorpayOrderId: rzOrder.id },
            req,
          });
        } catch (pe) {
          console.error('Payment record create failed:', pe);
        }
      }
      const rzPublic = publicRazorpayOrder(rzOrder);
      return res.json({
        success: true,
        orderId: rzOrder.id,
        amount: rzOrder.amount,
        currency: rzPublic?.currency,
        razorpayOrder: rzPublic,
        data: rzPublic || { orderId: rzOrder.id, amount: rzOrder.amount },
        message: 'Payment order created',
      });
    }

    const ord = await Order.findById(docOrderId).lean();
    if (!ord || String(ord.user) !== String(uid)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const expectedPaise = roundPaiseFromRupees(ord.finalCalculatedPrice ?? ord.totalPrice ?? ord.amount ?? 0);
    if (Math.abs(expectedPaise - amountPaise) > 1) {
      return res.status(400).json({ success: false, message: 'Amount does not match order total' });
    }

    const me = await User.findById(uid).lean();
    /** Main wallet only — promoBalance is never mixed into this split. */
    const balancePaise = Math.floor(Number(me.walletBalance || 0) * 100);
    const paymentType = ph.normalizePaymentType(req.body);

    /**
     * promo: pay full order from promoBalance when it covers the total.
     * If insufficient, fall through to real wallet + Razorpay (same as wallet path).
     */
    let promoFallbackToReal = false;
    if (paymentType === 'promo') {
      const totalRupees = Number((expectedPaise / 100).toFixed(2));
      const promoBal = Number(me.promoBalance || 0);
      if (promoBal + 1e-9 >= totalRupees) {
        try {
          await debitPromoForOrderPayment(uid, docOrderId, totalRupees);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: isProd ? 'Promo payment failed' : e.message || 'Promo payment failed',
          });
        }

        try {
          await Payment.create({
            userId: uid,
            orderId: docOrderId,
            amount: expectedPaise,
            walletAmountPaise: 0,
            paymentMethod: 'promo',
            razorpayOrderId: '',
            transactionId: 'promo',
            status: 'success',
          });
        } catch (pe) {
          console.error('Payment record create failed:', pe);
        }

        void logPaymentEvent({
          phase: 'promo_full_payment',
          userId: uid,
          orderId: docOrderId,
          amount: expectedPaise,
          status: 'success',
          meta: { paymentMethod: 'promo' },
          req,
        });

        try {
          await handlePaymentSuccess(req, docOrderId, uid, 'promo', 0, totalRupees);
        } catch (e) {
          console.error('handlePaymentSuccess after promo', e);
          return res.status(500).json({
            success: false,
            message: isProd ? 'Payment settlement failed' : e.message || 'Payment settlement failed',
          });
        }

        return res.json({
          success: true,
          walletOnly: true,
          promoOnly: true,
          amount: 0,
          walletAmountPaise: 0,
          message: 'Paid from promo balance',
        });
      }
      promoFallbackToReal = true;
    }

    let walletAmountPaiseRaw = req.body.walletAmountPaise;
    /** online: gateway only — ignore any walletAmountPaise from the client. */
    if (paymentType === 'online') {
      walletAmountPaiseRaw = 0;
    } else if (promoFallbackToReal) {
      const rawW = req.body.walletAmountPaise;
      if (rawW == null || rawW === '') {
        walletAmountPaiseRaw = Math.min(balancePaise, expectedPaise);
      }
    }

    /**
     * wallet / online (remainder): split uses walletBalance only; promoBalance is never applied here.
     * Full wallet settlement (razorpayPaise === 0) debits walletBalance via debitWalletForOrderPayment only.
     */
    const { walletPaise, razorpayPaise } = computeWalletRazorpayPaise(
      expectedPaise,
      balancePaise,
      walletAmountPaiseRaw
    );

    if (razorpayPaise === 0) {
      const walletRupees = walletPaise / 100;
      try {
        await debitWalletForOrderPayment(uid, docOrderId, walletRupees);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: isProd ? 'Wallet payment failed' : e.message || 'Wallet payment failed',
        });
      }

      await Payment.create({
        userId: uid,
        orderId: docOrderId,
        amount: expectedPaise,
        walletAmountPaise: walletPaise,
        paymentMethod: 'wallet',
        razorpayOrderId: '',
        transactionId: 'wallet',
        status: 'success',
      });

      void logPaymentEvent({
        phase: 'wallet_full_payment',
        userId: uid,
        orderId: docOrderId,
        amount: expectedPaise,
        status: 'success',
        meta: { paymentMethod: 'wallet' },
        req,
      });

      await handlePaymentSuccess(req, docOrderId, uid, 'wallet', walletRupees);

      return res.json({
        success: true,
        walletOnly: true,
        amount: 0,
        walletAmountPaise: walletPaise,
        message: 'Paid from wallet',
      });
    }

    if (razorpayPaise < 100) {
      return res.status(400).json({
        success: false,
        message: 'Pay at least ₹1 via Razorpay after wallet, or pay fully from wallet.',
      });
    }

    const receiptBound =
      typeof req.body.receipt === 'string' && req.body.receipt.trim().length > 0
        ? req.body.receipt.trim().slice(0, 40)
        : `doc_${String(docOrderId).slice(-10)}_${Date.now()}`;
    const rzAmount = Math.round(razorpayPaise);
    let rzOrder;
    try {
      rzOrder = await razorpay.orders.create({
        amount: rzAmount,
        currency: 'INR',
        receipt: receiptBound,
        notes: { orderId: String(docOrderId) },
      });
    } catch (error) {
      console.error('RAZORPAY ERROR:', error);
      return res.status(500).json({
        success: false,
        message: isProd ? 'Payment service temporarily unavailable' : error.message || 'Payment create failed',
      });
    }

    try {
      await Payment.create({
        userId: uid,
        orderId: docOrderId,
        amount: expectedPaise,
        walletAmountPaise: walletPaise,
        paymentMethod: 'razorpay',
        razorpayOrderId: rzOrder.id,
        status: 'created',
      });
      void logPaymentEvent({
        phase: 'razorpay_order_created',
        userId: uid,
        orderId: docOrderId,
        amount: expectedPaise,
        status: 'created',
        meta: { razorpayOrderId: rzOrder.id },
        req,
      });
    } catch (pe) {
      console.error('Payment record create failed:', pe);
    }

    const rzPublic = publicRazorpayOrder(rzOrder);
    return res.json({
      success: true,
      orderId: rzOrder.id,
      amount: rzOrder.amount,
      currency: rzPublic.currency,
      walletAmountPaise: walletPaise,
      razorpayOrder: rzPublic,
      data: rzPublic,
      message: 'Payment order created',
    });
  } catch (error) {
    console.error('RAZORPAY ERROR:', error);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Payment service temporarily unavailable' : error.message || 'Payment create failed',
    });
  }
};

exports.retryCheckoutOrderAfterPayment = async (req, res) => {
  try {
    const uid = req.user?.userId;
    if (!uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const razorpayOrderId = String(req.body?.razorpayOrderId || '').trim();
    if (!razorpayOrderId) {
      return res.status(400).json({ success: false, message: 'razorpayOrderId required' });
    }
    const paymentRow = await Payment.findOne({ razorpayOrderId }).lean();
    if (!paymentRow || String(paymentRow.userId) !== String(uid)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const st = String(paymentRow.status);
    if (!['success_pending_order', 'created'].includes(st)) {
      return res.status(400).json({
        success: false,
        message: 'No pending order completion for this payment',
        status: paymentRow.status,
      });
    }
    const rzPayId =
      String(req.body?.razorpay_payment_id || '').trim() ||
      String(paymentRow.transactionId || paymentRow.paymentId || '').trim();
    if (!rzPayId) {
      return res.status(400).json({
        success: false,
        message: 'Missing razorpay_payment_id or stored capture reference',
      });
    }
    try {
      const { orderId } = await completePaidOrderAfterGatewayCapture(req, uid, razorpayOrderId, rzPayId);
      void logPaymentEvent({
        phase: 'retry_checkout_order_success',
        userId: uid,
        orderId,
        status: 'success',
        meta: { razorpayOrderId, razorpayPaymentId: rzPayId },
        req,
      });
      console.log(
        JSON.stringify({
          type: 'payment_retry_checkout_success',
          phase: 'retry-checkout-order',
          docveraOrderId: String(orderId),
          razorpayOrderId: String(razorpayOrderId),
          razorpayPaymentId: String(rzPayId),
        })
      );
      return res.json({
        success: true,
        message: 'Order created',
        orderId,
        docveraOrderId: orderId,
      });
    } catch (e) {
      const body = await buildOrderCompletionFailureResponse(razorpayOrderId, e);
      return res.status(200).json(body);
    }
  } catch (err) {
    console.error('RETRY CHECKOUT ORDER ERROR:', err);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Retry failed' : err.message || 'Retry failed',
    });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId, paymentId } = req.body;
    const uid = req.user?.userId;
    if (!uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const mockAllowed = process.env.MOCK_PAYMENT_VERIFY === '1';
    if (
      mockAllowed &&
      orderId &&
      mongoose.Types.ObjectId.isValid(String(orderId)) &&
      paymentId != null &&
      String(paymentId).trim() !== '' &&
      !razorpay_signature
    ) {
      const existingOrd = await Order.findById(orderId).lean();
      if (!existingOrd || String(existingOrd.user) !== String(uid)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      if (['held', 'paid', 'released'].includes(String(existingOrd.paymentStatus || ''))) {
        console.log('[safety] verify duplicate ignored', { orderId: String(orderId) });
        return res.json({ success: true, message: 'Already verified' });
      }
      const svcId = existingOrd.service;
      if (!svcId || !mongoose.Types.ObjectId.isValid(String(svcId))) {
        return res.status(400).json({ success: false, message: 'Invalid service' });
      }
      const svcCheck = await Service.findById(svcId).lean();
      if (!svcCheck) {
        return res.status(400).json({ success: false, message: 'Service not found' });
      }
      const walletRupees = Number(existingOrd.walletAmountUsed || existingOrd.walletUsed || 0);
      let settledMock;
      try {
        settledMock = await handlePaymentSuccess(req, orderId, uid, String(paymentId).trim(), walletRupees);
      } catch (e) {
        console.error('[payment verify mock] handlePaymentSuccess:', e?.stack || e?.message || e);
        return res.status(500).json({ success: false, message: 'Order creation failed after payment' });
      }
      if (!settledMock) {
        console.error('[payment verify mock] handlePaymentSuccess returned null', { orderId: String(orderId) });
        return res.status(500).json({ success: false, message: 'Order creation failed after payment' });
      }
      void logPaymentEvent({
        phase: 'mock_verify_success',
        userId: uid,
      orderId,
        status: 'success',
        meta: { paymentId: String(paymentId) },
        req,
      });
      return res.json({ success: true, message: 'Payment verified' });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const hasPaymentTypeHint =
      (req.body?.paymentType != null && String(req.body.paymentType).trim() !== '') ||
      (req.body?.paymentMode != null && String(req.body.paymentMode).trim() !== '');
    if (hasPaymentTypeHint) {
      const n = ph.normalizePaymentType(req.body);
      if (!['wallet', 'online'].includes(n)) {
        return res.status(400).json({ success: false, message: 'Invalid payment type for verification' });
      }
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      const paymentRow = await Payment.findOne({ razorpayOrderId: razorpay_order_id }).lean();
      if (paymentRow && String(paymentRow.userId) !== String(uid)) {
        console.warn(
          JSON.stringify({ type: 'payment_verify_user_mismatch', razorpay_order_id: String(razorpay_order_id) })
        );
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      if (!paymentRow) {
        void logPaymentEvent({
          phase: 'razorpay_verify_no_ledger_row',
          userId: uid,
          status: 'failed',
          meta: { razorpayOrderId: razorpay_order_id },
          req,
        });
        return res.status(400).json({ success: false, message: 'Payment order not found' });
      }

      if (!paymentRow.userId || !mongoose.Types.ObjectId.isValid(String(paymentRow.userId))) {
        return res.status(400).json({ success: false, message: 'Invalid payment record' });
      }

      const paymentMethodNorm = String(paymentRow.paymentMethod || '').toLowerCase().trim();
      if (!VERIFY_ALLOWED_PAYMENT_METHODS.has(paymentMethodNorm)) {
        void logPaymentEvent({
          phase: 'razorpay_verify_invalid_payment_method',
          userId: uid,
          status: 'failed',
          meta: { razorpayOrderId: razorpay_order_id, paymentMethod: paymentRow.paymentMethod },
          req,
        });
        return res.status(400).json({ success: false, message: 'Invalid payment type for verification' });
      }

      try {
        await assertRazorpayPaymentCaptured(razorpay_order_id, razorpay_payment_id);
      } catch (vrErr) {
        void logPaymentEvent({
          phase: 'razorpay_verify_gateway_invalid',
          userId: uid,
          status: 'failed',
          meta: { razorpayOrderId: razorpay_order_id, reason: truncatePaymentErr(vrErr) },
          req,
        });
        return res.status(400).json({
          success: false,
          message: isProd ? 'Payment could not be verified with the gateway' : truncatePaymentErr(vrErr),
        });
      }

      const isWalletTopup =
        !paymentRow.orderId &&
        (!paymentRow.checkoutSessionId ||
          !mongoose.Types.ObjectId.isValid(String(paymentRow.checkoutSessionId)));

      if (String(paymentRow.status) === 'success') {
        const oid =
          paymentRow.orderId && mongoose.Types.ObjectId.isValid(String(paymentRow.orderId))
            ? String(paymentRow.orderId)
            : null;
        return res.json({
          success: true,
          message: 'Already verified',
          ...(oid ? { orderId: oid, docveraOrderId: oid } : {}),
        });
      }

      if (isWalletTopup) {
        if (String(paymentRow.status) !== 'created') {
          return res.status(400).json({
            success: false,
            message: 'Invalid payment state',
            status: paymentRow.status,
          });
        }
        const rupees = Number(paymentRow.amount) / 100;
        if (Number.isFinite(rupees) && rupees > 0) {
          try {
            const out = await creditWallet(uid, rupees, {
              reference: `rzpay_${razorpay_payment_id}`,
              reason: 'wallet_topup',
              source: 'wallet_topup',
              description: 'Razorpay wallet top-up',
              incrementTotalEarnings: false,
            });
            await Payment.findOneAndUpdate(
              { razorpayOrderId: razorpay_order_id },
              {
                $set: {
                  transactionId: razorpay_payment_id,
                  paymentId: razorpay_payment_id,
                  status: 'success',
                },
              },
              { new: false }
            ).catch(() => {});
            void logPaymentEvent({
              phase: 'razorpay_wallet_topup_verified',
              userId: uid,
              orderId: null,
              amount: paymentRow.amount,
              status: 'success',
              meta: {
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                credited: out.credited,
                skipped: out.skipped,
              },
              req,
            });
          } catch (e) {
            console.error('[payment verify] wallet top-up credit failed:', e?.stack || e?.message || e);
            return res.status(500).json({
              success: false,
              message: isProd ? 'Payment completion failed' : e.message || 'Payment completion failed',
            });
          }
        } else {
          await Payment.findOneAndUpdate(
            { razorpayOrderId: razorpay_order_id },
            {
              $set: {
                transactionId: razorpay_payment_id,
                paymentId: razorpay_payment_id,
                status: 'success',
              },
            },
            { new: false }
          ).catch(() => {});
        }
        return res.json({
          success: true,
          message: 'Payment verified',
        });
      }

      const payId = String(razorpay_payment_id || '').trim();
      console.log('VERIFY START', payId);

      const existingByPayment = await Order.findOne({ user: uid, paymentId: payId }).lean();
      if (existingByPayment && mongoose.Types.ObjectId.isValid(String(existingByPayment._id))) {
        await Payment.findOneAndUpdate(
          { razorpayOrderId: razorpay_order_id },
          {
            $set: {
              transactionId: payId,
              paymentId: payId,
              orderId: existingByPayment._id,
              lastOrderCreationError: '',
            },
          },
          { new: false }
        ).catch(() => {});
        try {
          const { orderId: oid } = await completePaidOrderAfterGatewayCapture(
            req,
            uid,
            razorpay_order_id,
            payId
          );
          void logPaymentEvent({
            phase: 'razorpay_verify_success',
            userId: uid,
            orderId: oid,
            amount: paymentRow.amount,
            status: 'success',
            meta: {
              razorpayOrderId: razorpay_order_id,
              razorpayPaymentId: payId,
              idempotentPaymentId: true,
            },
            req,
          });
          console.log(
            JSON.stringify({
              type: 'payment_verify_success',
              phase: 'verify',
              docveraOrderId: String(oid),
              razorpayOrderId: String(razorpay_order_id),
              razorpayPaymentId: payId,
            })
          );
          return res.json({
            success: true,
            message: 'Payment verified',
            orderId: oid,
            docveraOrderId: oid,
          });
        } catch (e) {
          console.error('ORDER FAIL', e);
          await Payment.findOneAndUpdate(
            { razorpayOrderId: razorpay_order_id },
            {
              $set: {
                transactionId: payId,
                paymentId: payId,
                status: 'success_pending_order',
                lastOrderCreationError: truncatePaymentErr(e),
              },
            },
            { new: false }
          ).catch(() => {});
          console.log(
            JSON.stringify({
              type: 'payment_verify_order_pending',
              phase: 'verify',
              razorpayOrderId: String(razorpay_order_id),
              razorpayPaymentId: payId,
              docveraOrderId: null,
            })
          );
          return res.status(200).json(await buildOrderCompletionFailureResponse(razorpay_order_id, e));
        }
      }

      const st = String(paymentRow.status);
      if (!['created', 'success_pending_order'].includes(st)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment state',
          status: paymentRow.status,
        });
      }

      try {
        const { orderId: oid } = await completePaidOrderAfterGatewayCapture(
          req,
          uid,
          razorpay_order_id,
          payId
        );
        void logPaymentEvent({
          phase: 'razorpay_verify_success',
          userId: uid,
          orderId: oid,
          amount: paymentRow.amount,
          status: 'success',
          meta: { razorpayOrderId: razorpay_order_id, razorpayPaymentId: payId },
          req,
        });
        console.log(
          JSON.stringify({
            type: 'payment_verify_success',
            phase: 'verify',
            docveraOrderId: String(oid),
            razorpayOrderId: String(razorpay_order_id),
            razorpayPaymentId: payId,
          })
        );
        return res.json({
          success: true,
          message: 'Payment verified',
          orderId: oid,
          docveraOrderId: oid,
        });
      } catch (e) {
        console.error('ORDER FAIL', e);
        await Payment.findOneAndUpdate(
          { razorpayOrderId: razorpay_order_id },
          {
            $set: {
              transactionId: payId,
              paymentId: payId,
              status: 'success_pending_order',
              lastOrderCreationError: truncatePaymentErr(e),
            },
          },
          { new: false }
        ).catch(() => {});
        console.log(
          JSON.stringify({
            type: 'payment_verify_order_pending',
            phase: 'verify',
            razorpayOrderId: String(razorpay_order_id),
            razorpayPaymentId: payId,
            docveraOrderId: null,
          })
        );
        return res.status(200).json(await buildOrderCompletionFailureResponse(razorpay_order_id, e));
      }
    }

    await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { $set: { status: 'failed' } },
      { new: false }
    ).catch(() => {});

    void logPaymentEvent({
      phase: 'razorpay_verify_failed',
      userId: uid,
      orderId: orderId && mongoose.Types.ObjectId.isValid(orderId) ? orderId : null,
      status: 'failed',
      meta: { razorpayOrderId: razorpay_order_id, reason: 'bad_signature' },
      req,
    });

    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
  } catch (err) {
    console.error('VERIFY ERROR:', err);
    res.status(500).json({
      success: false,
      message: isProd ? 'Verification failed' : err.message || 'Verification failed',
    });
  }
};

/**
 * GET payment row by Mongo payment id or DOCVERA order id.
 */
exports.getPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }

    let p = await Payment.findById(id).lean();
    if (!p) {
      p = await Payment.findOne({ orderId: id }).sort({ createdAt: -1 }).lean();
    }
    if (!p) {
      return res.status(404).json({ message: 'Not found' });
    }

    const uid = req.user?.userId;
    const role = req.user?.role;
    if (!uid || (String(p.userId) !== String(uid) && role !== 'admin')) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json({
      payment: {
        id: String(p._id),
        userId: String(p.userId),
        orderId: p.orderId ? String(p.orderId) : null,
        checkoutSessionId: p.checkoutSessionId ? String(p.checkoutSessionId) : null,
        amount: p.amount,
        walletAmountPaise: p.walletAmountPaise != null ? Number(p.walletAmountPaise) : 0,
        paymentMethod: p.paymentMethod,
        status: p.status,
        transactionId: p.transactionId,
        razorpayOrderId: p.razorpayOrderId,
        lastOrderCreationError: p.lastOrderCreationError || '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: isProd ? 'Failed to load payment' : err.message || 'Failed' });
  }
};
