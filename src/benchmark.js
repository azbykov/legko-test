import { measureRequest } from './measure.js';
import { toMbitPerSec, toMBytePerSec } from './utils.js';

/**
 * Runs `count` requests strictly one after another and aggregates the results.
 * Any failed request aborts the run: an average with gaps would be misleading.
 *
 * @param {string} url
 * @param {{
 *   count?: number,
 *   timeoutMs?: number,
 *   onResult?: (result: Awaited<ReturnType<typeof measureRequest>>, index: number, count: number) => void,
 * }} [options]
 */
export async function runBenchmark(url, { count = 10, timeoutMs, onResult } = {}) {
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const result = await measureRequest(url, { timeoutMs });
    results.push(result);
    onResult?.(result, i, count);
  }
  return summarize(results);
}

/** Aggregates per-request results into totals, averages and throughput. */
export function summarize(results) {
  if (results.length === 0) {
    throw new Error('Nothing to summarize: no results');
  }
  const durations = results.map((r) => r.durationMs);
  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  const totalMs = durations.reduce((sum, d) => sum + d, 0);
  const totalTtfbMs = results.reduce((sum, r) => sum + r.ttfbMs, 0);
  const totalBodyMs = results.reduce((sum, r) => sum + r.bodyMs, 0);
  const encodings = [...new Set(results.map((r) => r.contentEncoding).filter(Boolean))];

  return {
    count: results.length,
    totalBytes,
    totalMs,
    avgMs: totalMs / results.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    avgTtfbMs: totalTtfbMs / results.length,
    // Speed is computed from totals, not as a mean of per-request speeds,
    // so it stays correct even when responses differ in size.
    // End-to-end: includes the wait before the first byte.
    mbitPerSec: toMbitPerSec(totalBytes, totalMs),
    mbytePerSec: toMBytePerSec(totalBytes, totalMs),
    // Transfer only: excludes the wait before the first byte, so it is
    // closer to the real connection speed. Null when the body arrived in
    // one instant chunk and the transfer time is too small to measure.
    transferMbitPerSec: totalBodyMs > 0 ? toMbitPerSec(totalBytes, totalBodyMs) : null,
    // Content encodings the server used despite `Accept-Encoding: identity`.
    encodings,
  };
}
