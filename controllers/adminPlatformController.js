const adminPlatformService = require('../services/adminPlatformService');
const { standardSuccess } = require('../utils/response');

async function getPlatform(req, res, next) {
  try {
    const [feature_toggle, system_status, logs] = await Promise.all([
      adminPlatformService.getFeatureToggles(),
      adminPlatformService.getSystemStatus(),
      adminPlatformService.getRecentLogs({ limit: 30 }),
    ]);
    return res.status(200).json(
      standardSuccess({
        feature_toggle,
        system_status,
        logs_preview: logs,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function getLogs(req, res, next) {
  try {
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 50;
    const logs = await adminPlatformService.getRecentLogs({ limit });
    return res.status(200).json(standardSuccess({ logs }));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getPlatform,
  getLogs,
};
