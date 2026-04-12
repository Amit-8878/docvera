/**
 * In-memory agent foundation (prototype / admin testing only).
 * Resets on process restart; not for production persistence.
 * Extended with onboarding: profile, trial, subscription, service flags (upgrade to DB later).
 */

const agents = [];

/** @type {Record<string, { otp: string; name: string; city: string; mobile: string; createdAt: number }>} */
const pendingOtps = {};

const OTP_TTL_MS = 15 * 60 * 1000;

function normalizeMobile(m) {
  const d = String(m || '').replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d;
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function extendAgent(a) {
  return {
    ...a,
    profile: a.profile || {
      address: '',
      idProof: '',
      upi: '',
    },
    verified: a.verified === true,
    trialEndsAt: a.trialEndsAt != null ? a.trialEndsAt : null,
    subscription: a.subscription || {
      active: false,
      plan: null,
      expiresAt: null,
    },
    services: a.services || {
      pan: false,
      aadhaar: false,
      gst: false,
    },
    earnings: typeof a.earnings === 'number' ? a.earnings : 0,
    mobile: a.mobile != null ? String(a.mobile) : '',
    location: a.location || { lat: null, lng: null },
  };
}

function ensureAgentsExtended() {
  for (let i = 0; i < agents.length; i += 1) {
    agents[i] = extendAgent(agents[i]);
  }
}

function registerAgent({ name, city }) {
  ensureAgentsExtended();
  const n = String(name || '').trim();
  const c = String(city || '').trim();
  if (!n || !c) {
    return { ok: false, error: 'name and city required' };
  }
  const newAgent = extendAgent({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: n,
    city: c,
    mobile: '',
    status: 'pending',
    commission: 0,
    createdAt: new Date().toISOString(),
  });
  agents.push(newAgent);
  return { ok: true, agent: { ...newAgent } };
}

function approveAgent(id) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent || agent.status !== 'pending') {
    return { ok: false, error: 'Agent not found or not pending' };
  }
  agent.status = 'approved';
  agent.commission = 10;
  if (!agent.trialEndsAt) {
    agent.trialEndsAt = Date.now() + 15 * 24 * 60 * 60 * 1000;
  }
  return { ok: true, agent: { ...extendAgent(agent) } };
}

function rejectAgent(id) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent || agent.status !== 'pending') {
    return { ok: false, error: 'Agent not found or not pending' };
  }
  agent.status = 'rejected';
  return { ok: true, agent: { ...extendAgent(agent) } };
}

function listAgents() {
  ensureAgentsExtended();
  return agents.map((a) => ({ ...extendAgent(a) }));
}

function getAgentFoundationSummary() {
  ensureAgentsExtended();
  const approved = agents.filter((a) => a.status === 'approved').length;
  const pending = agents.filter((a) => a.status === 'pending').length;
  const byCity = {};
  agents
    .filter((a) => a.status === 'approved')
    .forEach((a) => {
      const c = a.city || 'Unknown';
      byCity[c] = (byCity[c] || 0) + 1;
    });
  return {
    approved,
    pending,
    total: agents.length,
    byCity,
  };
}

/**
 * Applicant requests OTP; admin sees OTP in server logs and enters it in admin UI.
 */
function requestAgentOtp({ name, city, mobile }) {
  const n = String(name || '').trim();
  const c = String(city || '').trim();
  const mob = normalizeMobile(mobile);
  if (!n || !c || !mob || mob.length < 10) {
    return { ok: false, error: 'name, city, and valid mobile required' };
  }
  const otp = generateOtp();
  pendingOtps[mob] = {
    otp,
    name: n,
    city: c,
    mobile: mob,
    createdAt: Date.now(),
  };
  // eslint-disable-next-line no-console
  console.log('[Agent onboarding] ADMIN OTP:', otp, '| mobile:', mob, '| name:', n, '| city:', c);
  return { ok: true, message: 'OTP sent to admin (see server terminal)' };
}

/**
 * Admin verifies OTP from terminal — creates approved foundation agent with trial.
 */
function verifyAgentOtp({ mobile, otp }) {
  ensureAgentsExtended();
  const mob = normalizeMobile(mobile);
  const record = pendingOtps[mob];
  if (!record || String(record.otp) !== String(otp)) {
    return { ok: false, error: 'Invalid OTP' };
  }
  if (Date.now() - record.createdAt > OTP_TTL_MS) {
    delete pendingOtps[mob];
    return { ok: false, error: 'OTP expired — request a new one' };
  }
  if (agents.some((a) => normalizeMobile(a.mobile) === mob && a.status !== 'rejected')) {
    return { ok: false, error: 'Mobile already registered' };
  }

  const trialEndsAt = Date.now() + 15 * 24 * 60 * 60 * 1000;
  const newAgent = extendAgent({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: record.name,
    city: record.city,
    mobile: mob,
    status: 'approved',
    commission: 10,
    verified: true,
    trialEndsAt,
    createdAt: new Date().toISOString(),
  });
  agents.push(newAgent);
  delete pendingOtps[mob];
  return { ok: true, agent: { ...extendAgent(newAgent) } };
}

function getAgentById(id) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  return agent ? extendAgent(agent) : null;
}

function applySubscription(agent, plan) {
  const p = plan != null ? String(plan) : 'standard';
  agent.subscription = {
    active: true,
    plan: p,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  agent.services = {
    pan: true,
    aadhaar: true,
    gst: true,
  };
}

/** Public / agent: must prove mobile matches. */
function updateAgentProfileById(id, profile, mobileProof) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent) {
    return { ok: false, error: 'Agent not found' };
  }
  const m = normalizeMobile(mobileProof);
  if (!m || m.length < 10) {
    return { ok: false, error: 'mobile required' };
  }
  if (m !== normalizeMobile(agent.mobile)) {
    return { ok: false, error: 'Mobile mismatch' };
  }
  agent.profile = { ...agent.profile, ...profile };
  return { ok: true, agent: { ...extendAgent(agent) } };
}

/** Admin-only: edit foundation agent profile without mobile proof. */
function updateAgentProfileAdmin(id, profile) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent) {
    return { ok: false, error: 'Agent not found' };
  }
  agent.profile = { ...agent.profile, ...profile };
  return { ok: true, agent: { ...extendAgent(agent) } };
}

/** Public / agent: must prove mobile. */
function subscribeAgentById(id, plan, mobileProof) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent) {
    return { ok: false, error: 'Agent not found' };
  }
  const m = normalizeMobile(mobileProof);
  if (!m || m.length < 10) {
    return { ok: false, error: 'mobile required' };
  }
  if (m !== normalizeMobile(agent.mobile)) {
    return { ok: false, error: 'Mobile mismatch' };
  }
  applySubscription(agent, plan);
  return { ok: true, agent: { ...extendAgent(agent) } };
}

/** Admin-only: activate plan without mobile (demo). */
function subscribeAgentAdmin(id, plan) {
  ensureAgentsExtended();
  const agent = agents.find((a) => String(a.id) === String(id));
  if (!agent) {
    return { ok: false, error: 'Agent not found' };
  }
  applySubscription(agent, plan);
  return { ok: true, agent: { ...extendAgent(agent) } };
}

function checkAgentAccess(agent) {
  const a = extendAgent(agent);
  const now = Date.now();
  if (a.subscription && a.subscription.active && a.subscription.expiresAt && a.subscription.expiresAt > now) {
    return true;
  }
  if (a.trialEndsAt && a.trialEndsAt > now) {
    return true;
  }
  return false;
}

module.exports = {
  extendAgent,
  normalizeMobile,
  registerAgent,
  approveAgent,
  rejectAgent,
  listAgents,
  getAgentFoundationSummary,
  requestAgentOtp,
  verifyAgentOtp,
  getAgentById,
  updateAgentProfileById,
  updateAgentProfileAdmin,
  subscribeAgentById,
  subscribeAgentAdmin,
  checkAgentAccess,
};
