/**
 * Exact-match whitelist only — no dynamic or user-built commands.
 * Keep in sync with admin UI labels.
 */
const ALLOWED_COMMANDS = ['npm run dev', 'npm start', 'pm2 restart all'];

function isAllowed(cmd) {
  if (typeof cmd !== 'string') return false;
  return ALLOWED_COMMANDS.includes(cmd.trim());
}

module.exports = { isAllowed, ALLOWED_COMMANDS };
