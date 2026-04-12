const Order = require('../models/Order');
const { creditWallet, debitWallet } = require('../utils/wallet');

/**
 * @param {object} [meta]
 * @param {import('mongoose').Types.ObjectId} [meta.orderId]
 * @param {string} [meta.source]
 * @param {string} [meta.description]
 */
async function creditUserWallet(userId, amountRupees, reference, reason, meta = {}) {
  return creditWallet(userId, amountRupees, {
    reference,
    reason: reason || 'wallet_credit',
    orderId: meta.orderId || null,
    source: meta.source || 'other',
    description: meta.description || '',
  });
}

async function creditAgentForOrderRelease(orderId) {
  const order = await Order.findById(orderId).lean();
  if (!order || order.paymentStatus !== 'released') return { skipped: true, reason: 'Order not released' };
  if (!order.agent) {
    return { skipped: true, reason: 'No assigned agent' };
  }

  const amount = Number(order.agentEarning || 0);
  if (amount <= 0) {
    return { skipped: true, reason: 'No earning amount' };
  }

  return creditWallet(order.agent, amount, {
    reference: String(order._id),
    reason: 'agent_release',
    orderId: order._id,
    source: 'service',
    description: 'Agent earning (order released)',
  });
}

async function debitAgentWallet(agentId, amount, reference) {
  const numericAmount = Number(amount || 0);
  if (numericAmount <= 0) throw new Error('Invalid amount');
  return debitWallet(agentId, numericAmount, {
    reference,
    reason: 'withdrawal',
    source: 'withdrawal',
    description: 'Withdrawal',
  });
}

/** Customer (or any role) paying an order from wallet balance — INR. */
async function debitCustomerWallet(userId, amountRupees, reference, reason = 'order_payment') {
  const numericAmount = Number(amountRupees || 0);
  if (numericAmount <= 0) throw new Error('Invalid amount');
  return debitWallet(userId, numericAmount, {
    reference,
    reason,
    source: 'order_payment',
    description: 'Order payment (wallet)',
  });
}

module.exports = {
  creditAgentForOrderRelease,
  debitAgentWallet,
  debitCustomerWallet,
  creditUserWallet,
};
