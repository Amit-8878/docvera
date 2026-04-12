const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter;

function getTransport() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return transporter;
}

/**
 * @returns {Promise<{ sent: boolean; devLog?: string }>}
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@docvera.local';
  const t = getTransport();
  if (!t) {
    const devLog = `[email skipped — configure SMTP] To: ${to}\nSubject: ${subject}\n${text}`;
    if (env.nodeEnv !== 'production') {
      // eslint-disable-next-line no-console
      console.log(devLog);
    }
    return { sent: false, devLog };
  }
  await t.sendMail({
    from,
    to,
    subject,
    text,
    html: html || text.replace(/\n/g, '<br/>'),
  });
  return { sent: true };
}

module.exports = {
  sendMail,
};
