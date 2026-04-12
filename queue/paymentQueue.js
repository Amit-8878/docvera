/**
 * Re-export — real implementation uses REDIS_URL when set (no crash without Redis).
 * @see ../queues/paymentQueue.js
 */
module.exports = require('../queues/paymentQueue');
