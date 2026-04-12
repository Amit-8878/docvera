const env = require('../config/env');

const PLATFORM_FEE_PERCENT = env.platformFeePercent;
const AGENT_DEFAULT_PCT = env.agentDefaultCommissionPercent;

/**
 * Agent commission % of gross (optional on User). If unset, optional `AGENT_COMMISSION_PERCENT` env;
 * else platform fee % from env (remainder to agent).
 * @param {number} total
 * @param {{ commissionPercent?: number|null, role?: string }|null} agentLean
 */
function splitOrderTotalForCommission(total, agentLean) {
  const t = Number(total || 0);
  const raw = agentLean && agentLean.commissionPercent != null ? Number(agentLean.commissionPercent) : NaN;
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) {
    const agentEarning = Number(((t * raw) / 100).toFixed(2));
    const platformFee = Number((t - agentEarning).toFixed(2));
    return { platformFee, agentEarning };
  }
  if (
    AGENT_DEFAULT_PCT != null &&
    Number.isFinite(AGENT_DEFAULT_PCT) &&
    AGENT_DEFAULT_PCT >= 0 &&
    AGENT_DEFAULT_PCT <= 100
  ) {
    const agentEarning = Number(((t * AGENT_DEFAULT_PCT) / 100).toFixed(2));
    const platformFee = Number((t - agentEarning).toFixed(2));
    return { platformFee, agentEarning };
  }
  const platformFee = Number((t * PLATFORM_FEE_PERCENT).toFixed(2));
  const agentEarning = Number((t - platformFee).toFixed(2));
  return { platformFee, agentEarning };
}

module.exports = {
  splitOrderTotalForCommission,
  PLATFORM_FEE_PERCENT,
};
