/**
 * Heuristic "missing module" labels from module flags (same signals as moduleDetector).
 * @param {Record<string, boolean>} modules
 * @returns {string[]}
 */
function detectMissing(modules) {
  const missing = [];
  if (!modules.auth) missing.push('Auth system not detected in tree (heuristic)');
  if (!modules.payment) missing.push('Payment integration not detected in tree (heuristic)');
  if (!modules.chat) missing.push('Chat / realtime paths not detected in tree (heuristic)');
  if (!modules.ai) missing.push('AI / debugger paths not detected in tree (heuristic)');
  if (!modules.redis) missing.push('Redis-related paths not detected (optional; may still use env Redis)');
  return missing;
}

module.exports = { detectMissing };
