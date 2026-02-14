const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const dist = path.join(__dirname, 'dist');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};

const server = http.createServer((req, res) => {
  // Proxy /ipc and /api to office server
  if (req.url.startsWith('/ipc') || req.url.startsWith('/api')) {
    const opts = {hostname:'127.0.0.1', port:18800, path:req.url, method:req.method, headers:req.headers};
    const p = http.request(opts, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => res.writeHead(502).end('Bad Gateway'));
    req.pipe(p);
    return;
  }
  let fp = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
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
