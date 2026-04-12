const env = require('./env');

const settings = {
  inApp: env.notifInApp,
  whatsapp: env.notifWhatsapp,
};

function getNotificationSettings() {
  return { ...settings };
}

function updateNotificationSettings(next) {
  if (typeof next?.inApp === 'boolean') settings.inApp = next.inApp;
  if (typeof next?.whatsapp === 'boolean') settings.whatsapp = next.whatsapp;
  return getNotificationSettings();
}

module.exports = {
  getNotificationSettings,
  updateNotificationSettings,
};

