const { runCommand } = require('../utils/commandExecutor');
const { isAllowed, ALLOWED_COMMANDS } = require('../utils/commandFilter');

function getAllowedCommands(req, res) {
  return res.status(200).json({ commands: ALLOWED_COMMANDS });
}

async function postRunCommand(req, res) {
  try {
    const { command } = req.body || {};
    if (!isAllowed(command)) {
      return res.status(200).json({ success: false, error: 'Command not allowed' });
    }
    const result = await runCommand(command);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message || 'run failed' });
  }
}

module.exports = { getAllowedCommands, postRunCommand };
