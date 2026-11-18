// Decimal (SI) units are used everywhere: 1 MB = 10^6 bytes, 1 Mbit = 10^6 bits.
// This matches how ISPs and speed-test services report bandwidth.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Human-readable size in decimal units, e.g. 5242880 -> "5.24 MB". */
export function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(2)} ${BYTE_UNITS[unit]}`;
}

/** Milliseconds rounded to whole numbers, e.g. 812.4 -> "812 ms". */
export function formatMs(ms) {
  return `${Math.round(ms)} ms`;
}

/** Throughput in megabits per second. */
export function toMbitPerSec(bytes, ms) {
  if (ms <= 0) return 0;
  return (bytes * 8) / (ms / 1000) / 1e6;
}

/** Throughput in megabytes per second. */
export function toMBytePerSec(bytes, ms) {
  if (ms <= 0) return 0;
  return bytes / (ms / 1000) / 1e6;
}

/**
 * Content-Encoding header -> lowercase encoding name, or undefined when the
 * body is not compressed (header missing or "identity").
 */
export function normalizeEncoding(header) {
  const value = header?.trim().toLowerCase();
  return value && value !== 'identity' ? value : undefined;
}

/** Error caused by invalid user input (CLI arguments). */
export class UsageError extends Error {}

export function parsePositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new UsageError(`${name} must be a positive integer, got "${value}"`);
  }
  return number;
}

export function parseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`Invalid URL: "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`Only http and https URLs are supported, got "${url.protocol}"`);
  }
  return url.href;
}
