const Message = require('../models/Message');

const HOUR_MS = 60 * 60 * 1000;

function startMessageExpiryJob() {
  const run = async () => {
    try {
      const r = await Message.deleteMany({
        expiresAt: { $lte: new Date() },
      });
      if (r.deletedCount > 0) {
        // eslint-disable-next-line no-console
        console.log('[chat] expired messages deleted:', r.deletedCount);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[chat] message expiry cleanup failed:', e && e.message ? e.message : e);
    }
  };
  void run();
  setInterval(run, HOUR_MS);
}

module.exports = { startMessageExpiryJob };
