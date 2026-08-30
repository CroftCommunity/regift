// Tiny zero-dependency static file server for the hermetic e2e gate and local
// preview. Not a production server — just enough to serve `dist/` over HTTP so
// Playwright can drive the real built bundle.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 4173);
// Optional base prefix (e.g. /pr-preview/pr-1) to emulate a project-page /
// PR-preview subpath deploy. Requests under it are stripped before file lookup.
const base = (process.env.BASE ?? '').replace(/\/+$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (base) {
      if (pathname === base) pathname = '/';
      else if (pathname.startsWith(base + '/')) pathname = pathname.slice(base.length);
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    // Prevent path traversal outside the served directory.
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(dir, safe);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(port, () => {
  console.log(`serving ${dir} at http://localhost:${port}`);
});
