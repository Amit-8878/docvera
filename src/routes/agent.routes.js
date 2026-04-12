import express from 'express';
import { createRequire } from 'module';
import {
  createAgent,
  getAllAgents,
  approveAgent,
  rejectAgent,
  getMyAgentProfile,
  patchAgentApplicationSettings,
} from '../controllers/agent.controller.js';

const require = createRequire(import.meta.url);
const authMiddleware = require('../../middleware/authMiddleware.js');
const { adminOnly } = require('../../middleware/adminMiddleware.js');
const { agentOnly } = require('../../middleware/agentMiddleware.js');

const router = express.Router();

router.post('/create', createAgent);
router.get('/all', authMiddleware, adminOnly, getAllAgents);
router.put('/approve/:id', authMiddleware, adminOnly, approveAgent);
router.put('/reject/:id', authMiddleware, adminOnly, rejectAgent);
router.get('/me', authMiddleware, agentOnly, getMyAgentProfile);
router.patch('/application/:id/settings', authMiddleware, adminOnly, patchAgentApplicationSettings);

export default router;
