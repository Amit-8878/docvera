/**
 * Agent domain — meta recompute and related services already live in controllers/services.
 */

module.exports = {
  get recomputeAgentMeta() {
    return require('../../controllers/agentController').recomputeAgentMeta;
  },
};
