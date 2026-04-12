/**
 * Central rules: fulfillment (assign, process, complete) requires captured payment and
 * workflow status past the pay wall. Used by order/agent controllers and payment success.
 */

function paymentStatusCaptured(ps) {
  return ['held', 'paid', 'released'].includes(String(ps || ''));
}

/** True when agent/admin may assign, process, or attach final deliverables. */
function orderAllowsFulfillmentWork(order) {
  if (!order) return false;
  if (!paymentStatusCaptured(order.paymentStatus)) return false;
  if (String(order.status || '') === 'pending_payment') return false;
  return true;
}

function paymentRequiredJson() {
  return {
    message: 'Payment required',
    details: 'Payment required',
    errorCode: 'PAYMENT_REQUIRED',
  };
}

function sendPaymentRequired(res) {
  return res.status(402).json(paymentRequiredJson());
}

module.exports = {
  paymentStatusCaptured,
  orderAllowsFulfillmentWork,
  paymentRequiredJson,
  sendPaymentRequired,
};
