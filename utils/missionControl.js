const User = require('../models/User');
const Order = require('../models/Order');
const { isDBConnected } = require('../config/db');

/**
 * @param {Record<string, boolean> | undefined} modules
 * @param {{ users?: number; orders?: number } | undefined} stats
 * @param {{ totalAgents?: number } | undefined} agentData
 * @param {number} [foundationApproved] in-memory approved agents (prototype store)
 */
function buildRoadmap(modules, stats, agentData, foundationApproved = 0) {
  const m = modules || {};
  const users = stats?.users ?? 0;
  const totalAgents = (agentData?.totalAgents ?? 0) + Math.max(0, Number(foundationApproved) || 0);
  const rows = [
    { id: 'core', title: 'Core System (Auth, Orders, Payments)', done: true },
    { id: 'ai', title: 'AI Assist + Safe Engine', done: !!m.ai },
    { id: 'monitor', title: 'AI System Monitor', done: true },
    { id: 'agents', title: 'Agent Network System', done: totalAgents > 0 },
    { id: 'map', title: 'India Map + Agent Locator', done: false },
    { id: 'auto', title: 'Auto Deploy + Cloud Control', done: false },
  ];

  return rows.map((row) => {
    let status = 'planned';
    if (row.done) {
      status = 'complete';
    } else if (row.id === 'ai' && !m.ai) {
      status = 'active';
    } else if (row.id === 'agents' && totalAgents === 0 && users > 30) {
      status = 'active';
    } else if (row.id === 'map' && m.ai && totalAgents > 0) {
      status = 'active';
    }
    return { ...row, status };
  });
}

/**
 * @param {Record<string, boolean> | undefined} modules
 * @param {string[] | undefined} missing
 */
function buildMissionSuggestions(modules, missing) {
  const m = modules || {};
  const suggestions = [];
  if (!m.ai) suggestions.push('AI system not fully connected');
  if (!m.redis) suggestions.push('Redis inactive (optional performance boost)');
  if (missing && missing.length) {
    suggestions.push(`Missing: ${missing.join(', ')}`);
  }
  return suggestions;
}

async function getMissionStats() {
  if (!isDBConnected()) {
    return { users: 0, orders: 0, agents: 0, revenue: 0 };
  }
  try {
    const [users, agents, orders, revenueAgg] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'agent' }),
      Order.countDocuments(),
      Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const revenue = revenueAgg[0]?.total != null ? Number(revenueAgg[0].total) : 0;
    return { users, orders, agents, revenue };
  } catch {
    return { users: 0, orders: 0, agents: 0, revenue: 0 };
  }
}

/** Safe numeric snapshot (same shape as API stats). */
function normalizeStats(raw) {
  const s = raw || {};
  return {
    users: Math.max(0, Number(s.users) || 0),
    orders: Math.max(0, Number(s.orders) || 0),
    agents: Math.max(0, Number(s.agents) || 0),
    revenue: Math.max(0, Number(s.revenue) || 0),
  };
}

/**
 * Rule-based live alerts (upgrade later with persisted notifications).
 * @param {{ users: number; orders: number; agents: number; revenue: number }} stats
 */
function buildMissionAlerts(stats) {
  const alerts = [];
  const u = stats.users;
  const o = stats.orders;
  const a = stats.agents;
  if (o > 50) alerts.push('High order volume detected');
  if (u > 100) alerts.push('User growth increasing');
  if (a === 0 && u > 50) alerts.push('Agent system should be activated');
  return alerts;
}

/**
 * @param {{ users: number; orders: number; agents: number; revenue: number }} stats
 */
/**
 * @param {number} [foundationApproved] counts toward agent milestone
 */
function buildMilestones(stats, foundationApproved = 0) {
  const agentTotal = (stats.agents ?? 0) + Math.max(0, Number(foundationApproved) || 0);
  return [
    { id: 'users_10', label: 'First 10 users', done: stats.users >= 10 },
    { id: 'orders_50', label: 'First 50 orders', done: stats.orders >= 50 },
    { id: 'agents_5', label: 'First 5 agents', done: agentTotal >= 5 },
    { id: 'rev_10k', label: 'Revenue ₹10,000', done: stats.revenue >= 10000 },
  ];
}

/** Static onboarding checklist — product planning hooks (not DB state). */
function getAgentOnboardingActions() {
  return [
    'Create agent registration form',
    'Add commission system',
    'Enable agent approval',
    'Add location tagging',
  ];
}

/**
 * Agent network snapshot for mission control.
 */
async function getAgentData() {
  if (!isDBConnected()) {
    return { totalAgents: 0, activeAgents: 0, cities: [], pendingRequests: 0 };
  }
  try {
    const [totalAgents, activeAgents, pendingRequests, cityAgg] = await Promise.all([
      User.countDocuments({ role: 'agent' }),
      User.countDocuments({ role: 'agent', isApproved: true, activeOrders: { $gt: 0 } }),
      User.countDocuments({ role: 'agent', isApproved: false }),
      User.aggregate([
        { $match: { role: 'agent', isApproved: true, city: { $nin: [null, ''] } } },
        { $group: { _id: '$city', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 12 },
      ]),
    ]);
    const cities = cityAgg.map((c) => String(c._id || '').trim()).filter(Boolean);
    return { totalAgents, activeAgents, cities, pendingRequests };
  } catch {
    return { totalAgents: 0, activeAgents: 0, cities: [], pendingRequests: 0 };
  }
}

/**
 * @param {{ users?: number; orders?: number } | undefined} stats
 * @param {{ totalAgents?: number } | undefined} agentData
 * @param {Record<string, boolean> | undefined} modules
 */
function buildGrowthTriggers(stats, agentData, modules) {
  const triggers = [];
  const users = stats?.users ?? 0;
  const orders = stats?.orders ?? 0;
  const totalAgents = agentData?.totalAgents ?? 0;
  const m = modules || {};

  if (users > 50 && totalAgents === 0) {
    triggers.push('Start Agent System (users growing)');
  }
  if (orders > 100) {
    triggers.push('Enable automation for orders');
  }
  if (!m.ai) {
    triggers.push('Connect AI for faster operations');
  }
  if (totalAgents > 0 && orders > 50 && !m.redis) {
    triggers.push('Consider Redis for scale (queues / cache)');
  }
  return triggers;
}

module.exports = {
  buildRoadmap,
  buildMissionSuggestions,
  getMissionStats,
  normalizeStats,
  buildMissionAlerts,
  buildMilestones,
  getAgentOnboardingActions,
  getAgentData,
  buildGrowthTriggers,
};
