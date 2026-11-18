import http from 'node:http';
import https from 'node:https';
import { normalizeEncoding } from './utils.js';

export class HttpStatusError extends Error {
  constructor(status, statusText) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

export class EmptyBodyError extends Error {
  constructor() {
    super('empty response body (0 bytes), speed cannot be measured');
    this.name = 'EmptyBodyError';
  }
}

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const REQUEST_HEADERS = {
  accept: '*/*',
  // Ask every cache on the way (proxy, CDN) to revalidate.
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  // Ask the server not to compress the body. If it does anyway, node:http
  // still gives us the raw bytes, so we count what was really transferred.
  'accept-encoding': 'identity',
};

// Shared keep-alive agents: requests after the first reuse the connection,
// like a browser would. Idle sockets are unref'd, so they never block exit.
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};

/**
 * Performs one GET request (following redirects) and reads the whole body.
 *
 * Timing is measured from sending the request to receiving the last byte:
 * - `durationMs` is the whole request (what the user waits for);
 * - `ttfbMs` is the wait until the first body byte (DNS, TCP, TLS, server);
 * - `bodyMs` is the transfer time from the first to the last body byte.
 *
 * `bytes` is the number of body bytes received from the socket, without
 * decoding. If the server ignored `Accept-Encoding: identity`, this is the
 * compressed size and `contentEncoding` tells which encoding was used.
 *
 * @param {string | URL} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   status: number,
 *   bytes: number,
 *   durationMs: number,
 *   ttfbMs: number,
 *   bodyMs: number,
 *   contentEncoding: string | undefined,
 * }>}
 */
export async function measureRequest(url, { timeoutMs = 30_000 } = {}) {
  const start = performance.now();
  // One deadline for the whole request, redirects and body included.
  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = new URL(url);

  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await getResponse(currentUrl, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (REDIRECT_STATUSES.has(status) && location) {
        if (redirects >= MAX_REDIRECTS) {
          response.destroy();
          throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
        }
        // Drain the redirect response so the connection can be reused.
        response.resume();
        currentUrl = resolveRedirect(location, currentUrl);
        continue;
      }

      if (status < 200 || status >= 300) {
        response.destroy();
        throw new HttpStatusError(status, response.statusMessage);
      }

      // Read the body chunk by chunk: we only count bytes and never keep
      // the payload in memory, so large files are fine.
      let bytes = 0;
      let firstByteAt;
      for await (const chunk of response) {
        firstByteAt ??= performance.now();
        bytes += chunk.byteLength;
      }
      const end = performance.now();

      if (bytes === 0) throw new EmptyBodyError();

      return {
        status,
        bytes,
        durationMs: end - start,
        ttfbMs: firstByteAt - start,
        bodyMs: end - firstByteAt,
        contentEncoding: normalizeEncoding(response.headers['content-encoding']),
      };
    }
  } catch (error) {
    // Aborting the socket surfaces as a generic error; report the real reason.
    if (signal.aborted) throw signal.reason;
    throw error;
  }
}

/** Sends one GET request and resolves with the response as soon as headers arrive. */
function getResponse(url, signal) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      agent: agents[url.protocol],
      signal,
    });
    request.once('response', resolve);
    request.once('error', reject);
    request.end();
  });
}

function resolveRedirect(location, base) {
  let next;
  try {
    next = new URL(location, base);
  } catch {
    throw new Error(`invalid redirect location: ${location}`);
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    throw new Error(`redirect to unsupported protocol: ${next.protocol}`);
  }
  return next;
}