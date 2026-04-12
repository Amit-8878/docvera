const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../../models/Order');
const OrderPayment = require('../../models/Payment');
const Payment = require('../../models/payment.model');
const razorpay = require('../../services/razorpay');
const { publicRazorpayOrder } = require('../../utils/razorpayOrderResponse');
const { handlePaymentSuccessWebhook } = require('../../services/paymentSuccess');
const { creditWallet } = require('../../utils/wallet');
const { fulfillCheckoutSession } = require('../../services/checkoutFulfillmentService');
const { debitWalletForOrderPayment } = require('../../utils/paymentProcessor');
/** Single implementation: signature, Payment row, wallet debit, mock path, handlePaymentSuccess */
const basePaymentController = require('../../controllers/paymentController');

const isProd = process.env.NODE_ENV === 'production';

function timingSafeHexEqual(a, b) {
  try {
    const ba = Buffer.from(String(a).trim(), 'hex');
    const bb = Buffer.from(String(b).trim(), 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * POST /api/payment/webhook and POST /api/payments/webhook — raw Buffer from express.raw (see server.js, before express.json).
 */
exports.webhook = async (req, res) => {
  try {
    console.log('Webhook received');

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    const signature = req.get('x-razorpay-signature') || req.headers['x-razorpay-signature'];

    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      console.error('[Razorpay webhook] RAZORPAY_WEBHOOK_SECRET is not set');
      return res.status(200).send('OK');
    }

    const expectedSig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const sigOk = signature && timingSafeHexEqual(expectedSig, String(signature).trim());
    if (!sigOk) {
      console.log('[Razorpay webhook] invalid signature (ack 200)');
      return res.status(200).send('OK');
    }

    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      console.error('[Razorpay webhook] JSON parse error:', e.message);
      return res.status(200).send('OK');
    }

    if (body.event !== 'payment.captured') {
      return res.status(200).send('OK');
    }

    try {
      // Same shape as req.body after JSON parse (webhook uses express.raw — req.body is Buffer until parsed above).
      const payment = body.payload?.payment?.entity;
      if (!payment || !payment.id) {
        console.warn('[Razorpay webhook] Invalid payload (missing entity or id)');
        return res.status(200).send('OK');
      }

      const existing = await Payment.findOne({ paymentId: payment.id });
      if (existing) {
        console.log('Duplicate ignored:', payment.id);
        return res.status(200).send('OK');
      }

      await Payment.create({
        paymentId: payment.id,
        orderId: payment.order_id != null ? String(payment.order_id) : '',
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        email: payment.email,
        contact: payment.contact,
        raw: payment,
      });
      console.log('Payment saved:', payment.id);

      const paymentId = payment.id;
      const rzOrder = payment.order_id != null ? String(payment.order_id) : '';
      let orderId = payment.notes && (payment.notes.orderId || payment.notes.order_id);
      if (orderId) orderId = String(orderId).trim();
      if (!orderId && rzOrder) {
        const row = await OrderPayment.findOne({ razorpayOrderId: rzOrder }).sort({ createdAt: -1 }).lean();
        if (row?.orderId) orderId = String(row.orderId);
      }

      if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
        const orderPeek = await Order.findById(orderId).lean();
        const settled =
          orderPeek &&
          orderPeek.paymentId === paymentId &&
          ['held', 'released', 'paid'].includes(String(orderPeek.paymentStatus || ''));
        if (orderPeek && !settled) {
          await handlePaymentSuccessWebhook(orderId, paymentId);
        }
      }

      if (rzOrder) {
        await OrderPayment.findOneAndUpdate(
          { razorpayOrderId: rzOrder },
          {
            $set: {
              transactionId: paymentId,
              status: 'success',
              amount: Number(payment.amount) || 0,
              method: String(payment.method || 'unknown'),
              paymentMethod: 'razorpay',
              paymentId: paymentId,
              currency: String(payment.currency || 'INR'),
              email: payment.email != null ? String(payment.email) : '',
              contact: payment.contact != null ? String(payment.contact) : '',
            },
          },
          { sort: { createdAt: -1 } }
        ).catch((e) => console.error('[Razorpay webhook] OrderPayment update:', e.message));

        const ledgerRow = await OrderPayment.findOne({ razorpayOrderId: rzOrder }).sort({ createdAt: -1 }).lean();
        if (
          ledgerRow &&
          ledgerRow.userId &&
          (!ledgerRow.orderId || !mongoose.Types.ObjectId.isValid(String(ledgerRow.orderId)))
        ) {
          const chk = ledgerRow.checkoutSessionId;
          if (chk && mongoose.Types.ObjectId.isValid(String(chk))) {
            try {
              const created = await fulfillCheckoutSession(String(chk), ledgerRow.userId);
              const oid = String(created._id);
              await OrderPayment.findOneAndUpdate(
                { razorpayOrderId: rzOrder },
                { $set: { orderId: created._id, checkoutSessionId: null } },
                { sort: { createdAt: -1 } }
              ).catch((e) => console.error('[Razorpay webhook] OrderPayment checkout bind:', e?.message || e));
              const walletPaise = Number(ledgerRow.walletAmountPaise || 0);
              let walletRupeesUsed = 0;
              if (walletPaise > 0) {
                walletRupeesUsed = walletPaise / 100;
                await debitWalletForOrderPayment(ledgerRow.userId, oid, walletRupeesUsed).catch((e) =>
                  console.error('[Razorpay webhook] wallet debit:', e?.message || e)
                );
              }
              await handlePaymentSuccessWebhook(oid, paymentId);
            } catch (e) {
              console.error('[Razorpay webhook] checkout fulfill:', e?.stack || e?.message || e);
            }
          } else {
            const rupees = Number(ledgerRow.amount ?? payment.amount) / 100;
            if (Number.isFinite(rupees) && rupees > 0) {
              await creditWallet(ledgerRow.userId, rupees, {
                reference: `rzpay_${paymentId}`,
                reason: 'wallet_topup',
                source: 'wallet_topup',
                description: 'Razorpay wallet top-up (webhook)',
                incrementTotalEarnings: false,
              }).catch((e) => console.error('[Razorpay webhook] wallet top-up:', e?.message || e));
            }
          }
        }
      }
    } catch (innerErr) {
      console.error('[Razorpay webhook] payment.captured error:', innerErr?.stack || innerErr?.message || innerErr);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err?.stack || err?.message || err);
    return res.status(200).send('OK');
  }
};

/**
 * Razorpay verify — delegates to `paymentController.verifyPayment` (no duplicate success/wallet logic).
 */
exports.verifyPayment = async (req, res) => {
  return basePaymentController.verifyPayment(req, res);
};

/**
 * Create a Razorpay order. Body: `orderId` (receipt id; Mongo order id when bound to DOCVERA), `amount` in INR (rupees).
 */
exports.createPayment = async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    const uid = req.user?.userId;
    if (!uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rupees = Number(amount);
    if (orderId == null || orderId === '' || !Number.isFinite(rupees) || rupees <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid orderId or amount' });
    }

    let amountPaise = Math.round(rupees * 100);
    if (amountPaise < 100) {
      return res.status(400).json({ success: false, message: 'Minimum amount is ₹1' });
    }
    if (amountPaise > 500000000) {
      return res.status(400).json({ success: false, message: 'Amount out of allowed range' });
    }

    const receipt = String(orderId)
      .trim()
      .replace(/\s/g, '')
      .slice(0, 40) || `rcp_${Date.now()}`;

    if (mongoose.Types.ObjectId.isValid(String(orderId))) {
      const ord = await Order.findById(orderId).lean();
      if (!ord || String(ord.user) !== String(uid)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      const expected = Number(ord.finalCalculatedPrice ?? ord.totalPrice ?? ord.amount ?? 0);
      const expectedPaise = Math.round(expected * 100);
      if (Math.abs(expectedPaise - amountPaise) > 1) {
        return res.status(400).json({ success: false, message: 'Amount does not match order total' });
      }
    }

    const options = {
      amount: Math.round(amountPaise),
      currency: 'INR',
      receipt,
    };
    if (mongoose.Types.ObjectId.isValid(String(orderId))) {
      options.notes = { orderId: String(orderId) };
    }

    const rz = await razorpay.orders.create(options);

    if (mongoose.Types.ObjectId.isValid(String(orderId))) {
      try {
        await OrderPayment.create({
          userId: uid,
          orderId,
          amount: amountPaise,
          walletAmountPaise: 0,
          paymentMethod: 'razorpay',
          razorpayOrderId: rz.id,
          status: 'created',
        });
      } catch (pe) {
        console.error('Payment record create failed:', pe);
      }
    }

    const rzPublic = publicRazorpayOrder(rz);
    return res.json({
      success: true,
      razorpayOrderId: rz.id,
      orderId: rz.id,
      amount: rz.amount,
      currency: rzPublic.currency,
      razorpayOrder: rzPublic,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('createPayment:', err);
    return res.status(500).json({
      success: false,
      message: isProd ? 'Payment create failed' : err.message || 'Payment create failed',
    });
  }
};
