/**
 * Shared BullMQ Worker setup for order jobs (standalone worker and optional in-API worker).
 */

const { Worker } = require('bullmq');
const { logFailure, logInfo } = require('../../utils/logger');
const { processOrderJobFromBull } = require('./orderJobProcessor');
const jobLog = require('./orderJobLogService');

const QUEUE_NAME = 'docvera-orders';

/**
 * @param {import('ioredis').default} connection
 * @param {{ concurrency?: number }} [opts]
 * @returns {import('bullmq').Worker}
 */
function createOrderJobsWorker(connection, opts = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logInfo('orderJobWorker', 'processing', { id: job.id, name: job.name, attemptsMade: job.attemptsMade });
      return processOrderJobFromBull(job);
    },
    { connection, concurrency: opts.concurrency != null ? opts.concurrency : 3 }
  );

  worker.on('completed', (job) => {
    logInfo('orderJobWorker', 'completed', { id: job.id, name: job.name });
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

  return worker;
}

module.exports = {
  createOrderJobsWorker,
  QUEUE_NAME,
};
