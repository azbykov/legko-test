import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runBenchmark, summarize } from '../src/benchmark.js';
import { measureRequest, HttpStatusError, EmptyBodyError } from '../src/measure.js';
import { startServer } from './helpers.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let server;
before(async () => {
  server = await startServer();
});
after(() => server.close());

test('measureRequest counts every byte of the body', async () => {
  const size = 1_234_567;
  const result = await measureRequest(`${server.baseUrl}/file?size=${size}`);
  assert.equal(result.status, 200);
  assert.equal(result.bytes, size);
  assert.ok(result.durationMs > 0);
});

test('measureRequest sends no-cache and identity encoding headers', async () => {
  await measureRequest(`${server.baseUrl}/file?size=10`);
  const { headers } = server.requests.at(-1);
  assert.equal(headers['cache-control'], 'no-cache');
  assert.equal(headers['accept-encoding'], 'identity');
});

test('measureRequest rejects on non-2xx status', async () => {
  await assert.rejects(measureRequest(`${server.baseUrl}/missing`), (error) => {
    assert.ok(error instanceof HttpStatusError);
    assert.equal(error.status, 404);
    return true;
  });
});

test('measureRequest rejects on timeout', async () => {
  await assert.rejects(measureRequest(`${server.baseUrl}/slow`, { timeoutMs: 200 }), {
    name: 'TimeoutError',
  });
});

test('measureRequest reports TTFB and body time separately', async () => {
  const result = await measureRequest(`${server.baseUrl}/delayed`);
  assert.equal(result.bytes, 10);
  // Headers arrive at once, the body only after ~100 ms: TTFB is the whole wait.
  assert.ok(result.ttfbMs >= 80, `ttfb ${result.ttfbMs}`);
  assert.ok(result.durationMs >= result.ttfbMs);
  assert.ok(Math.abs(result.durationMs - result.ttfbMs - result.bodyMs) < 1);
});

test('measureRequest counts compressed wire bytes, not decompressed ones', async () => {
  const result = await measureRequest(`${server.baseUrl}/gzip?size=1000000`);
  assert.equal(result.contentEncoding, 'gzip');
  assert.ok(result.bytes > 0 && result.bytes < 10_000, `bytes ${result.bytes}`);
});

test('measureRequest leaves contentEncoding undefined for plain responses', async () => {
  const result = await measureRequest(`${server.baseUrl}/file?size=10`);
  assert.equal(result.contentEncoding, undefined);
});

test('measureRequest follows redirects', async () => {
  const result = await measureRequest(`${server.baseUrl}/redirect`);
  assert.equal(result.status, 200);
  assert.equal(result.bytes, 1000);
});

test('measureRequest fails on a redirect loop', async () => {
  await assert.rejects(measureRequest(`${server.baseUrl}/loop`), /too many redirects/);
});

test('measureRequest rejects on an empty body', async () => {
  await assert.rejects(measureRequest(`${server.baseUrl}/empty`), EmptyBodyError);
});

test('runBenchmark makes exactly N sequential requests and sums bytes', async () => {
  const before = server.requests.length;
  const seen = [];
  const summary = await runBenchmark(`${server.baseUrl}/file?size=50000`, {
    count: 10,
    onResult: (_r, i) => seen.push(i),
  });
  assert.equal(server.requests.length - before, 10);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(summary.count, 10);
  assert.equal(summary.totalBytes, 500_000);
  assert.ok(summary.minMs <= summary.avgMs && summary.avgMs <= summary.maxMs);
  assert.ok(summary.mbitPerSec > 0);
});

test('summarize computes speed from totals', () => {
  const summary = summarize([
    { status: 200, bytes: 1_000_000, durationMs: 500, ttfbMs: 100, bodyMs: 400 },
    { status: 200, bytes: 3_000_000, durationMs: 1500, ttfbMs: 300, bodyMs: 1200 },
  ]);
  assert.equal(summary.totalBytes, 4_000_000);
  assert.equal(summary.totalMs, 2000);
  assert.equal(summary.avgMs, 1000);
  assert.equal(summary.minMs, 500);
  assert.equal(summary.maxMs, 1500);
  assert.equal(summary.avgTtfbMs, 200);
  assert.equal(summary.mbitPerSec, 16);
  assert.equal(summary.mbytePerSec, 2);
  // 4 MB over 1600 ms of pure transfer = 20 Mbit/s
  assert.equal(summary.transferMbitPerSec, 20);
  assert.deepEqual(summary.encodings, []);
});

test('summarize collects encodings and handles zero transfer time', () => {
  const summary = summarize([
    { status: 200, bytes: 10, durationMs: 5, ttfbMs: 5, bodyMs: 0, contentEncoding: 'gzip' },
    { status: 200, bytes: 10, durationMs: 5, ttfbMs: 5, bodyMs: 0, contentEncoding: 'gzip' },
    { status: 200, bytes: 10, durationMs: 5, ttfbMs: 5, bodyMs: 0, contentEncoding: 'br' },
  ]);
  assert.deepEqual(summary.encodings, ['gzip', 'br']);
  assert.equal(summary.transferMbitPerSec, null);
});

test('CLI prints summary for a working URL', async () => {
  const { stdout } = await exec('node', [CLI, `${server.baseUrl}/file?size=100000`, '-n', '3']);
  assert.match(stdout, /Request 3\/3: 200/);
  assert.match(stdout, /Total downloaded:\s+300\.00 KB \(300000 bytes\)/);
  assert.match(stdout, /Download speed:\s+[\d.]+ Mbit\/s/);
  assert.match(stdout, /Avg TTFB:\s+\d+ ms/);
  assert.match(stdout, /Transfer speed:/);
  assert.doesNotMatch(stdout, /Note:/);
});

test('CLI warns when the server compresses the response', async () => {
  const { stdout } = await exec('node', [CLI, `${server.baseUrl}/gzip?size=1000000`, '-n', '2']);
  assert.match(stdout, /\[gzip\]/);
  assert.match(stdout, /Note: the server compressed responses \(gzip\)/);
});

test('CLI exits with code 1 on an empty body', async () => {
  await assert.rejects(exec('node', [CLI, `${server.baseUrl}/empty`]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /empty response body/);
    return true;
  });
});

test('CLI shows the network error when the server is unreachable', async () => {
  await assert.rejects(exec('node', [CLI, 'http://127.0.0.1:1/', '-t', '2000']), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /ECONNREFUSED/);
    return true;
  });
});

test('CLI exits with code 1 on HTTP error', async () => {
  await assert.rejects(exec('node', [CLI, `${server.baseUrl}/missing`]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /HTTP 404/);
    return true;
  });
});

test('CLI exits with code 2 on bad arguments', async () => {
  for (const args of [[], ['not a url'], ['ftp://x'], ['http://x', '-n', '0']]) {
    await assert.rejects(exec('node', [CLI, ...args]), (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage:/);
      return true;
    });
  }
});
