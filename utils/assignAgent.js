/**
 * Thin wrapper around the canonical auto-assign implementation in `orderController`.
 * Agents are `User` documents (`role: 'agent'`, `isApproved`); orders use `agent` + `status`.
 * Assignment runs after successful payment (see `services/paymentSuccess.handlePaymentSuccess`).
 *
 * @param {string|import('mongoose').Types.ObjectId|{ _id?: string }} orderOrId
 * @returns {Promise<{ ok: boolean, reason?: string, agentId?: string }>}
 */
async function assignAgent(orderOrId) {
  const { autoAssignAgent } = require('../controllers/orderController');
  const id =
    orderOrId && typeof orderOrId === 'object' && orderOrId._id != null ? orderOrId._id : orderOrId;
  return autoAssignAgent(id);
}

module.exports = assignAgent;
