const fs = require('fs');
const path = require('path');
const { resolveSafePath, ROOT } = require('./filePatcher');

/**
 * Write proposed full file content next to the target as `.sandbox` (temp preview only).
 * @param {string} relativePath
 * @param {string} fullFileContent
 */
function applySandbox(relativePath, fullFileContent) {
  const fullPath = resolveSafePath(relativePath);
  if (!fullPath) {
    return { success: false, error: 'Invalid or disallowed path' };
  }
  const sandboxPath = `${fullPath}.sandbox`;
  try {
    fs.writeFileSync(sandboxPath, String(fullFileContent), 'utf8');
    return {
      success: true,
      sandboxPath,
      sandboxFile: path.relative(ROOT, sandboxPath).replace(/\\/g, '/'),
    };
  } catch (err) {
    return { success: false, error: err.message || 'Sandbox write failed' };
  }
}

module.exports = { applySandbox };
