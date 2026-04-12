const {
  requestAgentOtp,
  verifyAgentOtp,
  getAgentById,
  updateAgentProfileById,
  updateAgentProfileAdmin,
  subscribeAgentById,
  subscribeAgentAdmin,
  checkAgentAccess,
  normalizeMobile,
} = require('../utils/agentFoundationStore');

function postRequestOtp(req, res) {
  try {
    const { name, city, mobile } = req.body || {};
    const result = requestAgentOtp({ name, city, mobile });
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, message: result.message });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'request failed' });
  }
}

function getStatus(req, res) {
  try {
    const { id, mobile } = req.query || {};
    if (id === undefined || id === null || mobile === undefined) {
      return res.status(200).json({ success: false, error: 'id and mobile required' });
    }
    const agent = getAgentById(id);
    if (!agent) {
      return res.status(200).json({ success: false, error: 'Not found' });
    }
    if (normalizeMobile(String(mobile)) !== normalizeMobile(agent.mobile)) {
      return res.status(200).json({ success: false, error: 'Not found' });
    }
    return res.status(200).json({
      success: true,
      agent,
      access: checkAgentAccess(agent),
    });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}

function postProfile(req, res) {
  try {
    const { id, mobile, profile } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = updateAgentProfileById(id, profile || {}, mobile);
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'profile update failed' });
  }
}

function postSubscribe(req, res) {
  try {
    const { id, mobile, plan } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = subscribeAgentById(id, plan, mobile);
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'subscribe failed' });
  }
}

function postVerifyOtp(req, res) {
  try {
    const { mobile, otp } = req.body || {};
    const result = verifyAgentOtp({ mobile, otp });
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'verify failed' });
  }
}

function postAdminSubscribe(req, res) {
  try {
    const { id, plan } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = subscribeAgentAdmin(id, plan);
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'subscribe failed' });
  }
}

function postAdminProfile(req, res) {
  try {
    const { id, profile } = req.body || {};
    if (id === undefined || id === null) {
      return res.status(200).json({ success: false, error: 'id required' });
    }
    const result = updateAgentProfileAdmin(id, profile || {});
    if (!result.ok) {
      return res.status(200).json({ success: false, error: result.error });
    }
    return res.status(200).json({ success: true, agent: result.agent });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'profile update failed' });
  }
}

module.exports = {
  postRequestOtp,
  getStatus,
  postProfile,
  postSubscribe,
  postVerifyOtp,
  postAdminSubscribe,
  postAdminProfile,
};
