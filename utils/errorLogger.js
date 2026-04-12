/** In-memory ring buffer for process-level errors (uncaught / unhandled). Not persisted. */
const MAX = 50;
const logs = [];

function normalizeErr(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : JSON.stringify(err));
}

function logError(err, source = 'server') {
  const e = normalizeErr(err);
  logs.push({
    message: e.message || String(err),
    source,
    time: new Date().toISOString(),
  });
  if (logs.length > MAX) logs.shift();
}

function getErrors() {
  return logs.slice();
}

module.exports = { logError, getErrors, MAX };
