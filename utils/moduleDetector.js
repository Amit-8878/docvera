/**
 * Heuristic module flags from tree paths (read-only names).
 * Avoids substring traps like "main" matching "ai".
 */
function looksLikeAiToken(name) {
  const n = name.toLowerCase();
  if (n === 'ai' || n.startsWith('ai-') || n.endsWith('-ai')) return true;
  if (n.includes('openai') || n.includes('ollama') || n.includes('claude') || n.includes('gemini')) return true;
  return /(^|[^a-z])ai([^a-z]|$)/i.test(name);
}

/**
 * @param {Array<{ name: string; type: string; children?: unknown }>} tree
 * @param {string} [prefix]
 * @returns {Record<string, boolean>}
 */
function detectModules(tree, prefix = '') {
  const modules = {
    auth: false,
    payment: false,
    chat: false,
    ai: false,
    redis: false,
    orders: false,
    notifications: false,
    wallet: false,
    disputes: false,
    analytics: false,
  };

  const check = (nodes, rel) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((n) => {
      if (!n || typeof n.name !== 'string') return;
      const segment = rel ? `${rel}/${n.name}` : n.name;
      const lower = segment.toLowerCase();

      if (/\bauth\b/i.test(segment) || lower.includes('login') || lower.includes('jwt') || lower.includes('session')) {
        modules.auth = true;
      }
      if (
        lower.includes('payment') ||
        lower.includes('razorpay') ||
        lower.includes('stripe') ||
        lower.includes('wallet') ||
        lower.includes('payout')
      ) {
        modules.payment = true;
      }
      if (lower.includes('chat') || lower.includes('socket') || lower.includes('whatsapp')) {
        modules.chat = true;
      }
      if (looksLikeAiToken(n.name) || lower.includes('/ai/') || lower.includes('debugger') || lower.includes('llm')) {
        modules.ai = true;
      }
      if (lower.includes('redis') || n.name.toLowerCase() === 'redis.js') {
        modules.redis = true;
      }
      if (/\borders?\b/i.test(segment)) {
        modules.orders = true;
      }
      if (lower.includes('notification')) {
        modules.notifications = true;
      }
      if (lower.includes('wallet')) {
        modules.wallet = true;
      }
      if (lower.includes('dispute')) {
        modules.disputes = true;
      }
      if (lower.includes('analytics')) {
        modules.analytics = true;
      }

      if (n.children) check(n.children, segment);
    });
  };

  check(tree, prefix);
  return modules;
}

/**
 * Non-destructive hints for missing or inactive pieces (heuristics only).
 * @param {Record<string, boolean>} modules
 * @param {{ api: string; database: string; redis: string }} status
 * @param {number} pendingErrors
 * @returns {Array<{ severity: 'info' | 'warn'; label: string }>}
 */
function getInactiveComponentHints(modules, status, pendingErrors) {
  const gaps = [];

  if (status.database !== 'connected') {
    gaps.push({ severity: 'warn', label: 'Database is not connected; app data features may be unavailable.' });
  }
  if (status.redis === 'not_connected') {
    gaps.push({
      severity: 'info',
      label: 'Redis is not connected (optional). Caching, queues, or Socket.IO adapter may use in-memory fallback.',
    });
  }
  if (!modules.auth) {
    gaps.push({ severity: 'info', label: 'No obvious auth-related paths in scan (heuristic). Verify auth if you expect it.' });
  }
  if (!modules.payment) {
    gaps.push({ severity: 'info', label: 'No obvious payment paths in scan (heuristic).' });
  }
  if (!modules.chat) {
    gaps.push({ severity: 'info', label: 'No obvious chat/socket paths in scan (heuristic).' });
  }
  if (!modules.ai) {
    gaps.push({ severity: 'info', label: 'No obvious AI/debug paths in scan (heuristic).' });
  }
  if (pendingErrors > 0) {
    gaps.push({
      severity: 'warn',
      label: `${pendingErrors} server error log(s) pending review (see AI System Monitor).`,
    });
  }

  return gaps;
}

module.exports = { detectModules, getInactiveComponentHints, looksLikeAiToken };
