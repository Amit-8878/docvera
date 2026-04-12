const { getSystemStatusPayload } = require('../services/systemStatusPayload');

async function getSystemStatus(req, res) {
  try {
    const payload = await getSystemStatusPayload();
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      ...payload,
    });
  } catch {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      maintenanceMode: false,
      chatEnabled: true,
      paymentEnabled: true,
      ordersEnabled: true,
      uploadsEnabled: true,
      servicesEnabled: true,
      referralEnabled: true,
    });
  }
}

module.exports = { getSystemStatus };
