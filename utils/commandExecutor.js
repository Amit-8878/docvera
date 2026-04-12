const { exec } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 2 * 1024 * 1024;

/**
 * Run a whitelisted shell command from repo root (sync / short-lived commands only).
 * Long-running tasks (e.g. `npm run dev`) may hit the timeout — prefer PM2 on VPS.
 */
function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(
      cmd,
      {
        cwd: ROOT,
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (error) {
          return resolve({
            success: false,
            error: stderr?.trim() || error.message || 'Command failed',
            output: stdout?.trim() || '',
            code: error.code,
          });
        }
        resolve({
          success: true,
          output: out || stdout?.trim() || '',
        });
      }
    );
  });
}

module.exports = { runCommand, ROOT };
