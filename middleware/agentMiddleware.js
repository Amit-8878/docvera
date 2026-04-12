/**
 * Requires JWT role === agent. Use after authMiddleware.
 * Fine-grained checks (e.g. approval) stay in controllers.
 */

function agentOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (req.user.role !== 'agent') {
    return res.status(403).json({ message: 'Forbidden', details: 'Agent only' });
  }
  return next();
}

module.exports = {
  agentOnly,
};
