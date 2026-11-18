import http from 'node:http';
import zlib from 'node:zlib';

/**
 * Starts a local HTTP server on a random port.
 * Routes:
 *   /file?size=N   N bytes (sent in chunks)
 *   /delayed       200 with headers sent immediately, body starts after ~100 ms
 *   /gzip?size=N   N bytes of zeros, always gzip-compressed (ignores Accept-Encoding)
 *   /redirect      302 -> /file?size=1000
 *   /loop          302 -> /loop (redirect loop)
 *   /empty         200 with empty body
 *   /slow          never finishes
 *   anything else  404
 */
export async function startServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, headers: req.headers, search: url.search });

    if (url.pathname === '/file') {
      const size = Number(url.searchParams.get('size') ?? 1000);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size });
      const chunk = Buffer.alloc(64 * 1024, 7);
      let left = size;
      while (left > 0) {
        const n = Math.min(left, chunk.length);
        res.write(chunk.subarray(0, n));
        left -= n;
      }
      res.end();
      return;
    }
    if (url.pathname === '/delayed') {
      res.writeHead(200, { 'content-length': 10 });
      res.flushHeaders();
      setTimeout(() => res.end('0123456789'), 100);
      return;
    }
    if (url.pathname === '/gzip') {
      const size = Number(url.searchParams.get('size') ?? 100_000);
      const body = zlib.gzipSync(Buffer.alloc(size));
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length });
      res.end(body);
      return;
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: '/file?size=1000' });
      res.end();
      return;
    }
    if (url.pathname === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
      return;
    }
    if (url.pathname === '/empty') {
      res.writeHead(200, { 'content-length': 0 });
      res.end();
      return;
    }
    if (url.pathname === '/slow') {
      res.writeHead(200);
      res.write('partial');
      return; // never ends
    }
    res.writeHead(404, 'Not Found');
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
