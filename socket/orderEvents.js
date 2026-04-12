/**
 * Realtime order + notification payloads (Socket.IO).
 * Uses rooms — not global io.emit — so only staff / owners / assigned agents receive events.
 *
 * Rooms:
 * - `orders:staff` — joined by admin + agent sockets (see chatSocket.js)
 * - `<userId>` — owner (and staff) already join personal room in chatSocket.js
 */

function emitNewOrder(io, orderPayload) {
  if (!io || !orderPayload) return;
  io.to('orders:staff').emit('new_order', orderPayload);
  if (orderPayload.userId) {
    io.to(String(orderPayload.userId)).emit('order_update', orderPayload);
  }
  const note = {
    type: 'new_order',
    title: 'New order',
    body: orderPayload.service ? String(orderPayload.service) : 'New order received',
    orderId: orderPayload.orderId,
  };
  io.to('orders:staff').emit('notification', note);
}

function emitOrderUpdate(io, orderPayload) {
  if (!io || !orderPayload) return;
  const uid = orderPayload.userId;
  if (uid) {
    io.to(String(uid)).emit('order_update', orderPayload);
  }
  io.to('orders:staff').emit('order_update', orderPayload);
  const agentId = orderPayload.assignedAgent || orderPayload.agent?.id;
  if (agentId) {
    io.to(String(agentId)).emit('order_update', orderPayload);
  }
  const note = {
    type: 'order_update',
    title: 'Order updated',
    body: `Status: ${orderPayload.status}${orderPayload.paymentStatus ? ` · Payment: ${orderPayload.paymentStatus}` : ''}`,
    orderId: orderPayload.orderId,
    status: orderPayload.status,
    paymentStatus: orderPayload.paymentStatus,
  };
  if (uid) io.to(String(uid)).emit('notification', note);
  io.to('orders:staff').emit('notification', note);
  if (agentId) io.to(String(agentId)).emit('notification', note);
}

function emitOrderUpdateFromPayment(io, orderPayload) {
  if (!io || !orderPayload) return;
  emitOrderUpdate(io, orderPayload);
  const uid = orderPayload.userId;
  if (uid) {
    io.to(String(uid)).emit('notification', {
      type: 'payment',
      title: 'Payment received',
      body: 'Your payment was verified.',
      orderId: orderPayload.orderId,
      paymentStatus: orderPayload.paymentStatus,
    });
  }
}

function getIo(req) {
  return req && req.app && req.app.get('io');
}

module.exports = {
  emitNewOrder,
  emitOrderUpdate,
  emitOrderUpdateFromPayment,
  getIo,
};
