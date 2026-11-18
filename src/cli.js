#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runBenchmark } from './benchmark.js';
import { formatBytes, formatMs, parsePositiveInt, parseUrl, UsageError } from './utils.js';

const USAGE = `Usage: node src/cli.js <url> [options]

Makes N sequential GET requests to <url>, waits for each full response
and prints average request time, total downloaded size and download speed.

Options:
  -n, --count <number>     number of requests (default: 10)
  -t, --timeout <ms>       timeout per request in milliseconds (default: 30000)
  -h, --help               show this help

Units: sizes in MB (10^6 bytes), speed in Mbit/s (10^6 bits per second).`;

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        count: { type: 'string', short: 'n', default: '10' },
        timeout: { type: 'string', short: 't', default: '30000' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) {
    throw new UsageError(positionals.length === 0 ? 'URL is required' : 'Expected exactly one URL');
  }

  return {
    url: parseUrl(positionals[0]),
    count: parsePositiveInt(values.count, '--count'),
    timeoutMs: parsePositiveInt(values.timeout, '--timeout'),
  };
}

function describeError(error) {
  if (error?.name === 'TimeoutError') return 'request timed out';
  // Some network errors (e.g. AggregateError on connect) have an empty message, only a code.
  return error?.message || error?.code || String(error);
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`Error: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { url, count, timeoutMs } = options;
  console.log(`Testing ${url} with ${count} sequential requests...\n`);

  const width = String(count).length;
  let summary;
  try {
    summary = await runBenchmark(url, {
      count,
      timeoutMs,
      onResult: ({ status, bytes, durationMs, ttfbMs, contentEncoding }, index) => {
        const n = String(index + 1).padStart(width);
        const encoding = contentEncoding ? `  [${contentEncoding}]` : '';
        console.log(
          `Request ${n}/${count}: ${status}  ${formatBytes(bytes).padStart(10)}  ${formatMs(durationMs).padStart(9)}  TTFB ${formatMs(ttfbMs).padStart(7)}${encoding}`,
        );
      },
    });
  } catch (error) {
    console.error(`\nError: ${describeError(error)}`);
    process.exitCode = 1;
    return;
  }

  const transfer =
    summary.transferMbitPerSec === null ? 'n/a' : `${summary.transferMbitPerSec.toFixed(2)} Mbit/s`;

  console.log(`
Requests:          ${summary.count}
Total downloaded:  ${formatBytes(summary.totalBytes)} (${summary.totalBytes} bytes)
Avg request time:  ${formatMs(summary.avgMs)} (min ${formatMs(summary.minMs)}, max ${formatMs(summary.maxMs)})
Avg TTFB:          ${formatMs(summary.avgTtfbMs)}
Download speed:    ${summary.mbitPerSec.toFixed(2)} Mbit/s (${summary.mbytePerSec.toFixed(2)} MB/s), end-to-end
Transfer speed:    ${transfer}, body only (without TTFB)`);

  if (summary.encodings.length > 0) {
    console.log(
      `\nNote: the server compressed responses (${summary.encodings.join(', ')}) despite ` +
        'Accept-Encoding: identity.\nSize and speed are based on compressed bytes actually received.',
    );
  }
}

main();
