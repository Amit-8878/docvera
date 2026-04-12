/**
 * Orders routes alias.
 *
 * Base mount in `server/server.js` is: `/api/orders`
 * This router exposes:
 * - POST `/`        (authMiddleware applied)  → create order
 * - GET  `/:id`     (authMiddleware applied)  → order details
 */
module.exports = require('./order.routes');

