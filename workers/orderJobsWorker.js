/**
 * Dedicated order job worker: npm run worker:orders
 * Requires REDIS_URL, MongoDB (MONGO_URI), and the same server/.env as the API.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const { getBullConnection } = require('../config/bullConnection');
const { connectDB } = require('../config/db');
const Order = require('../models/Order');
const { processOrderJobFromBull } = require('../modules/jobs/orderJobProcessor');
const jobLog = require('../modules/jobs/orderJobLogService');
const { logFailure, logInfo } = require('../utils/logger');

const QUEUE_NAME = 'docvera-orders';

const connection = getBullConnection();
if (!connection) {
  // eslint-disable-next-line no-console
  console.error('[order-jobs-worker] REDIS_URL is required');
  process.exit(1);
}

async function main() {
  const ok = await connectDB();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('[order-jobs-worker] MongoDB connection failed');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[order-jobs-worker] listening on queue "${QUEUE_NAME}"`);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = job.data || {};
      const orderIdRaw = data.orderId != null ? String(data.orderId).trim() : '';
      const attempt = Math.max(0, Number(job.attemptsMade) || 0);
      const maxAttempts = Math.max(1, Number(job.opts && job.opts.attempts) || 5);

      logInfo('orderJobWorker', 'processing', {
        id: job.id,
        name: job.name,
        attempt: attempt + 1,
        maxAttempts,
        orderId: orderIdRaw,
      });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          type: 'order_job_worker_receive',
          phase: 'worker',
          docveraOrderId: orderIdRaw,
          jobName: job.name,
          bullJobId: job.id != null ? String(job.id) : '',
          attempt: attempt + 1,
          maxAttempts,
        })
      );

      if (!orderIdRaw || !mongoose.Types.ObjectId.isValid(orderIdRaw)) {
        // eslint-disable-next-line no-console
        console.error('[order-jobs-worker] Invalid orderId - skipping job', {
          orderId: orderIdRaw,
          jobId: job.id,
          reason: 'not_a_valid_objectid',
        });
        return { ok: false, skipped: true, reason: 'invalid_objectid' };
      }

      const order = await Order.findById(orderIdRaw).select('_id').lean();
      if (!order) {
        // eslint-disable-next-line no-console
        console.error('[order-jobs-worker] Invalid orderId - skipping job', {
          orderId: orderIdRaw,
          jobId: job.id,
          reason: 'order_not_in_db',
        });
        return { ok: false, skipped: true, reason: 'order_not_found' };
      }

      const result = await processOrderJobFromBull(job);
      logInfo('orderJobWorker', 'job_success', {
        id: job.id,
        name: job.name,
        orderId: orderIdRaw,
        result,
      });
      return result;
    },
    { connection, concurrency: 3 }
  );

  worker.on('completed', (job, result) => {
    logInfo('orderJobWorker', 'completed', {
      id: job.id,
      name: job.name,
      orderId: job.data && job.data.orderId,
      result,
    });
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const max = Math.max(1, Number(job.opts && job.opts.attempts) || 5);
    const made = Math.max(0, Number(job.attemptsMade) || 0);
    const data = job.data || {};
    const orderId = data.orderId != null ? String(data.orderId) : '';
    logFailure('orderJobWorker', err, {
      id: job.id,
      name: job.name,
      attemptsMade: made,
      maxAttempts: max,
      orderId,
      phase: 'will_retry_or_terminal',
    });
    let terminal = false;
    try {
      const st = await job.getState();
      terminal = st === 'failed';
    } catch {
      terminal = made >= max;
    }
    if (terminal && orderId) {
      await jobLog.recordFinalFailure({
        jobName: job.name,
        orderId,
        errorMessage: err && err.message ? err.message : String(err),
        retryCount: made,
        maxAttempts: max,
      });
    }
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[order-jobs-worker]', e);
  process.exit(1);
});
