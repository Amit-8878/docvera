const express = require('express');

const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const { agentOnly } = require('../middleware/agentMiddleware');
const agentController = require('../controllers/agentController');
const walletController = require('../controllers/walletController');

router.get('/nearby', agentController.getNearbyAgents);
router.post('/nearby', agentController.postNearbyAgents);
router.post('/location', authMiddleware, agentOnly, agentController.postAgentLocation);
router.post('/online', authMiddleware, agentOnly, agentController.postAgentOnlineToggle);
router.get('/assignment-requests', authMiddleware, agentOnly, agentController.getAgentAssignmentRequests);
router.post('/assignment-respond', authMiddleware, agentOnly, agentController.postAgentAssignmentRespond);
router.get('/:agentId/dashboard', authMiddleware, agentController.getAgentDashboard);
router.get('/', authMiddleware, adminOnly, agentController.getApprovedAgents);
router.get('/pending', authMiddleware, adminOnly, agentController.getPendingAgents);
router.put('/:id/approve', authMiddleware, adminOnly, agentController.approveAgent);
router.put('/:id/reject', authMiddleware, adminOnly, agentController.rejectAgent);
router.put('/:id/control', authMiddleware, adminOnly, agentController.updateAgentControl);

router.get('/wallet/summary', authMiddleware, agentOnly, walletController.getAgentWalletSummary);
router.get('/wallet/:id', authMiddleware, walletController.getAgentWalletBalanceById);
router.post('/wallet/payout', authMiddleware, walletController.simulatePayout);
router.post('/wallet/withdraw', authMiddleware, agentOnly, walletController.requestWithdraw);
router.get('/withdraw-requests', authMiddleware, adminOnly, walletController.getWithdrawRequests);
router.put('/withdraw-requests/:id', authMiddleware, adminOnly, walletController.updateWithdrawRequest);

module.exports = router;
