#!/usr/bin/env node
/**
 * serve-build.js: serves a prerendered build the way gamma and prod do.
 *
 * It runs the CloudFront Function itself (backend/cloudfront/site-router.js) on
 * every request, so local e2e runs test the same routing: /cli -> /cli/index.html,
 * Accept: text/markdown -> /cli.md, and a real 404 with 404.html for anything
 * that has no file.
 *
 * usage: node scripts/serve-build.js [build dir] [port]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const dir = path.resolve(process.argv[2] || 'build');
const port = Number(process.argv[3] || 3000);
const routerSource = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'cloudfront', 'site-router.js'), 'utf8');
const handler = vm.runInNewContext(`${routerSource}\nhandler;`);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

function send(res, status, file) {
  res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  let pathname;
  let search;
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(u.pathname);
    search = u.searchParams;
  } catch { pathname = '/'; search = new URLSearchParams(); }
  // The query string in CloudFront's shape, so redirects keep it the same way.
  const querystring = {};
  for (const [key, value] of search) querystring[key] = { value };
  const request = handler({ request: { uri: pathname, querystring, headers: { accept: { value: req.headers.accept || '' } } } });
  // A redirect (moved page, trailing slash) is answered by the function itself.
  if (request.statusCode) {
    res.writeHead(request.statusCode, { Location: request.headers.location.value, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  const file = path.join(dir, request.uri);
  if (file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, 200, file);
  const notFound = path.join(dir, '404.html');
  if (fs.existsSync(notFound)) return send(res, 404, notFound);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}).listen(port, () => console.log(`[ServeBuild] ${dir} on http://localhost:${port}`));
