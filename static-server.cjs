const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const dist = path.join(__dirname, 'dist');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};

const server = http.createServer((req, res) => {
  // Proxy /line/webhook to Gateway (18789) for LINE Bot
  if (req.url.startsWith('/line/')) {
    const opts = {hostname:'127.0.0.1', port:18789, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Gateway unavailable'));
    req.pipe(p);
    return;
  }
  // Proxy /ipc and /api to office server (18800)
  if (req.url.startsWith('/ipc') || req.url.startsWith('/api')) {
    const opts = {hostname:'127.0.0.1', port:18800, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Bad Gateway'));
    req.pipe(p);
    return;
  }
  // Proxy /faucet to tKAS Faucet server (18805)
  if (req.url.startsWith('/faucet')) {
    const opts = {hostname:'127.0.0.1', port:18805, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Faucet unavailable'));
    req.pipe(p);
    return;
  }
  // Proxy /kaspa/api to Kaspa API server (18806)
  if (req.url.startsWith('/kaspa/api')) {
    const opts = {hostname:'127.0.0.1', port:18806, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Kaspa API unavailable'));
    req.pipe(p);
    return;
  }
  // Proxy /whisper and /skill.md to Whisper API server (18803)
  // /whisper (no trailing slash) → landing page (rewrite to /)
  if (req.url === '/whisper') {
    const opts = {hostname:'127.0.0.1', port:18803, path:'/', method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Whisper API unavailable'));
    req.pipe(p);
    return;
  }
  if (req.url.startsWith('/whisper/') || req.url === '/skill.md') {
    const whisperPath = req.url.startsWith('/whisper/') ? req.url.replace('/whisper', '') : req.url;
    const opts = {hostname:'127.0.0.1', port:18803, path:whisperPath, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Whisper API unavailable'));
    req.pipe(p);
    return;
  }
  let fp = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!fs.existsSync(fp)) fp = path.join(dist, 'index.html');
  const ext = path.extname(fp);
  res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});

// WebSocket upgrade → proxy to office server (18800)
server.on('upgrade', (req, socket, head) => {
  const proxy = net.connect(18800, '127.0.0.1', () => {
    // Forward the original HTTP upgrade request
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    let headers = '';
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`;
    }
    proxy.write(reqLine + headers + '\r\n');
    if (head.length) proxy.write(head);
    // Bi-directional pipe
    socket.pipe(proxy).pipe(socket);
  });
  proxy.on('error', () => socket.end());
  socket.on('error', () => proxy.end());
});

server.listen(3000, '0.0.0.0', () => console.log('Static server on :3000 (with WS proxy)'));
