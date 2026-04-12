/**
 * Bounded DB operations — timeout returns fallback without throwing (caller handles degraded mode).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {T|null} fallback
 * @returns {Promise<T|null>}
 */
async function withDbTimeout(promise, ms, fallback = null) {
  const t = Math.max(100, Number(ms) || 8000);
  let timer;
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DB_TIMEOUT')), t);
  });
  try {
    const result = await Promise.race([Promise.resolve(promise), timeoutP]);
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    if (e && e.message === 'DB_TIMEOUT') return fallback;
    throw e;
  }
}

module.exports = { withDbTimeout };
