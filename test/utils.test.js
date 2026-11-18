import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatMs, normalizeEncoding, toMbitPerSec, toMBytePerSec } from '../src/utils.js';

test('formatBytes uses decimal units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1000), '1.00 KB');
  assert.equal(formatBytes(5_242_880), '5.24 MB');
  assert.equal(formatBytes(2_500_000_000), '2.50 GB');
});

test('formatMs rounds to whole milliseconds', () => {
  assert.equal(formatMs(812.4), '812 ms');
  assert.equal(formatMs(0.6), '1 ms');
});

test('speed conversions', () => {
  // 1 MB in 1 second = 8 Mbit/s = 1 MB/s
  assert.equal(toMbitPerSec(1_000_000, 1000), 8);
  assert.equal(toMBytePerSec(1_000_000, 1000), 1);
  // 12.5 MB in 2 seconds = 50 Mbit/s
  assert.equal(toMbitPerSec(12_500_000, 2000), 50);
  assert.equal(toMbitPerSec(100, 0), 0);
});

test('normalizeEncoding hides identity and normalizes case', () => {
  assert.equal(normalizeEncoding(undefined), undefined);
  assert.equal(normalizeEncoding('identity'), undefined);
  assert.equal(normalizeEncoding(' Identity '), undefined);
  assert.equal(normalizeEncoding('GZIP'), 'gzip');
  assert.equal(normalizeEncoding(' br '), 'br');
});
