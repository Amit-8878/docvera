/**
 * Order job producer (Queue only). Workers run in `workers/orderJobsWorker.js` or optionally in-API.
 * BullMQ + ioredis (REDIS_URL). Survives process restarts; jobs persist in Redis.
 */

const { Queue } = require('bullmq');
const { getBullConnection } = require('../../config/bullConnection');
const { logFailure, logInfo } = require('../../utils/logger');
const { processOrderJobFromBull, ORDER_JOB_NAMES } = require('./orderJobProcessor');

const QUEUE_NAME = 'docvera-orders';
const connection = getBullConnection();

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: 200,
  removeOnFail: 100,
};

let bullQueue = null;

const memoryQueue = [];
let memoryProcessing = false;

function allowDevMemoryQueue() {
  return process.env.NODE_ENV !== 'production' && String(process.env.ORDER_JOBS_DEV_MEMORY || '') === '1';
}

function buildStableJobId(name, data) {
  const oid = data && data.orderId != null ? String(data.orderId) : '';
  if (!oid) return undefined;
  const raw = `${name}-${oid}`.replace(/:/g, '_');
  if (raw === '0' || raw.startsWith('0')) return `j-${raw}`;
  return raw;
}

function getOrderQueue() {
  if (!connection) return null;
  if (!bullQueue) {
    try {
      bullQueue = new Queue(QUEUE_NAME, { connection });
    } catch (e) {
      logFailure('orderJobQueue', e, { phase: 'queue_init' });
      bullQueue = null;
    }
  }
  return bullQueue;
}

async function runMemoryOrderJob(payload) {
  const { name, data } = payload;
  const job = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    data: data || {},
    attemptsMade: 0,
    opts: { attempts: DEFAULT_JOB_OPTS.attempts },
  };
  logInfo('orderJobQueue', 'memory_job_start', { name: job.name });
  try {
    await processOrderJobFromBull(job);
  } catch (e) {
    logFailure('orderJobQueue', e, { name, phase: 'memory_worker' });
  }
  logInfo('orderJobQueue', 'memory_job_done', { name: job.name });
}

async function drainMemoryOrderQueue() {
  if (memoryProcessing) return;
  memoryProcessing = true;
  try {
    while (memoryQueue.length) {
      const payload = memoryQueue.shift();
      if (payload) await runMemoryOrderJob(payload);
    }
  } finally {
    memoryProcessing = false;
  }
}

/**
 * Enqueue order background work (invoice, notifications, post-payment auto-assign).
 * @param {string} name — use ORDER_JOB_NAMES.*
 * @param {Record<string, unknown>} data — must include orderId
 * @param {{ delayMs?: number }} [opts]
 */
async function enqueueOrderJob(name, data = {}, opts = {}) {
  const q = getOrderQueue();
  if (q) {
    const jobId = buildStableJobId(name, data);
    const addOpts = {
      ...DEFAULT_JOB_OPTS,
      delay: Math.max(0, Number(opts.delayMs) || 0),
      ...(jobId ? { jobId } : {}),
    };
    try {
      const bullJob = await q.add(name, data, addOpts);
      logInfo('orderJobQueue', 'enqueued', {
        name,
        docveraOrderId: data && data.orderId != null ? String(data.orderId) : '',
        bullJobId: bullJob && bullJob.id != null ? String(bullJob.id) : '',
        stableJobId: jobId || '',
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      if (/exists|duplicate|already/i.test(msg)) {
        logInfo('orderJobQueue', 'enqueue_duplicate_ignored', { name, jobId });
        return { ok: true, backend: 'bullmq', duplicate: true };
      }
      logFailure('orderJobQueue', e, { name, phase: 'enqueue' });
      return { ok: false, backend: 'bullmq', error: msg };
    }
    return { ok: true, backend: 'bullmq' };
  }

  if (allowDevMemoryQueue()) {
    memoryQueue.push({ name, data });
    setImmediate(() => {
      drainMemoryOrderQueue().catch((e) => logFailure('orderJobQueue', e, { phase: 'drain' }));
    });
    return { ok: true, backend: 'memory' };
  }

  logFailure('orderJobQueue', new Error('REDIS_URL missing or invalid'), {
    phase: 'enqueue',
    name,
    hint: 'Set REDIS_URL, or dev-only ORDER_JOBS_DEV_MEMORY=1',
  });
  return { ok: false, backend: 'none', reason: 'no_redis' };
}

/**
 * When ORDER_JOBS_RUN_WORKER_IN_API=1, run a consumer inside the API process (dev / small deploys).
 * @param {import('ioredis').default} redisConnection
 * @returns {import('bullmq').Worker | null}
 */
function startOrderJobsWorkerInApi(redisConnection) {
  if (String(process.env.ORDER_JOBS_RUN_WORKER_IN_API || '') !== '1') return null;
  if (!redisConnection) return null;
  try {
    const { createOrderJobsWorker } = require('./orderJobWorkerSetup');
    return createOrderJobsWorker(redisConnection, { concurrency: 2 });
  } catch (e) {
    logFailure('orderJobQueue', e, { phase: 'api_worker' });
    return null;
  }
}

module.exports = {
  ORDER_JOB_NAMES,
  enqueueOrderJob,
  getOrderQueue,
  QUEUE_NAME,
  startOrderJobsWorkerInApi,
};
