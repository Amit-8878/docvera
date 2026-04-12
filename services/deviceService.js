const User = require('../models/User');
const { clientIp } = require('./auditLogService');

const MAX_DEVICES = 20;

/**
 * Upsert device entry and trim list.
 */
async function recordDevice(userId, req) {
  const ip = clientIp(req);
  const userAgent = String(req.get && req.get('user-agent') ? req.get('user-agent') : '').slice(0, 500);
  const raw = req.get && req.get('x-device-id');
  const deviceId = typeof raw === 'string' ? raw.trim().slice(0, 128) : '';

  const user = await User.findById(userId);
  if (!user) return;

  const devices = Array.isArray(user.devices) ? [...user.devices] : [];
  const idx = devices.findIndex((d) => d.deviceId && deviceId && d.deviceId === deviceId);
  const now = new Date();
  if (idx >= 0) {
    devices[idx] = { ...devices[idx], ip, userAgent, lastActive: now };
  } else if (deviceId) {
    devices.push({ deviceId, ip, userAgent, lastActive: now });
  } else {
    devices.push({ deviceId: `ip:${ip}`, ip, userAgent, lastActive: now });
  }

  while (devices.length > MAX_DEVICES) devices.shift();

  user.devices = devices;
  await user.save();
}

module.exports = {
  recordDevice,
};
