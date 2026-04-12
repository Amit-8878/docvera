/**
 * Wallet state: agent balance on User.walletBalance; ledger rows in Transaction.
 * No second wallet collection — this module re-exports the same models.
 */
module.exports = {
  User: require('../../models/User'),
  Transaction: require('../../models/Transaction'),
  Order: require('../../models/Order'),
};
