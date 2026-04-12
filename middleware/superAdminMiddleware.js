function superAdminOnly(req, res, next) {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden', details: 'Super admin only' });
}

module.exports = {
  superAdminOnly,
};
