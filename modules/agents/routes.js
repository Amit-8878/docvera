const express = require('express');

const walletController = require('../../controllers/walletController');
const safeAgentWalletHandler = (req, res) => {
  res.status(200).json({
    success: false,
    message: 'Not implemented yet',
  });
};
const WALLET_AGENT_ROUTE_KEYS = [
  'getAgentWalletSummary',
  'getAgentWalletBalanceById',
  'simulatePayout',
  'requestWithdraw',
  'getWithdrawRequests',
  'updateWithdrawRequest',
];
for (const key of WALLET_AGENT_ROUTE_KEYS) {
  if (typeof walletController[key] !== 'function') {
    walletController[key] = safeAgentWalletHandler;
  }
}

const legacyAgentRoutes = require('../../routes/agentRoutes');

/**
 * Mounts ESM agent application routes (if available) then legacy `/api/agents` router.
 * Preserves order: ESM first, then legacy — same as previous `server.js` behavior.
 *
 * @param {import('express').Express} app
 */
async function mountAgents(app) {
  try {
    const mod = await import('../../src/routes/agent.routes.js');
    if (mod && mod.default) {
      app.use('/api/agents', mod.default);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[modules/agents/routes] ESM agent routes skipped:', err && err.message ? err.message : err);
  }
  app.use('/api/agents', legacyAgentRoutes);
}

/**
 * Fallback router if `mountAgents` is never called (should not happen when using `mountAgents`).
 */
function fallbackRouter() {
  const r = express.Router();
  r.all('*', (req, res) => {
    res.status(503).json({
      success: false,
      message: 'Agents module not mounted',
      errorCode: 'AGENTS_NOT_MOUNTED',
    });
  });
  return r;
}

module.exports = {
  mountAgents,
  legacyRouter: legacyAgentRoutes,
  fallbackRouter,
};
