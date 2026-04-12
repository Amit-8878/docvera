// Admin or super_admin (set by authMiddleware from JWT).

function adminOnly(req, res, next) {
  const r = req.user?.role;
  if (r === 'admin' || r === 'super_admin') {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden', details: 'Admin only' });
}

module.exports = {
  adminOnly,
};
