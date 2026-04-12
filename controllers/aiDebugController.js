const mongoose = require('mongoose');
const ErrorLog = require('../models/ErrorLog');
const { applySafeAction, analyzeErrorLogById } = require('../services/aiDebugger');

async function listErrors(req, res, next) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const q = {};
    if (['pending', 'fixed', 'dismissed'].includes(status)) q.status = status;

    const rows = await ErrorLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    return res.status(200).json({
      errors: rows.map((r) => ({
        id: String(r._id),
        message: r.message,
        stack: r.stack,
        route: r.route,
        method: r.method,
        httpStatus: r.httpStatus,
        status: r.status,
        fileHint: r.fileHint || '',
        lineHint: r.lineHint,
        requestId: r.requestId || '',
        aiExplanationHi: r.aiExplanationHi || '',
        aiFixSuggestion: r.aiFixSuggestion || '',
        aiAnalyzedAt: r.aiAnalyzedAt,
        lastSafeAction: r.lastSafeAction || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function pendingCount(req, res, next) {
  try {
    const pending = await ErrorLog.countDocuments({ status: 'pending' });
    return res.status(200).json({ pending });
  } catch (err) {
    return next(err);
  }
}

async function postFix(req, res, next) {
  try {
    const { id, action } = req.body || {};
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: 'Bad request', details: 'id required' });
    }
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ message: 'Bad request', details: 'action required' });
    }
    const actorId = req.user?.userId || req.user?.id;
    const result = await applySafeAction(id, action, actorId);
    if (!result.ok) {
      return res.status(400).json({ message: result.message || 'Failed' });
    }
    return res.status(200).json({
      success: true,
      message: result.message,
      details: result.details,
    });
  } catch (err) {
    return next(err);
  }
}

/** Re-run AI analysis for one row (admin). */
async function reanalyze(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid id' });
    }
    await ErrorLog.findByIdAndUpdate(id, {
      $set: { aiExplanationHi: '', aiFixSuggestion: '', aiAnalyzedAt: null },
    });
    await analyzeErrorLogById(id);
    const doc = await ErrorLog.findById(id).lean();
    return res.status(200).json({
      ok: true,
      error: doc
        ? {
            id: String(doc._id),
            aiExplanationHi: doc.aiExplanationHi,
            aiFixSuggestion: doc.aiFixSuggestion,
          }
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listErrors,
  pendingCount,
  postFix,
  reanalyze,
};
