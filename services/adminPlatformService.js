const AppLog = require('../models/AppLog');
const { getSystemStatusPayload } = require('./systemStatusPayload');

/**
 * Admin platform: feature toggles + system snapshot + recent operational logs.
 */
async function getFeatureToggles() {
  const s = await getSystemStatusPayload();
  return {
    maintenanceMode: s.maintenanceMode,
    chatEnabled: s.chatEnabled,
    paymentEnabled: s.paymentEnabled,
    ordersEnabled: s.ordersEnabled,
    uploadsEnabled: s.uploadsEnabled,
    servicesEnabled: s.servicesEnabled,
    referralEnabled: s.referralEnabled,
  };
}

async function getSystemStatus() {
  return getSystemStatusPayload();
}

async function getRecentLogs({ limit = 50 } = {}) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = await AppLog.find({})
    .sort({ createdAt: -1 })
    .limit(n)
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    type: r.type,
    level: r.level,
    message: r.message,
    meta: r.meta,
    createdAt: r.createdAt,
  }));
}

module.exports = {
  getFeatureToggles,
  getSystemStatus,
  getRecentLogs,
};
