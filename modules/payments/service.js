/**
 * Payment domain services — delegates to existing services.
 */

module.exports = {
  get handlePaymentSuccess() {
    return require('../../services/paymentSuccess').handlePaymentSuccess;
  },
  get handlePaymentSuccessWebhook() {
    return require('../../services/paymentSuccess').handlePaymentSuccessWebhook;
  },
  get processPayment() {
    return require('../../services/paymentProcessor').processPayment;
  },
};
