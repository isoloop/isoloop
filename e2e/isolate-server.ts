// Serves e2e/isolates/*.js from its own origin, so E2E tests can load an
// isolate cross-origin. `node e2e/isolate-server.ts <port> [--cors]`.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename } from 'node:path';

const port = Number(process.argv[2]);
const cors = process.argv.includes('--cors');
const dir = new URL('./isolates/', import.meta.url);

createServer((req, res) => {
  const name = basename(new URL(req.url ?? '/', 'http://x').pathname);
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  readFile(new URL(name, dir)).then(
    (body) => {
      res.writeHead(200, {
        'content-type': 'text/javascript',
        ...(cors ? { 'access-control-allow-origin': '*' } : {}),
      });
      res.end(body);
    },
    () => {
      res.writeHead(404).end();
    },
  );
}).listen(port);
