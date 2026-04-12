const mongoose = require('mongoose');
const JobLog = require('../../models/JobLog');

/**
 * @param {{ jobName: string, orderId: string }} p
 */
async function isAlreadySuccessful(p) {
  const oid = toObjectId(p.orderId);
  if (!oid) return false;
  const doc = await JobLog.findOne({ jobName: p.jobName, orderId: oid, status: 'success' })
    .select('_id')
    .lean();
  return !!doc;
}

/**
 * @param {{ jobName: string, orderId: string, bullJobId: string, attemptsMade: number, maxAttempts: number }} p
 */
async function recordExecutionStart(p) {
  const oid = toObjectId(p.orderId);
  if (!oid) return null;
  const retryCount = Math.max(0, Number(p.attemptsMade) || 0);
  return JobLog.findOneAndUpdate(
    { jobName: p.jobName, orderId: oid },
    {
      $set: {
        status: 'processing',
        bullJobId: String(p.bullJobId || ''),
        retryCount,
        maxAttempts: Math.max(1, Number(p.maxAttempts) || 5),
        errorMessage: '',
      },
      $setOnInsert: { jobName: p.jobName, orderId: oid },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * @param {{ jobName: string, orderId: string }} p
 */
async function recordExecutionSuccess(p) {
  const oid = toObjectId(p.orderId);
  if (!oid) return;
  await JobLog.findOneAndUpdate(
    { jobName: p.jobName, orderId: oid },
    {
      $set: {
        status: 'success',
        errorMessage: '',
        completedAt: new Date(),
      },
      $setOnInsert: { jobName: p.jobName, orderId: oid },
    },
    { upsert: true }
  );
}

/**
 * Terminal failure after BullMQ exhausts retries.
 * @param {{ jobName: string, orderId: string, errorMessage?: string, retryCount?: number, maxAttempts?: number }} p
 */
async function recordFinalFailure(p) {
  const oid = toObjectId(p.orderId);
  if (!oid) return;
  await JobLog.findOneAndUpdate(
    { jobName: p.jobName, orderId: oid },
    {
      $set: {
        status: 'failed',
        errorMessage: truncateErr(p.errorMessage),
        retryCount: Math.max(0, Number(p.retryCount) || 0),
        maxAttempts: Math.max(1, Number(p.maxAttempts) || 5),
        completedAt: new Date(),
      },
      $setOnInsert: { jobName: p.jobName, orderId: oid },
    },
    { upsert: true }
  );
}

/**
 * Non-terminal error while processing (visible during retries).
 * @param {{ jobName: string, orderId: string, errorMessage?: string, retryCount?: number }} p
 */
async function recordRetryableError(p) {
  const oid = toObjectId(p.orderId);
  if (!oid) return;
  await JobLog.updateOne(
    { jobName: p.jobName, orderId: oid },
    {
      $set: {
        status: 'processing',
        errorMessage: truncateErr(p.errorMessage),
        retryCount: Math.max(0, Number(p.retryCount) || 0),
      },
    }
  );
}

function toObjectId(orderId) {
  if (!orderId) return null;
  const s = String(orderId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function truncateErr(msg) {
  const t = String(msg || '').trim();
  return t.length > 2000 ? `${t.slice(0, 1997)}...` : t;
}

module.exports = {
  isAlreadySuccessful,
  recordExecutionStart,
  recordExecutionSuccess,
  recordFinalFailure,
  recordRetryableError,
};
