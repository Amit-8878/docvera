import { createRequire } from 'module';
import Agent from '../models/agent.model.js';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const User = require('../../models/User.js');

export const createAgent = async (req, res) => {
  try {
    const data = req.body || {};
    const agent = new Agent(data);
    await agent.save();

    return res.status(201).json({
      success: true,
      message: 'Agent application submitted',
      agent,
    });
  } catch (err) {
    if (err && err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

export const getAllAgents = async (req, res) => {
  try {
    const agents = await Agent.find().sort({ createdAt: -1 }).limit(500).lean();

    return res.json({ success: true, agents });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

export const approveAgent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const agent = await Agent.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'approved',
          approvedByAdmin: true,
          isActive: true,
          servicesEnabled: true,
          'subscription.active': true,
          'subscription.plan': 'approved',
        },
      },
      { new: true, runValidators: true }
    ).lean();

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    if (agent.user) {
      const u = await User.findById(agent.user).select('role').lean();
      if (u) {
        const patch = { isApproved: true };
        if (u.role === 'user') patch.role = 'agent';
        await User.findByIdAndUpdate(agent.user, { $set: patch }, { runValidators: false }).catch(() => {});
      }
    }

    return res.json({ success: true, agent });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

export const rejectAgent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const agent = await Agent.findByIdAndUpdate(
      id,
      {
        status: 'rejected',
        approvedByAdmin: false,
      },
      { new: true, runValidators: true }
    ).lean();

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    return res.json({ success: true, agent });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/** GET /api/agents/me — linked agent application for logged-in agent user. */
export const getMyAgentProfile = async (req, res) => {
  try {
    const uid = req.user && req.user.userId;
    if (!uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const agent = await Agent.findOne({ user: uid }).sort({ createdAt: -1 }).lean();
    if (!agent) {
      return res.status(404).json({ success: false, message: 'No application profile' });
    }
    return res.json({ success: true, agent });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

/** PATCH /api/agents/application/:id/settings — admin: isActive, servicesEnabled, subscription. */
export const patchAgentApplicationSettings = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const body = req.body || {};
    const $set = {};

    if (typeof body.isActive === 'boolean') $set.isActive = body.isActive;
    if (typeof body.servicesEnabled === 'boolean') $set.servicesEnabled = body.servicesEnabled;

    const sub = body.subscription;
    if (sub && typeof sub === 'object') {
      if (typeof sub.active === 'boolean') $set['subscription.active'] = sub.active;
      if (typeof sub.plan === 'string') $set['subscription.plan'] = sub.plan.trim().slice(0, 80);
      if (sub.expiresAt != null && sub.expiresAt !== '') {
        const d = new Date(sub.expiresAt);
        if (!Number.isNaN(d.getTime())) $set['subscription.expiresAt'] = d;
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const agent = await Agent.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true }).lean();
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    return res.json({ success: true, agent });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};
