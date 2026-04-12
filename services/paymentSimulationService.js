/**
 * @deprecated Simulation removed — real Razorpay verify/webhook + paymentSuccess handle settlement.
 * Kept for any stray requires; commission split lives in orderPaymentSplit.js.
 */
const { splitOrderTotalForCommission } = require('./orderPaymentSplit');

module.exports = {
  splitOrderTotalForCommission,
  isSimulatePaymentAllowed: () => false,
  parseSimulatePaymentFlag: () => false,
  applySimulatedPayment: async () => ({ ok: false, reason: 'simulation_disabled' }),
};
