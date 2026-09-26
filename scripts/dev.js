const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('./build');

function createServer() {
  const root = path.join(__dirname, '..');
  const routes = new Map([
    ['auth/start', require('../api/auth/start')],
    ['auth/verify', require('../api/auth/verify')],
    ['auth/logout', require('../api/auth/logout')],
    ['auth/google', require('../api/auth/google')],
    ['auth/google/callback', require('../api/auth/google/callback')],
    ['usage/status', require('../api/usage/status')],
    ['usage/consume', require('../api/usage/consume')]
  ]);
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        const handler = routes.get(pathname.slice(5));
        if (handler) return await handler(req, res);
      } else {
        const name = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (/^[a-zA-Z0-9.-]+\.(html|txt|xml)$/.test(name)) {
          const file = path.join(root, 'public', name);
          if (fs.existsSync(file)) {
            const types = { '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml' };
            res.setHeader('Content-Type', types[path.extname(file)] + '; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(fs.readFileSync(file));
          }
        }
      }
      res.statusCode = 404;
      res.end('Not found');
    } catch (_) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'service_unavailable' }));
    }
  });
}
if (require.main === module) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('Local development only');
  process.env.NODE_ENV = 'development';
  const port = Number(process.env.PORT || 3000);
  process.env.APP_URL = `http://127.0.0.1:${port}`;
  process.env.ALLOWED_ORIGINS = `${process.env.APP_URL},http://localhost:${port}`;
  build();
  createServer().listen(port, '127.0.0.1', () => console.log(`Development server: ${process.env.APP_URL}`));
}
module.exports = { createServer };
