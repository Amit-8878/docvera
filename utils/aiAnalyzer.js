/**
 * Logic-based “AI” layer over project snapshot (no external API).
 * @param {{
 *   modules: Record<string, boolean>;
 *   errors: { pending?: number; runtime?: Array<unknown> };
 *   duplicates: Array<unknown>;
 *   missing: string[];
 * }} p
 */
function analyzeProject({ modules, errors, duplicates, missing }) {
  const insights = [];
  const runtime = Array.isArray(errors?.runtime) ? errors.runtime : [];
  const pendingDb = Number(errors?.pending) || 0;

  if (runtime.length > 0 || pendingDb > 0) {
    insights.push('System has runtime errors. Check error panel immediately.');
  }

  if (duplicates.length > 0) {
    insights.push('Duplicate files detected. This may cause conflicts.');
  }

  if (missing.length > 0) {
    insights.push(`Some core features are missing: ${missing.join(', ')}`);
  }

  if (!modules.redis) {
    insights.push('Redis not active. Performance may be slower under load.');
  }

  if (!modules.ai) {
    insights.push('AI not connected. Assistant features limited.');
  }

  if (insights.length === 0) {
    insights.push('System looks stable. No major issues detected.');
  }

  return insights;
}

/**
 * @param {{ errors: { pending?: number; runtime?: Array<unknown> }; missing: string[] }} p
 * @returns {'HIGH' | 'MEDIUM' | 'LOW'}
 */
function computePriority({ errors, missing }) {
  const runtime = Array.isArray(errors?.runtime) ? errors.runtime : [];
  const pendingDb = Number(errors?.pending) || 0;

  if (runtime.length > 0 || pendingDb > 0) {
    return 'HIGH';
  }
  if (missing && missing.length > 0) {
    return 'MEDIUM';
  }
  return 'LOW';
}

module.exports = { analyzeProject, computePriority };
