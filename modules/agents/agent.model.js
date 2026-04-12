/**
 * Runtime agent identity for orders, wallet, and APIs: `User` with `role: 'agent'`.
 * Geo: `latitude` / `longitude` on User (see models/User.js) for nearby search.
 *
 * Extended onboarding / application profile (separate collection): `server/src/models/agent.model.js` (ESM).
 */
module.exports = require('../../models/User');
