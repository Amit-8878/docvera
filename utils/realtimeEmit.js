const { getIo } = require('../socket/ioSingleton');

/**
 * Emit to all connected Socket.IO clients (same patterns as chat).
 * Use for dashboards / admin when payment or order events occur.
 */
function emitNewPayment(payload) {
  const io = getIo();
  if (!io) return;
  try {
    io.emit('new-payment', payload);
  } catch {
    /* ignore */
  }
}

module.exports = { emitNewPayment };
