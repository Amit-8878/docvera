/**
 * Order domain services — thin facades over existing implementations (no duplicate logic).
 * Keeps heavy logic in `controllers/orderController` + `services/paymentSuccess`.
 */

function getOrderController() {
  return require('../../controllers/orderController');
}

function getPaymentSuccess() {
  return require('../../services/paymentSuccess');
}

module.exports = {
  getOrderController,
  getPaymentSuccess,
  autoAssignAgent(orderId) {
    return getOrderController().autoAssignAgent(orderId);
  },
  handlePaymentSuccess(req, orderId, uid, paymentIdStr, walletRupeesUsed, promoRupeesUsed) {
    return getPaymentSuccess().handlePaymentSuccess(
      req,
      orderId,
      uid,
      paymentIdStr,
      walletRupeesUsed,
      promoRupeesUsed
    );
  },
};
