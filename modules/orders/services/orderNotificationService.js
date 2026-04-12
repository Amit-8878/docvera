/**
 * Order-related in-app notifications and welcome chat (not Express/socket emit).
 */
const { createNotification, notifyRoleUsers } = require('../../../services/notificationService');

async function notifyHighValueOrderAlert(orderId, amountInr) {
  try {
    const msg = `Order ${String(orderId)} — ₹${Number(amountInr || 0).toFixed(2)} (flag: high_value).`;
    await notifyRoleUsers('admin', {
      title: 'High value order detected',
      message: msg,
      type: 'system',
      event: 'high_value_order',
      data: { orderId: String(orderId), amount: amountInr, flags: ['high_value'] },
      dedupeKey: `high_value_order_${String(orderId)}`,
    });
    await notifyRoleUsers('super_admin', {
      title: 'High value order detected',
      message: msg,
      type: 'system',
      event: 'high_value_order',
      data: { orderId: String(orderId), amount: amountInr },
      dedupeKey: `high_value_order_sa_${String(orderId)}`,
    });
  } catch (e) {
    console.error('[safety] notifyHighValueOrderAlert', e && e.message ? e.message : e);
  }
}

async function notifyOrderAgentAssignment(populated) {
  const oid = String(populated._id);
  const userObj = populated.user && typeof populated.user === 'object' ? populated.user : null;
  if (userObj && userObj._id) {
    await createNotification({
      userId: userObj._id,
      role: 'user',
      title: 'Agent assigned',
      event: 'agent_assigned',
      data: { name: userObj.name || 'Customer', orderId: oid },
      type: 'order_in_progress',
      dedupeKey: `order_in_progress_${oid}_assigned`,
    });
  }
  if (populated.agent && typeof populated.agent === 'object' && populated.agent._id) {
    await createNotification({
      userId: populated.agent._id,
      role: 'agent',
      title: 'New assignment',
      message: `You have been assigned order ${oid}.`,
      type: 'order_in_progress',
      dedupeKey: `agent_assignment_${oid}_${String(populated.agent._id)}`,
    });
  }
}

async function postCustomRequestWelcomeMessage(req, threadUserId) {
  const Message = require('../../../models/Message');
  const User = require('../../../models/User');
  const { formatMessageDoc } = require('../../../routes/chatRoutes');
  const admin = await User.findOne({ role: { $in: ['admin', 'super_admin'] } }).select('_id').lean();
  const senderId = admin ? String(admin._id) : String(threadUserId);
  const msg = await Message.create({
    threadUserId: String(threadUserId),
    sender: senderId,
    senderRole: 'admin',
    receiverId: String(threadUserId),
    text: 'Admin will contact you shortly',
    type: 'text',
    isDelivered: true,
    isSeen: false,
  });
  const io = req.app && req.app.get('io');
  const saved = await Message.findById(msg._id).lean();
  const payload = formatMessageDoc(saved);
  if (io && payload) {
    io.to(String(threadUserId)).emit('receive_message', payload);
  }
}

module.exports = {
  notifyHighValueOrderAlert,
  notifyOrderAgentAssignment,
  postCustomRequestWelcomeMessage,
};
