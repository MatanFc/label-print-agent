import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRequest, decodeResponse, TAG } from '../src/printers/ipp.js';

test('encodes a request with single and multi-valued attributes', () => {
  const buf = encodeRequest(0x0009, 7, [
    [TAG.charset, 'attributes-charset', 'utf-8'],
    [TAG.integer, 'job-id', 28],
    [TAG.keyword, 'requested-attributes', ['job-state', 'job-state-reasons']],
  ]);
  assert.deepEqual([...buf.subarray(0, 9)], [0x01, 0x01, 0x00, 0x09, 0, 0, 0, 7, TAG.operation]);
  assert.equal(buf[buf.length - 1], TAG.end);

  // A response has the same layout, with a status code where the operation id was.
  const { statusCode, attributes } = decodeResponse(buf);
  assert.equal(statusCode, 0x0009);
  assert.deepEqual(attributes, {
    'attributes-charset': ['utf-8'],
    'job-id': [28],
    'requested-attributes': ['job-state', 'job-state-reasons'],
  });
});

test('decodes enums, multiple groups and empty values', () => {
  const attr = (tag, name, value) => {
    const n = Buffer.from(name);
    const v = typeof value === 'number' ? Buffer.from([0, 0, 0, value]) : Buffer.from(value);
    return Buffer.concat([Buffer.from([tag, 0, n.length]), n, Buffer.from([0, v.length]), v]);
  };
  const buf = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0, 0, 0, 1]),
    Buffer.from([0x01]), attr(TAG.charset, 'attributes-charset', 'utf-8'),
    Buffer.from([0x04]),
    attr(TAG.enum, 'printer-state', 5),
    attr(TAG.keyword, 'printer-state-reasons', 'paused'),
    attr(TAG.keyword, '', 'com.brother-tape-feed-error'),
    attr(0x41, 'printer-state-message', ''),
    Buffer.from([TAG.end]),
  ]);
  const { statusCode, attributes } = decodeResponse(buf);
  assert.equal(statusCode, 0);
  assert.deepEqual(attributes['printer-state'], [5]);
  assert.deepEqual(attributes['printer-state-reasons'], ['paused', 'com.brother-tape-feed-error']);
  assert.deepEqual(attributes['printer-state-message'], ['']);
});

test('rejects a truncated response', () => {
  assert.throws(() => decodeResponse(Buffer.from([1, 1, 0])), /too short/);
});
