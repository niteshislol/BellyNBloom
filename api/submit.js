const crypto = require('crypto');
const redis = require('../lib/redis');
const mail = require('../lib/mail');
const { questions, KEY_RESPONSES, KEY_MAILERR, clean, ipHash, responseText } = require('../lib/util');

let waitUntil = null;
try { waitUntil = require('@vercel/functions').waitUntil; } catch { /* falls back to awaiting */ }

const MAX_PER_HOUR = Number(process.env.MAX_PER_HOUR || 30);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function validate(input) {
  const given = input && typeof input.answers === 'object' && input.answers ? input.answers : {};
  const answers = {};
  for (const q of questions) {
    if (!(q.id in given)) continue;
    const v = given[q.id];
    if (q.type === 'scale') { if (Number.isInteger(v) && v >= 1 && v <= 5) answers[q.id] = v; }
    else if (q.type === 'single') { if (typeof v === 'string' && q.opts.includes(v)) answers[q.id] = v; }
    else if (q.type === 'multi' && Array.isArray(v)) {
      let ok = [...new Set(v.filter((x) => typeof x === 'string' && q.opts.includes(x)))];
      if (q.max) ok = ok.slice(0, q.max);
      if (ok.length) answers[q.id] = ok;
    }
  }
  return answers;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (code) => res.status(code).json({ ok: false });
  if (req.method !== 'POST') return fail(405);

  // Same-site only
  const origin = req.headers.origin;
  if (origin) {
    let oh = ''; try { oh = new URL(origin).host.toLowerCase(); } catch { return fail(403); }
    const hh = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    if (oh !== hh) return fail(403);
  }

  let input = req.body;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { return fail(400); } }
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 40000) return fail(400);

  const answers = validate(input);
  const rec = {
    id: crypto.randomBytes(6).toString('hex'),
    receivedAt: new Date().toISOString(),
    submittedAt: ISO.test(input.submittedAt) ? input.submittedAt : '',
    agreedConfidentialityAt: ISO.test(input.agreedConfidentialityAt) ? input.agreedConfidentialityAt : '',
    answers,
    comment: clean(input.comment, 3000),
    name: clean(input.name, 200),
    email: clean(input.email, 200),
  };
  if (!Object.keys(answers).length && !rec.comment && !rec.name && !rec.email) return fail(400);

  // Per-IP hourly limit (needs Redis; IP is hashed and never stored in a response)
  if (redis.configured() && (await redis.hit('bnb:rl:' + ipHash(req, 'submit'), 3600)) > MAX_PER_HOUR) return fail(429);

  // 1) Save
  let stored = false;
  if (redis.configured()) {
    try { await redis.cmd('LPUSH', KEY_RESPONSES, JSON.stringify(rec)); stored = true; }
    catch (e) { console.error('store failed', e.message); }
  }

  // 2) Email copy
  const sendEmail = async () => {
    try {
      await mail.sendMail({
        subject: 'New Belly n Bloom survey response' + (rec.name ? ' from ' + rec.name.replace(/[\r\n]+/g, ' ') : ''),
        text: responseText(rec), replyTo: rec.email,
      });
      return true;
    } catch (e) {
      console.error('mail failed', e.message);
      if (redis.configured()) {
        try { await redis.cmd('LPUSH', KEY_MAILERR, new Date().toISOString() + ' ' + e.message); await redis.cmd('LTRIM', KEY_MAILERR, 0, 19); } catch {}
      }
      return false;
    }
  };

  if (stored) {
    // Saved: answer the doctor now, send the email in the background.
    if (mail.configured()) { const p = sendEmail(); if (waitUntil) waitUntil(p); else await p; }
    return res.status(200).json({ ok: true });
  }
  // Not saved (no database, or it failed): the email is the only copy, so wait for it.
  if (mail.configured() && (await sendEmail())) return res.status(200).json({ ok: true });
  return fail(500); // the page then shows its copy-and-email box
};
