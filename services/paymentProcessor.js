const { processPayment: processPaymentUtil, roundPaiseFromRupees } = require('../utils/paymentProcessor');

/**
 * Wallet-first split for an order; debits wallet when executeDebit is true (default).
 * Single entry used by POST /api/payment/create (orderId-only flow).
 */
async function processPayment(orderId, options = {}) {
  const executeDebit = options.executeDebit !== false;
  return processPaymentUtil(orderId, { executeDebit });
}

module.exports = {
  processPayment,
  roundPaiseFromRupees,
};
