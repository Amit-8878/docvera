const { Queue } = require('bullmq');
const { getBullConnection } = require('../config/bullConnection');

let queue;

function getPaymentQueue() {
  const connection = getBullConnection();
  if (!connection) return null;
  if (!queue) {
    try {
      queue = new Queue('payments', { connection });
    } catch {
      queue = null;
      return null;
    }
  }
  return queue;
}

/**
 * Enqueue background work (e.g. post-payment reconciliation). No-op if Redis missing.
 */
async function enqueuePaymentJob(jobName, data, opts) {
  const q = getPaymentQueue();
  if (!q) {
    return { skipped: true, reason: 'REDIS_URL not configured' };
  }
  return q.add(jobName || 'processPayment', data, opts);
}

module.exports = {
  getPaymentQueue,
  enqueuePaymentJob,
};
