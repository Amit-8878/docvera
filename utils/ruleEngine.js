const fs = require('fs');
const path = require('path');
const { resolveSafePath, ROOT } = require('./filePatcher');

const MAX_CONTENT_BYTES = 512 * 1024;

/**
 * @param {{ file: string; content: unknown; mode?: string }} p
 * @returns {{ valid: boolean; reason?: string }}
 */
function validatePatch(p) {
  const { file, content, mode } = p || {};
  if (!file || typeof file !== 'string') {
    return { valid: false, reason: 'Invalid file path' };
  }
  if (content === undefined || content === null) {
    return { valid: false, reason: 'Invalid patch content' };
  }

  const str = String(content);
  if (str.length < 5) {
    return { valid: false, reason: 'Invalid patch content' };
  }
  if (Buffer.byteLength(str, 'utf8') > MAX_CONTENT_BYTES) {
    return { valid: false, reason: 'Content too large' };
  }

  const fullPath = resolveSafePath(file);
  if (!fullPath) {
    return { valid: false, reason: 'Invalid or disallowed path' };
  }

  const rel = path.relative(ROOT, fullPath).replace(/\\/g, '/').toLowerCase();
  if (rel.includes('.env')) {
    return { valid: false, reason: 'Protected file' };
  }
  if (rel.startsWith('server/config/')) {
    return { valid: false, reason: 'Protected path (server/config)' };
  }

  let st;
  try {
    st = fs.statSync(fullPath);
  } catch {
    return { valid: false, reason: 'File does not exist' };
  }
  if (!st.isFile()) {
    return { valid: false, reason: 'Not a file' };
  }

  const append = mode === 'append';
  if (append) {
    const existing = fs.readFileSync(fullPath, 'utf8');
    const sep = existing.endsWith('\n') ? '' : '\n';
    const merged = existing + sep + str;
    if (Buffer.byteLength(merged, 'utf8') > MAX_CONTENT_BYTES) {
      return { valid: false, reason: 'Resulting file would be too large' };
    }
  }

  return { valid: true };
}

module.exports = { validatePatch, MAX_CONTENT_BYTES };
