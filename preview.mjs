import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const port = Number(process.argv[2] || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 to 65535.');

const publicFiles = new Set(['/index.html', '/reader.css', '/reader.js', '/preview-metadata.js', '/captured-page-shots.js']);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const url = new URL(request.url, 'http://127.0.0.1');
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!publicFiles.has(path) && !/^\/media\/(?:previews\/)?[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(path)) {
    response.writeHead(404).end();
    return;
  }

  const file = new URL(`.${path}`, import.meta.url);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    response.writeHead(404).end();
    return;
  }

  const headers = {
    'Content-Type': contentTypes[extname(path)],
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  };
  if (path === '/index.html' && process.argv.includes('--no-js')) {
    headers['Content-Security-Policy'] = "script-src 'none'";
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => console.log(`Preview at http://localhost:${port}/`));
