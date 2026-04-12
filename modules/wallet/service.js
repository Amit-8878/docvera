/**
 * Wallet domain — credits, debits, agent release (existing `walletService` + `utils/wallet`).
 */

module.exports = {
  get walletService() {
    return require('../../services/walletService');
  },
  get walletUtils() {
    return require('../../utils/wallet');
  },
};
