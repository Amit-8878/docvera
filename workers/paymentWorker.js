/**
 * Run separately: npm run worker:payments (requires REDIS_URL).
 * Processes BullMQ "payments" queue jobs without blocking the API process.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Worker } = require('bullmq');
const { getBullConnection } = require('../config/bullConnection');

const connection = getBullConnection();
if (!connection) {
  // eslint-disable-next-line no-console
  console.error('[payment-worker] REDIS_URL is required');
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[payment-worker] listening on queue "payments"');

const worker = new Worker(
  'payments',
  async (job) => {
    // eslint-disable-next-line no-console
    console.log('[payment-worker] job', job.id, job.name, job.data);
    // Future: idempotent payment reconciliation, webhooks follow-up, etc.
    return { ok: true };
  },
  { connection }
);

worker.on('failed', (job, err) => {
  // eslint-disable-next-line no-console
  console.error('[payment-worker] failed', job?.id, err?.message);
});
