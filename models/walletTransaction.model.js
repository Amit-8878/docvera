/**
 * Wallet ledger — same Mongoose model and MongoDB collection as `Transaction`.
 * Use this path in new code when you want the name "wallet transaction"; avoids a second collection.
 */
module.exports = require('./Transaction');
