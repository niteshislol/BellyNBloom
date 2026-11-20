const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables from .env.local or .env if present
function loadEnv(filename) {
  const filepath = path.join(__dirname, filename);
  if (!fs.existsSync(filepath)) return;
  const content = fs.readFileSync(filepath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}
loadEnv('.env.local');
loadEnv('.env');

const PORT = parseInt(process.env.PORT || '3000', 10);
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'admin';
}

// In-memory mock Redis store for local testing if Upstash is not configured
const inMemoryStore = {
  lists: {},
  counters: {},
};
const mockUpstashPath = '/__mock_upstash_rest__';
if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  process.env.KV_REST_API_URL = `http://127.0.0.1:${PORT}${mockUpstashPath}`;
  process.env.KV_REST_API_TOKEN = 'mock-dev-token';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function handleMockRedis(req, res, body) {
  try {
    const args = JSON.parse(body || '[]');
    const cmd = String(args[0] || '').toUpperCase();
    let result = null;

    if (cmd === 'INCR') {
      const key = args[1];
      if (key && key.startsWith('bnb:login:')) {
        // In local development, never lock out the admin login
        result = 1;
      } else {
        inMemoryStore.counters[key] = (inMemoryStore.counters[key] || 0) + 1;
        result = inMemoryStore.counters[key];
      }
    } else if (cmd === 'EXPIRE') {
      result = 1;
    } else if (cmd === 'LPUSH') {
      const key = args[1];
      if (!inMemoryStore.lists[key]) inMemoryStore.lists[key] = [];
      for (let i = 2; i < args.length; i++) {
        inMemoryStore.lists[key].unshift(String(args[i]));
      }
      result = inMemoryStore.lists[key].length;
    } else if (cmd === 'LRANGE') {
      const key = args[1];
      const list = inMemoryStore.lists[key] || [];
      let start = parseInt(args[2], 10) || 0;
      let stop = parseInt(args[3], 10);
      if (start < 0) start = Math.max(0, list.length + start);
      if (stop < 0) stop = list.length + stop;
      result = list.slice(start, stop + 1);
    } else if (cmd === 'LTRIM') {
      const key = args[1];
      const list = inMemoryStore.lists[key] || [];
      let start = parseInt(args[2], 10) || 0;
      let stop = parseInt(args[3], 10);
      if (start < 0) start = Math.max(0, list.length + start);
      if (stop < 0) stop = list.length + stop;
      inMemoryStore.lists[key] = list.slice(start, stop + 1);
      result = 'OK';
    } else {
      result = 'OK';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Lazy load API handlers
const submitHandler = require('./api/submit');
const adminHandler = require('./api/admin');

function serveStatic(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${host}`);
  const pathname = parsedUrl.pathname;

  // Enhance res
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    origSetHeader(name, value);
    return res;
  };
  res.status = function(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function(data) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = function(data) {
    if (typeof data === 'object' && !Buffer.isBuffer(data)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
    } else {
      res.end(data);
    }
    return res;
  };

  // Collect request body
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      try { req.body = JSON.parse(rawBody); } catch { req.body = rawBody; }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      req.body = Object.fromEntries(new URLSearchParams(rawBody));
    } else {
      try { req.body = JSON.parse(rawBody); } catch { req.body = rawBody; }
    }

    req.query = Object.fromEntries(parsedUrl.searchParams);

    // 1. Mock Redis internal endpoint
    if (pathname === mockUpstashPath) {
      return handleMockRedis(req, res, rawBody);
    }

    // 2. API Routes & rewrites
    if (pathname === '/api/submit') {
      try {
        await submitHandler(req, res);
      } catch (err) {
        console.error('API Error /api/submit:', err);
        if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/admin' || pathname === '/api/admin') {
      try {
        await adminHandler(req, res);
      } catch (err) {
        console.error('API Error /admin:', err);
        if (!res.headersSent) res.status(500).send('Internal Server Error: ' + err.message);
      }
      return;
    }

    // 3. Static Files & Rewrites
    if (pathname === '/review' || pathname === '/review/') {
      return serveStatic(res, path.join(__dirname, 'public', 'review', 'index.html'));
    }

    const publicDir = path.join(__dirname, 'public');
    let targetPath = path.join(publicDir, pathname);

    // Prevent directory traversal
    if (!targetPath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(targetPath, (err, stats) => {
      if (!err && stats.isDirectory()) {
        const indexHtml = path.join(targetPath, 'index.html');
        if (fs.existsSync(indexHtml)) {
          return serveStatic(res, indexHtml);
        }
      }

      if (!err && stats.isFile()) {
        return serveStatic(res, targetPath);
      }

      // Default fallback to index.html for root or unknown routes
      if (pathname === '/' || !fs.existsSync(targetPath)) {
        return serveStatic(res, path.join(publicDir, 'index.html'));
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(` Belly n Bloom local development server running!`);
  console.log(` Local URL:        http://localhost:${PORT}`);
  console.log(` Concept Review:   http://localhost:${PORT}/#review`);
  console.log(` Admin Dashboard:  http://localhost:${PORT}/admin`);
  console.log(` Admin Password:   ${process.env.ADMIN_PASSWORD}`);
  console.log(`======================================================\n`);
});
