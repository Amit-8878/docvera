const { ensureDefaults, getBooleanSetting } = require('./systemSettingsService');

/** Same shape as GET /api/public/system-status (camelCase JSON). */
async function getSystemStatusPayload() {
  await ensureDefaults();
  return {
    maintenanceMode: await getBooleanSetting('maintenance_mode', false),
    chatEnabled: await getBooleanSetting('chat_enabled', true),
    paymentEnabled: await getBooleanSetting('payment_enabled', true),
    ordersEnabled: await getBooleanSetting('orders_enabled', true),
    uploadsEnabled: await getBooleanSetting('uploads_enabled', true),
    servicesEnabled: await getBooleanSetting('services_enabled', true),
    referralEnabled: await getBooleanSetting('referral_enabled', true),
  };
}

module.exports = { getSystemStatusPayload };
