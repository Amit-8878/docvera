const fs = require('fs');
const path = require('path');

/** Monorepo root (same as projectScanner). */
const ROOT = path.resolve(__dirname, '..', '..');
const MAX_CONTENT_BYTES = 512 * 1024;

const ALLOWED_TOP = new Set([
  'client',
  'server',
  'shared',
  'admin-panel',
  'scripts',
  'docs',
  'archive_unused',
  'archive_backup',
  'archive',
]);

/**
 * Normalize UI paths like `app/...` to `client/app/...`.
 * @param {string} input
 * @returns {string | null}
 */
function normalizeRelative(input) {
  if (typeof input !== 'string') return null;
  let rel = input.trim().replace(/\\/g, '/');
  if (!rel) return null;
  if (rel.startsWith('app/')) {
    rel = `client/${rel}`;
  }
  const normalized = path.normalize(rel);
  if (normalized.includes('..')) return null;
  return normalized;
}

/**
 * @param {string} relativePath
 * @returns {string | null} absolute path inside ROOT
 */
function resolveSafePath(relativePath) {
  const rel = normalizeRelative(relativePath);
  if (!rel) return null;
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT)) return null;
  const top = rel.split(/[/\\]/)[0];
  if (!ALLOWED_TOP.has(top)) return null;
  return full;
}

/**
 * Backup then write. Never writes without a successful backup copy first.
 * @param {string} relativePath
 * @param {string} content
 * @param {{ mode?: 'replace' | 'append' }} [options]
 */
function applyPatch(relativePath, content, options = {}) {
  const mode = options.mode === 'append' ? 'append' : 'replace';
  const str = String(content);
  if (Buffer.byteLength(str, 'utf8') > MAX_CONTENT_BYTES) {
    return { success: false, error: 'Content too large' };
  }

  const fullPath = resolveSafePath(relativePath);
  if (!fullPath) {
    return { success: false, error: 'Invalid or disallowed path' };
  }

  let st;
  try {
    st = fs.statSync(fullPath);
  } catch {
    return { success: false, error: 'File does not exist' };
  }
  if (!st.isFile()) {
    return { success: false, error: 'Not a file' };
  }

  const backupPath = `${fullPath}.bak`;

  try {
    fs.copyFileSync(fullPath, backupPath);
  } catch (err) {
    return { success: false, error: err.message || 'Backup failed' };
  }

  let newContent = str;
  if (mode === 'append') {
    const existing = fs.readFileSync(fullPath, 'utf8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    newContent = existing + sep + str;
  }

  try {
    fs.writeFileSync(fullPath, newContent, 'utf8');
  } catch (err) {
    try {
      fs.copyFileSync(backupPath, fullPath);
    } catch {
      /* best-effort restore */
    }
    return { success: false, error: err.message || 'Write failed' };
  }

  return {
    success: true,
    file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
    backup: path.relative(ROOT, backupPath).replace(/\\/g, '/'),
    mode,
  };
}

/**
 * Restore file from `.bak` created by applyPatch.
 * @param {string} relativePath
 */
function rollbackPatch(relativePath) {
  const fullPath = resolveSafePath(relativePath);
  if (!fullPath) {
    return { success: false, error: 'Invalid or disallowed path' };
  }
  const backupPath = `${fullPath}.bak`;
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: 'No backup found' };
  }
  try {
    fs.copyFileSync(backupPath, fullPath);
    return {
      success: true,
      file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
    };
  } catch (err) {
    return { success: false, error: err.message || 'Rollback failed' };
  }
}

module.exports = {
  applyPatch,
  rollbackPatch,
  resolveSafePath,
  ROOT,
};
