const http = require('http');
const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, 'dist');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};

const server = http.createServer((req, res) => {
  // Proxy /ipc and /api to office server
  if (req.url.startsWith('/ipc') || req.url.startsWith('/api')) {
    const opts = {hostname:'127.0.0.1', port:18800, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Bad Gateway'));
    req.pipe(p);
    return;
  }
  // WebSocket upgrade pass-through handled by ngrok directly? No, need ws proxy too.
  let fp = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(fp)) fp = path.join(dist, 'index.html');
  const ext = path.extname(fp);
  res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});

server.listen(3000, '0.0.0.0', () => console.log('Static server on :3000'));
