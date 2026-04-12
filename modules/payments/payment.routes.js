const express = require('express');

const authMiddleware = require('../../middleware/authMiddleware');
const { requireFeatureEnabled } = require('../../middleware/systemFeatureMiddleware');
const paymentController = require('./payment.controller');
/** Local module: createPayment + verifyPayment (verify delegates to paymentController) */
const paymentsController = require('./controller');

const router = express.Router();

router.get('/config', (req, res) => {
  res.status(200).json({
    keyId: process.env.RAZORPAY_KEY_ID || '',
  });
});

router.post('/create-order', authMiddleware, requireFeatureEnabled('payment_enabled'), paymentController.createOrder);
router.post('/create', authMiddleware, requireFeatureEnabled('payment_enabled'), paymentController.createOrder);

/** Simple Razorpay order: body `{ orderId, amount }` with `amount` in INR rupees. */
router.post(
  '/razorpay-order',
  authMiddleware,
  requireFeatureEnabled('payment_enabled'),
  paymentsController.createPayment
);

router.post('/verify', authMiddleware, requireFeatureEnabled('payment_enabled'), paymentsController.verifyPayment);

router.post(
  '/retry-checkout-order',
  authMiddleware,
  requireFeatureEnabled('payment_enabled'),
  paymentController.retryCheckoutOrderAfterPayment
);

router.get('/status/:id', authMiddleware, paymentController.getPaymentStatus);

module.exports = router;
