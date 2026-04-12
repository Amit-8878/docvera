/**
 * Central env-based feature kill-switches (before DB / admin UI).
 * Complements Live Settings in MongoDB (systemFeatureMiddleware).
 *
 * Set FEATURE_PAYMENT=false etc. in server/.env for emergency off.
 * Future: Redis / queue consumers can read the same flags via env.
 */

const env = require('./env');

function truthyEnv(raw, defaultTrue = true) {
  if (raw === undefined || raw === null || raw === '') return defaultTrue;
  const s = String(raw).toLowerCase();
  return s !== 'false' && s !== '0' && s !== 'no' && s !== 'off';
}

const features = {
  payment: truthyEnv(process.env.FEATURE_PAYMENT, true),
  chat: truthyEnv(process.env.FEATURE_CHAT, true),
  upload: truthyEnv(process.env.FEATURE_UPLOAD, true),
  /** Reserved for server-side AI routes / workers (OpenAI, debugger, etc.). */
  ai: truthyEnv(process.env.FEATURE_AI, true),
};

module.exports = {
  features,
  /** For health/debug endpoints */
  featureSummary: () => ({
    payment: features.payment,
    chat: features.chat,
    upload: features.upload,
    ai: features.ai,
    nodeEnv: env.nodeEnv,
  }),
};
