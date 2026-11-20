let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  // Optional in environments where npm install hasn't been run yet
}

const configured = () => !!(nodemailer && process.env.MAIL_TO && process.env.SMTP_USER && process.env.SMTP_PASS);

async function sendMail({ subject, text, replyTo }) {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = (process.env.SMTP_SECURE || (port === 465 ? 'ssl' : 'tls')).toLowerCase();
  const tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port,
    secure: secure === 'ssl',
    requireTLS: secure === 'tls',
    ignoreTLS: secure === 'none',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  await tx.sendMail({
    from: `Belly n Bloom <${from}>`,
    to: process.env.MAIL_TO,
    replyTo: replyTo && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo) ? replyTo : undefined,
    subject, text,
  });
}

module.exports = { configured, sendMail };
