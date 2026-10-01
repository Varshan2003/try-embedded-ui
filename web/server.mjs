// Production server for the built frontend: static files from dist/ with security headers.
// The API is a separate service; set API_ORIGIN to its origin so the browser may call it.
import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const apiOrigin = process.env.API_ORIGIN || '';
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function headers(type, immutable) {
  return {
    'Content-Type': type,
    // Vite fingerprints everything under assets/, so only those may be cached forever.
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function safePath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(root, requested));
  return filePath.startsWith(`${root}/`) ? filePath : null;
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let filePath;
  try {
    filePath = safePath(request.url || '/');
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  if (!filePath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error('Not a file');
    const type = types[extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, { ...headers(type, filePath.startsWith(`${root}/assets/`)), 'Content-Length': stats.size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, headers('text/plain; charset=utf-8', false));
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Try Embedded web running at http://${host}:${port}`);
});
