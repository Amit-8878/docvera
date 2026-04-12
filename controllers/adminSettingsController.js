const SystemConfig = require('../models/SystemConfig');
const SystemSetting = require('../models/SystemSetting');
const { DEFAULTS, getAllSettingsMap, invalidateCache } = require('../services/systemSettingsService');
const { getSystemStatusPayload } = require('../services/systemStatusPayload');
const { getIo } = require('../socket/ioSingleton');

/**
 * GET /api/admin/global
 * Promise.all: SystemConfig (singleton) + all SystemSetting rows → merged toggles with DEFAULTS.
 */
async function getGlobalSettings(req, res, next) {
  try {
    const [config, settingDocs] = await Promise.all([SystemConfig.findOne().lean(), SystemSetting.find({}).lean()]);
    const fromDb = Object.fromEntries(
      (settingDocs || []).filter((r) => r && r.key).map((r) => [r.key, r.value])
    );
    const toggles = { ...DEFAULTS, ...fromDb };
    return res.status(200).json({
      success: true,
      pricing: config || {},
      toggles,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/pricing
 * SystemConfig singleton: merge req.body (e.g. { signupBonusAmount }).
 */
async function updatePricing(req, res, next) {
  try {
    const doc = await SystemConfig.findOneAndUpdate({}, req.body || {}, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });
    return res.status(200).json({ success: true, pricing: doc });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/admin/toggles
 * SystemSetting is key/value documents. For each field in req.body (or req.body.toggles),
 * upsert with findOneAndUpdate({ key }, …) — equivalent intent to a singleton update, but schema-safe.
 */
async function updateToggles(req, res, next) {
  try {
    const raw = req.body || {};
    const payload =
      raw.toggles != null && typeof raw.toggles === 'object' && !Array.isArray(raw.toggles)
        ? raw.toggles
        : raw.settings != null && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
          ? raw.settings
          : raw;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ message: 'Bad request', details: 'Expected JSON object of toggle keys/values' });
    }

    for (const [key, value] of Object.entries(payload)) {
      if (!key || typeof key !== 'string') continue;
      // eslint-disable-next-line no-await-in-loop
      await SystemSetting.findOneAndUpdate(
        { key },
        { $set: { key, value } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    }

    invalidateCache();
    const toggles = await getAllSettingsMap();
    const io = req.app.get('io') || getIo();
    if (io) {
      io.emit('settings_updated', { settings: toggles });
      try {
        const systemStatus = await getSystemStatusPayload();
        io.emit('system_update', systemStatus);
      } catch (_e) {
        /* non-fatal */
      }
    }

    return res.status(200).json({ success: true, toggles });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getGlobalSettings,
  updatePricing,
  updateToggles,
};
