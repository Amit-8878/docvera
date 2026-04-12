const {
  registerAgent,
  approveAgent,
  rejectAgent,
  listAgents,
} = require('../utils/agentFoundationStore');

function postRegister(req, res) {
  try {
    const { name, city } = req.body || {};
    const result = registerAgent({ name, city });
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'register failed' });
  }
}

function postApprove(req, res) {
  try {
    const { id } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = approveAgent(id);
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'approve failed' });
  }
}

function postReject(req, res) {
  try {
    const { id } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = rejectAgent(id);
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'reject failed' });
  }
}

function getList(req, res) {
  try {
    return res.status(200).json({ agents: listAgents() });
  } catch (err) {
    return res.status(200).json({ agents: [], error: err.message });
  }
}

module.exports = {
  postRegister,
  postApprove,
  postReject,
  getList,
};
