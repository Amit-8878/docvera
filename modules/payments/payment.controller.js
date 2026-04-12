const base = require('../../controllers/paymentController');

module.exports = {
  createOrderPayment: base.createOrder,
  createOrder: base.createOrder,
  verifyPayment: base.verifyPayment,
  retryCheckoutOrderAfterPayment: base.retryCheckoutOrderAfterPayment,
  getPaymentStatus: base.getPaymentStatus,
};
