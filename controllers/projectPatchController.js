const fs = require('fs');
const { applyPatch, rollbackPatch, resolveSafePath } = require('../utils/filePatcher');
const { validatePatch } = require('../utils/ruleEngine');
const { applySandbox } = require('../utils/sandbox');
const { getDiff } = require('../utils/diffEngine');

function computeFullContent(file, content, mode) {
  const fullPath = resolveSafePath(file);
  if (!fullPath) return null;
  const str = String(content);
  if (mode === 'append') {
    const existing = fs.readFileSync(fullPath, 'utf8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    return existing + sep + str;
  }
  return str;
}

function postPreviewPatch(req, res) {
  try {
    const { file, content, mode } = req.body || {};
    const append = mode === 'append';
    const validation = validatePatch({ file, content, mode: append ? 'append' : 'replace' });
    if (!validation.valid) {
      return res.status(200).json({ success: false, reason: validation.reason });
    }

    const fullContent = computeFullContent(file, content, mode);
    if (fullContent === null) {
      return res.status(200).json({ success: false, reason: 'Invalid path' });
    }

    const sb = applySandbox(file, fullContent);
    if (!sb.success) {
      return res.status(200).json({ success: false, reason: sb.error || 'Sandbox failed' });
    }

    const diff = getDiff(file, fullContent);
    if (diff.error) {
      return res.status(200).json({ success: false, reason: diff.error });
    }

    return res.status(200).json({
      success: true,
      sandboxFile: sb.sandboxFile,
      diff: {
        old: diff.old,
        new: diff.new,
        oldLength: diff.oldLength,
        newLength: diff.newLength,
        truncated: diff.truncated,
      },
    });
  } catch (err) {
    return res.status(200).json({ success: false, reason: err.message || 'preview failed' });
  }
}

function postApplyPatch(req, res) {
  try {
    const { file, content, mode } = req.body || {};
    if (!file || typeof file !== 'string') {
      return res.status(200).json({ success: false, error: 'file is required', reason: 'file is required' });
    }
    if (content === undefined || content === null) {
      return res.status(200).json({ success: false, error: 'content is required', reason: 'content is required' });
    }

    const validation = validatePatch({ file, content, mode: mode === 'append' ? 'append' : 'replace' });
    if (!validation.valid) {
      return res.status(200).json({
        success: false,
        error: validation.reason,
        reason: validation.reason,
      });
    }

    const result = applyPatch(file, String(content), {
      mode: mode === 'append' ? 'append' : 'replace',
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'apply failed' });
  }
}

function postRollback(req, res) {
  try {
    const { file } = req.body || {};
    if (!file || typeof file !== 'string') {
      return res.status(200).json({ success: false, error: 'file is required' });
    }
    const result = rollbackPatch(file);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'rollback failed' });
  }
}

module.exports = { postPreviewPatch, postApplyPatch, postRollback };
