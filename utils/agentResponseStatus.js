/**
 * Normalize agent assignment acceptance state for API + legacy orders (pre-field migration).
 * @param {{ agent?: unknown; status?: string; agentResponseStatus?: string }} order
 * @returns {'none' | 'pending' | 'accepted' | 'declined'}
 */
function effectiveAgentResponseStatus(order) {
  if (!order || typeof order !== 'object') return 'none';
  const raw = order.agentResponseStatus;
  if (raw === 'pending' || raw === 'accepted' || raw === 'declined') return raw;
  if (!raw || raw === 'none') {
    if (
      order.agent &&
      ['assigned', 'processing', 'completed'].includes(String(order.status || ''))
    ) {
      return 'accepted';
    }
  }
  return 'none';
}

module.exports = {
  effectiveAgentResponseStatus,
};
