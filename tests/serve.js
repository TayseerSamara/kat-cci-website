// Minimal static server for tests, mirroring the live Hosting config:
// cleanUrls (/pay serves pay.html, /pay.html redirects to /pay) and no trailing slashes.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const PRIVATE = /(^|\/)\.|^\/(firebase\.json|firestore\.rules|tests)(\/|$)/;

function start(port = 5058) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (PRIVATE.test(p)) { res.writeHead(404); return res.end('Not found'); }
    if (p.length > 1 && p.endsWith('/')) { res.writeHead(301, { Location: p.slice(0, -1) + url.search }); return res.end(); }
    if (p.endsWith('.html')) { res.writeHead(301, { Location: (p === '/index.html' ? '/' : p.slice(0, -5)) + url.search }); return res.end(); }
    let file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 5058).then(() => console.log('serving on http://localhost:' + (process.argv[2] || 5058)));
