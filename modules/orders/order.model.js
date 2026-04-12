/**
 * Order documents: user ref, service ref, agent ref, pricing, payment, files.
 * Canonical schema: ../../models/Order.js
 * Logical mapping: userId→user, serviceId→service, assignedAgent→agent, documents→documents[],
 * price→totalPrice/amount, status (pending|assigned|processing|completed|cancelled; aliases in API).
 */
module.exports = require('../../models/Order');
