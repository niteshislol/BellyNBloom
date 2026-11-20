const crypto = require('crypto');
const redis = require('../lib/redis');
const { questions: QS, KEY_RESPONSES, KEY_MAILERR, ipHash } = require('../lib/util');

const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update('bnb-session|' + PASSWORD).digest();
const TTL = 8 * 3600;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function loggedIn(req) {
  const m = /(?:^|;\s*)bnb_admin=(\d+)\.([0-9a-f]+)/.exec(req.headers.cookie || '');
  return !!(PASSWORD && m && Number(m[1]) > Date.now() / 1000 && safeEq(m[2], sign(m[1])));
}
function cookie(value, maxAge, req) {
  const isHttps = req && (req.headers['x-forwarded-proto'] === 'https' || req.connection?.encrypted);
  const secure = (isHttps || process.env.VERCEL) ? '; Secure' : '';
  return `bnb_admin=${value}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}
function html(res, body, code = 200) { res.status(code).setHeader('Content-Type', 'text/html; charset=utf-8').send(body); }

const STYLE = `<style>body{font:15px/1.5 system-ui,sans-serif;background:#fbf6f1;color:#2b2b2b;margin:0}.w{max-width:1000px;margin:0 auto;padding:20px}
h1{margin:0 0 4px}h2{margin:28px 0 8px}.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
a.b,button{background:#c2491d;color:#fff;border:0;border-radius:8px;padding:9px 14px;text-decoration:none;font:inherit;cursor:pointer}
.card{background:#fff;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 2px 10px #0001}
.o{display:grid;grid-template-columns:minmax(120px,40%) 1fr 36px;gap:8px;align-items:center;margin:4px 0;font-size:14px}
.t{background:#eee;border-radius:6px;height:12px}.t i{display:block;height:100%;background:#4c6b2f;border-radius:6px}
.r{border-top:1px solid #eee;padding:10px 0}.m{color:#777;font-size:13px}</style>`;
const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Belly n Bloom: results</title>`;

function loginPage(err) {
  return `<!doctype html><html lang="en"><head>${HEAD}<style>body{font:16px/1.5 system-ui,sans-serif;background:#fbf6f1;margin:0;display:grid;place-items:center;min-height:100vh}
form{background:#fff;padding:28px;border-radius:14px;box-shadow:0 4px 24px #0001;width:min(340px,90vw)}
input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;margin-top:10px;border-radius:8px;border:1px solid #ccc}
button{background:#c2491d;color:#fff;border:0;cursor:pointer}.e{color:#b00020}</style></head><body>
<form method="post" action="/admin"><h2 style="margin:0">Results login</h2><input type="hidden" name="action" value="login">
<input type="password" name="password" placeholder="Password" autofocus required>${err ? `<p class="e">${esc(err)}</p>` : ''}<button>Log in</button></form></body></html>`;
}

function cell(v) {
  if (Array.isArray(v)) v = v.join('; ');
  v = v == null ? '' : String(v);
  if (v && '=+-@\t\r'.includes(v[0])) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}

async function load() {
  if (!redis.configured()) return { rows: [], mailErr: [], noDb: true };
  const raw = await redis.cmd('LRANGE', KEY_RESPONSES, 0, -1);
  const rows = (raw || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean).reverse(); // oldest first
  let mailErr = []; try { mailErr = (await redis.cmd('LRANGE', KEY_MAILERR, 0, 2)) || []; } catch {}
  return { rows, mailErr, noDb: false };
}

function dashboard(rows, mailErr, noDb) {
  const n = rows.length;
  let out = `<!doctype html><html lang="en"><head>${HEAD}${STYLE}</head><body><div class="w"><h1>Belly n Bloom: survey results</h1>
<div class="m">${n} response${n === 1 ? '' : 's'} so far</div>
<div class="bar"><a class="b" href="/admin?download=csv">Download Excel/CSV</a><a class="b" href="/admin?download=json" style="background:#4c6b2f">Download backup (JSON)</a>
<form method="post" action="/admin" style="margin-left:auto"><input type="hidden" name="action" value="logout"><button style="background:#777">Log out</button></form></div>`;
  if (noDb) out += `<div class="card" style="border-left:4px solid #b00020"><b>No database connected.</b> Responses are only arriving by email. Connect Upstash Redis in the Vercel project (Storage tab) and redeploy.</div>`;
  if (mailErr.length) out += `<div class="card" style="border-left:4px solid #b00020"><b>Email problem</b> (responses are still saved here). Latest:<br><span class="m">${mailErr.map(esc).join('<br>')}</span><br><span class="m">Check SMTP_USER / SMTP_PASS in the Vercel environment variables.</span></div>`;
  out += '<h2>Summary</h2>';
  for (const q of QS) {
    const cnt = {}; let tot = 0, sum = 0;
    for (const r of rows) {
      const v = r.answers && r.answers[q.id]; if (v == null) continue;
      for (const x of [].concat(v)) cnt[x] = (cnt[x] || 0) + 1;
      tot++; if (q.type === 'scale') sum += Number(v);
    }
    const opts = q.type === 'scale' ? ['1', '2', '3', '4', '5'] : q.opts;
    const max = Math.max(1, ...Object.values(cnt));
    out += `<div class="card"><b>${q.n}. ${esc(q.title)}</b><div class="m">${tot} answered${q.type === 'scale' && tot ? ', average ' + (sum / tot).toFixed(2) + ' out of 5' : ''}</div>`;
    for (const o of opts) { const c = cnt[o] || 0; out += `<div class="o"><span>${esc(o)}</span><span class="t"><i style="width:${Math.round((c / max) * 100)}%"></i></span><span>${c}</span></div>`; }
    out += '</div>';
  }
  out += '<h2>Comments and contacts</h2><div class="card">';
  let any = false;
  for (const r of [...rows].reverse()) {
    if (!r.comment && !r.name && !r.email) continue; any = true;
    out += `<div class="r"><div class="m">${esc((r.receivedAt || '').slice(0, 16).replace('T', ' '))} UTC &middot; ${esc(r.name || 'Anonymous')}${r.email ? ' &middot; ' + esc(r.email) : ''}</div>${esc(r.comment || '').replace(/\n/g, '<br>')}</div>`;
  }
  if (!any) out += '<span class="m">Nothing yet.</span>';
  return out + '</div></div></body></html>';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');

  if (!PASSWORD) return html(res, loginPage('Set ADMIN_PASSWORD in the Vercel environment variables first.'), 503);

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  if (req.method === 'POST' && body.action === 'login') {
    if (redis.configured() && (await redis.hit('bnb:login:' + ipHash(req, 'login'), 900)) > 10) return html(res, loginPage('Too many attempts. Try again in 15 minutes.'), 429);
    if (safeEq(String(body.password || ''), PASSWORD)) {
      const exp = String(Math.floor(Date.now() / 1000) + TTL);
      res.setHeader('Set-Cookie', cookie(exp + '.' + sign(exp), TTL, req));
      res.status(303).setHeader('Location', '/admin'); return res.end();
    }
    await new Promise((r) => setTimeout(r, 1500));
    return html(res, loginPage('Wrong password.'), 401);
  }
  if (req.method === 'POST' && body.action === 'logout') {
    res.setHeader('Set-Cookie', cookie('', 0, req)); res.status(303).setHeader('Location', '/admin'); return res.end();
  }
  if (!loggedIn(req)) return html(res, loginPage(''));

  const { rows, mailErr, noDb } = await load();
  const dl = req.query && req.query.download;
  const day = new Date().toISOString().slice(0, 10);
  if (dl === 'csv') {
    const head = ['Received (UTC)', 'Agreed confidentiality', ...QS.map((q) => q.n + '. ' + q.title), 'Advice', 'Name', 'Email'];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) lines.push([r.receivedAt, r.agreedConfidentialityAt, ...QS.map((q) => r.answers && r.answers[q.id]), r.comment, r.name, r.email].map(cell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="belly-n-bloom-responses-${day}.csv"`);
    return res.status(200).send('\uFEFF' + lines.join('\r\n'));
  }
  if (dl === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="belly-n-bloom-backup-${day}.json"`);
    return res.status(200).send(JSON.stringify(rows, null, 2));
  }
  return html(res, dashboard(rows, mailErr, noDb));
};
