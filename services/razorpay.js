const Razorpay = require('razorpay');

let instance = null;

function getClient() {
  const key_id = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const key_secret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!key_id || !key_secret) {
    throw new Error(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env for live payments.'
    );
  }
  if (!instance) {
    instance = new Razorpay({ key_id, key_secret });
  }
  return instance;
}

/**
 * Lazy Razorpay client — avoids crashing API startup when keys are unset (local dev / SIMULATE_PAYMENT).
 * Throws only when payment code actually calls the gateway.
 */
module.exports = new Proxy(
  {},
  {
    get(_, prop) {
      const client = getClient();
      const v = client[prop];
      return typeof v === 'function' ? v.bind(client) : v;
    },
  }
);
