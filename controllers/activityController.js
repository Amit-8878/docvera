const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

/**
 * GET /api/admin/activity-logs
 * Recent admin/activity audit rows for the ops dashboard.
 */
async function listActivityLogs(req, res, next) {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
    const rows = await AuditLog.find({ type: { $in: ['admin', 'activity'] } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actorId', 'name email role')
      .populate('userId', 'name email role')
      .lean();

    const items = rows.map((r) => ({
      id: String(r._id),
      action: r.message || r.type,
      type: r.type,
      user: r.actorId && typeof r.actorId === 'object'
        ? { name: r.actorId.name, email: r.actorId.email, role: r.actorId.role }
        : r.userId && typeof r.userId === 'object'
          ? { name: r.userId.name, email: r.userId.email, role: r.userId.role }
          : null,
      meta: r.meta || {},
      time: r.createdAt,
      ip: r.ip || '',
    }));

    return res.status(200).json({ logs: items });
  } catch (err) {
    return next(err);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.actorId
 * @param {string} opts.action
 * @param {object} [opts.meta]
 */
async function recordActivity(opts) {
  const { actorId, action, meta = {} } = opts || {};
  if (!actorId || !action) return null;
  const aid = mongoose.Types.ObjectId.isValid(String(actorId)) ? String(actorId) : null;
  if (!aid) return null;
  const oid = new mongoose.Types.ObjectId(aid);
  return AuditLog.create({
    type: 'activity',
    actorId: oid,
    userId: oid,
    message: String(action).slice(0, 500),
    meta: typeof meta === 'object' && meta ? meta : {},
  });
}

module.exports = {
  listActivityLogs,
  recordActivity,
};
