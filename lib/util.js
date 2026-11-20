const crypto = require('crypto');
const questions = require('./questions.json');

const KEY_RESPONSES = 'bnb:responses';
const KEY_MAILERR = 'bnb:mailerrors';

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
function ipHash(req, salt) {
  return crypto.createHash('sha256').update(clientIp(req) + salt + new Date().toISOString().slice(0, 10)).digest('hex').slice(0, 32);
}
function responseText(r) {
  const L = ['A new Belly n Bloom concept review was submitted.', '',
    'Received (UTC): ' + r.receivedAt, 'Agreed confidentiality: ' + (r.agreedConfidentialityAt || 'n/a'),
    'Name: ' + (r.name || '(not given)'), 'Email: ' + (r.email || '(not given)'), ''];
  for (const q of questions) {
    let a = r.answers[q.id]; if (Array.isArray(a)) a = a.join('; ');
    L.push(q.n + '. ' + q.title);
    L.push('   ' + (a == null || a === '' ? '(no answer)' : a + (q.type === 'scale' ? ' out of 5' : '')));
  }
  L.push('', 'Advice: ' + (r.comment || '(none)'));
  return L.join('\n') + '\n';
}

module.exports = { questions, KEY_RESPONSES, KEY_MAILERR, clean, clientIp, ipHash, responseText };
