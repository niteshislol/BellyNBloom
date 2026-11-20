// Minimal Upstash Redis REST client (no dependency). Works with the Vercel Marketplace Upstash integration.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const configured = () => !!(URL_ && TOKEN);

async function cmd(...args) {
  if (!configured()) throw new Error('Redis not configured');
  const r = await fetch(URL_.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Redis: ' + (j.error || r.status));
  return j.result;
}

// Counts hits per key inside a window. Returns the new count (0 if Redis is off, so nothing is blocked).
async function hit(key, windowSeconds) {
  if (!configured()) return 0;
  try {
    const n = Number(await cmd('INCR', key));
    if (n === 1) await cmd('EXPIRE', key, windowSeconds);
    return n;
  } catch { return 0; }
}

module.exports = { configured, cmd, hit };
