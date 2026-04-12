const NotificationLog = require('../models/NotificationLog');
const { getNotificationSettings } = require('../config/notificationSettings');

const TEST_MODE = process.env.TEST_MODE !== 'false';
const MAX_RETRIES = 3;
const queue = [];
let processing = false;

function enqueueWhatsApp(job) {
  queue.push({ attempts: 0, ...job });
  void processQueue();
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

async function logResult({ userId, role, event, language, phone, message, status, error, meta }) {
  await NotificationLog.create({
    userId,
    role,
    event,
    channel: 'whatsapp',
    language,
    phone: phone || '',
    message,
    status,
    error: error || '',
    meta: meta || {},
  });
}

async function sendWhatsAppMessage(phone, message, context) {
  const settings = getNotificationSettings();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone format');
  }
  if (!settings.whatsapp || TEST_MODE) {
    // eslint-disable-next-line no-console
    console.log('WhatsApp MOCK:', message);
    await logResult({
      ...context,
      phone: normalizedPhone,
      message,
      status: 'sent',
      meta: { testMode: TEST_MODE, mock: true, formatted: normalizedPhone },
    });
    return { success: true, mock: true };
  }

  // Ready structure for real provider call. Disabled intentionally in phase 2.
  const payload = {
    to: phone,
    body: message,
  };
  // eslint-disable-next-line no-console
  console.log('WhatsApp PREPARED PAYLOAD:', payload);
  await logResult({
    ...context,
    phone: normalizedPhone,
    message,
    status: 'sent',
    meta: { prepared: true, formatted: normalizedPhone },
  });
  return { success: true, prepared: true };
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendWhatsAppMessage(job.phone, job.message, job.context);
    } catch (err) {
      const attempts = Number(job.attempts || 0) + 1;
      const errorText = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-await-in-loop
      await logResult({
        ...job.context,
        phone: job.phone,
        message: job.message,
        status: 'failed',
        error: errorText,
        meta: { attempts },
      });
      if (attempts < MAX_RETRIES) {
        queue.push({ ...job, attempts });
      }
    }
  }
  processing = false;
}

function getQueueStatus() {
  return { pending: queue.length, processing, testMode: TEST_MODE };
}

module.exports = {
  enqueueWhatsApp,
  sendWhatsAppMessage,
  getQueueStatus,
  TEST_MODE,
};

