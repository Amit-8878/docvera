const mongoose = require('mongoose');
const Order = require('../models/Order');

/**
 * Allows admin, or the agent assigned to the order, to upload final results.
 */
async function adminOrAssignedAgentForResultUpload(req, res, next) {
  try {
    const role = req.user?.role;
    if (role === 'admin') return next();
    if (role !== 'agent') {
      return res.status(403).json({ message: 'Forbidden', details: 'Admin or assigned agent only' });
    }
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Bad request', details: 'Invalid order id' });
    }
    const order = await Order.findById(id).select('agent').lean();
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (!order.agent || String(order.agent) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'Forbidden', details: 'Not assigned to this order' });
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  adminOrAssignedAgentForResultUpload,
};
