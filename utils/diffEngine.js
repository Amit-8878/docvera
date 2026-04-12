const fs = require('fs');
const { resolveSafePath } = require('./filePatcher');

const SNIPPET_LIMIT = 8000;

/**
 * Preview diff between current file on disk and proposed full new content.
 * @param {string} relativePath
 * @param {string} newFullContent
 */
function getDiff(relativePath, newFullContent) {
  const fullPath = resolveSafePath(relativePath);
  if (!fullPath) {
    return { error: 'Invalid path' };
  }
  const oldContent = fs.readFileSync(fullPath, 'utf8');
  const newStr = String(newFullContent);

  return {
    old: oldContent.slice(0, SNIPPET_LIMIT),
    new: newStr.slice(0, SNIPPET_LIMIT),
    oldLength: oldContent.length,
    newLength: newStr.length,
    truncated: oldContent.length > SNIPPET_LIMIT || newStr.length > SNIPPET_LIMIT,
  };
}

module.exports = { getDiff, SNIPPET_LIMIT };
