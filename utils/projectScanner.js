const fs = require('fs');
const path = require('path');

/** Monorepo root (stable whether `node` is started from `server/` or project root). */
const ROOT = path.resolve(__dirname, '..', '..');

const IGNORE = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.nuxt',
  'out',
  '.vercel',
  'tmp',
  'temp',
  '.cursor',
  /** Filenames only — do not list env files in admin tree. */
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.test',
]);

const DEFAULT_MAX_DEPTH = 14;
const DEFAULT_MAX_NODES = 10000;

/**
 * Read-only directory walk. Skips symlinks to avoid cycles; caps depth and total nodes.
 * @param {string} [dir]
 * @param {{ maxDepth?: number; maxNodes?: number }} [opts]
 * @returns {{ tree: Array<{ name: string; type: string; children?: unknown; reason?: string }>; truncated: boolean; nodeCount: number }}
 */
function scanProject(dir = ROOT, opts = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  let nodeCount = 0;
  let truncated = false;

  function walk(currentDir, depth) {
    if (truncated) return [];
    if (depth > maxDepth) {
      truncated = true;
      return [{ name: '…', type: 'truncated', reason: 'max_depth' }];
    }

    const result = [];
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return result;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of entries) {
      if (truncated) break;
      const item = dirent.name;
      if (IGNORE.has(item)) continue;

      const fullPath = path.join(currentDir, item);
      let st;
      try {
        st = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;

      nodeCount += 1;
      if (nodeCount > maxNodes) {
        truncated = true;
        result.push({ name: '… (scan limit)', type: 'truncated', reason: 'max_nodes' });
        break;
      }

      if (st.isDirectory()) {
        result.push({
          name: item,
          type: 'folder',
          children: walk(fullPath, depth + 1),
        });
      } else if (st.isFile()) {
        result.push({ name: item, type: 'file' });
      }
    }

    return result;
  }

  const tree = walk(dir, 0);
  return { tree, truncated, nodeCount };
}

module.exports = { scanProject, ROOT, IGNORE };
