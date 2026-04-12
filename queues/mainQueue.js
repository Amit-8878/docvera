/**
 * Main job queue: BullMQ when REDIS_URL is set, otherwise in-memory async queue (no extra infra).
 * Heavy / deferrable work should be enqueued; HTTP handlers stay fast.
 */

const { Queue, Worker } = require('bullmq');
const { getBullConnection } = require('../config/bullConnection');
const { logInfo, logFailure } = require('../utils/logger');

const QUEUE_NAME = 'docvera-main';
const connection = getBullConnection();

let bullQueue = null;
let bullWorker = null;
const memoryQueue = [];
let memoryProcessing = false;

const JOB_NAMES = {
  ORDER_PROCESSING: 'order_processing',
  PAYMENT_VERIFICATION: 'payment_verification',
  NOTIFICATION_SENDING: 'notification_sending',
};

async function runMemoryJob(job) {
  const { name, data } = job;
  logInfo('mainQueue', 'memory_job_start', { name });
  try {
    if (name === JOB_NAMES.NOTIFICATION_SENDING && data && data.userId) {
      const { createNotification } = require('../services/notificationService');
      await createNotification({
        userId: data.userId,
        role: data.role || 'user',
        title: data.title || 'Update',
        message: data.message || '',
        type: data.type || 'system',
        event: data.event || 'queued',
        data: data.payload || {},
        dedupeKey: data.dedupeKey,
      });
    } else if (name === JOB_NAMES.ORDER_PROCESSING) {
      logInfo('mainQueue', 'order_processing_deferred', { orderId: data && data.orderId ? String(data.orderId) : '' });
    } else if (name === JOB_NAMES.PAYMENT_VERIFICATION) {
      logInfo('mainQueue', 'payment_verification_deferred', { orderId: data && data.orderId ? String(data.orderId) : '' });
    }
  } catch (e) {
    logFailure('mainQueue', e, { name, phase: 'memory_worker' });
  }
  logInfo('mainQueue', 'memory_job_done', { name });
}

async function drainMemoryQueue() {
  if (memoryProcessing) return;
  memoryProcessing = true;
  try {
    while (memoryQueue.length) {
      const job = memoryQueue.shift();
      if (job) await runMemoryJob(job);
    }
  } finally {
    memoryProcessing = false;
  }
}

function ensureBullWorker() {
  if (!connection || bullWorker) return;
  try {
    bullWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { name, data } = job;
        if (name === JOB_NAMES.NOTIFICATION_SENDING && data && data.userId) {
          const { createNotification } = require('../services/notificationService');
          await createNotification({
            userId: data.userId,
            role: data.role || 'user',
            title: data.title || 'Update',
            message: data.message || '',
            type: data.type || 'system',
            event: data.event || 'queued',
            data: data.payload || {},
            dedupeKey: data.dedupeKey,
          });
        } else if (name === JOB_NAMES.ORDER_PROCESSING) {
          logInfo('mainQueue', 'order_processing_job', { data });
        } else if (name === JOB_NAMES.PAYMENT_VERIFICATION) {
          logInfo('mainQueue', 'payment_verification_job', { data });
        }
      },
      { connection, concurrency: 2 }
    );
    bullWorker.on('failed', (job, err) => {
      logFailure('mainQueue', err, { jobId: job && job.id, name: job && job.name });
    });
  } catch (e) {
    logFailure('mainQueue', e, { phase: 'worker_init' });
    bullWorker = null;
  }
}

function getBullQueue() {
  if (!connection) return null;
  if (!bullQueue) {
    try {
      bullQueue = new Queue(QUEUE_NAME, { connection });
      ensureBullWorker();
    } catch (e) {
      logFailure('mainQueue', e, { phase: 'queue_init' });
      bullQueue = null;
    }
  }
  return bullQueue;
}

/**
 * Enqueue background work. Resolves immediately when using BullMQ; memory mode uses setImmediate.
 * @param {string} name
 * @param {Record<string, unknown>} data
 * @param {{ delayMs?: number }} [opts]
 */
async function enqueueMainJob(name, data = {}, opts = {}) {
  const q = getBullQueue();
  if (q) {
    await q.add(name, data, {
      removeOnComplete: 200,
      removeOnFail: 100,
      delay: Math.max(0, Number(opts.delayMs) || 0),
    });
    return { ok: true, backend: 'bullmq' };
  }
  memoryQueue.push({ name, data });
  setImmediate(() => {
    drainMemoryQueue().catch((e) => logFailure('mainQueue', e, { phase: 'drain' }));
  });
  return { ok: true, backend: 'memory' };
}

module.exports = {
  JOB_NAMES,
  enqueueMainJob,
  getBullQueue,
};
