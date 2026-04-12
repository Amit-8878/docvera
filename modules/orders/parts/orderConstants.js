/**
 * Order domain constants (split from orderController for structure only; same values).
 */
const env = require('../../../config/env');

const ALLOWED_STATUSES = [
  'pending_payment',
  'pending',
  'paid',
  'assigned',
  'processing',
  'completed',
  'cancelled',
  'failed',
];

/** UI / API aliases mapped to stored enum values */
const STATUS_ALIASES = { 'in-progress': 'processing', rejected: 'cancelled', accepted: 'assigned', fail: 'failed' };

const PLATFORM_FEE_PERCENT = env.platformFeePercent;
const AUTO_RELEASE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Block rapid repeat creates (same user + service). */
const DUPLICATE_ORDER_SHORT_WINDOW_MS = 30 * 1000;
const MAX_AGENT_ACTIVE_ASSIGNMENTS = 3;
const AGENT_ACCEPT_TIMEOUT_MS = 2 * 60 * 1000;
const HIGH_VALUE_ORDER_INR = 5000;

module.exports = {
  ALLOWED_STATUSES,
  STATUS_ALIASES,
  PLATFORM_FEE_PERCENT,
  AUTO_RELEASE_AFTER_MS,
  DUPLICATE_ORDER_SHORT_WINDOW_MS,
  MAX_AGENT_ACTIVE_ASSIGNMENTS,
  AGENT_ACCEPT_TIMEOUT_MS,
  HIGH_VALUE_ORDER_INR,
};
