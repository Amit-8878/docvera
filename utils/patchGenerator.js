/**
 * Rule-based patch hints only — never writes to disk.
 * @param {string} issue
 * @returns {{ file: string; fix: string }}
 */
function generateFixPatch(issue) {
  const s = String(issue || '').toLowerCase();

  if (s.includes('busy')) {
    return {
      file: 'app/admin/ai-monitor/page.tsx',
      fix: "Add missing useState for 'busy'",
    };
  }

  if (s.includes('duplicate')) {
    return {
      file: 'multiple files',
      fix: 'Remove duplicate file or merge logic',
    };
  }

  return {
    file: 'unknown',
    fix: 'Manual investigation required',
  };
}

/**
 * @param {{
 *   runtime: Array<{ message: string; source: string; time: string }>;
 *   duplicates: Array<{ name: string; count: number }>;
 *   pendingDb: number;
 * }} p
 */
function buildProjectPatches({ runtime, duplicates, pendingDb }) {
  const patches = [];

  for (const e of runtime) {
    patches.push({
      issue: e.message,
      source: e.source,
      time: e.time,
      ...generateFixPatch(e.message),
    });
  }

  if (duplicates && duplicates.length > 0) {
    patches.push({
      issue: 'Duplicate filenames detected in repository tree (heuristic scan)',
      source: 'project_scan',
      time: null,
      ...generateFixPatch('duplicate'),
    });
  }

  if (pendingDb > 0) {
    patches.push({
      issue: `${pendingDb} pending captured error(s) in database`,
      source: 'error_log',
      time: null,
      file: 'AI System Monitor (pending rows)',
      fix: 'Review each row in AI System Monitor; apply code changes manually after verification.',
    });
  }

  return patches;
}

module.exports = { generateFixPatch, buildProjectPatches };
