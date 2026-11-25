import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { createServer, MAX_PDF_BYTES } from '../src/server.js';

const SITE = 'https://shop.example';
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

const calls = [];
let failNext = null;
const printer = {
  async print(file, opts) {
    calls.push({ file, existed: existsSync(file), ...opts });
    if (failNext) { const e = failNext; failNext = null; throw e; }
    return { jobId: 'Q-1' };
  },
  async listPrinters() { return ['Other', 'QL']; },
};
const config = { platform: 'darwin', printerName: 'QL', allowedOrigins: [SITE], dryRunDir: null };

let server;
let port;
before(async () => {
  server = createServer({ config, printer, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const pdfPost = (extra = {}) => ({ headers: { 'content-type': 'application/pdf', origin: SITE, ...extra }, body: PDF });

test('health reports the configured printer', async () => {
  const r = await request('GET', '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, platform: 'darwin', printer: 'QL', dryRun: false });
});

test('printers reports whether the configured printer exists', async () => {
  const r = await request('GET', '/printers');
  assert.deepEqual(r.json, { configured: 'QL', configuredFound: true, printers: ['Other', 'QL'] });
});

test('serves the test page', async () => {
  const r = await request('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Label Print Agent/);
});

test('prints a PDF from an allowed origin and cleans up the temp file', async () => {
  calls.length = 0;
  const r = await request('POST', '/print?copies=2', pdfPost());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, jobId: 'Q-1', copies: 2, bytes: PDF.length });
  assert.equal(r.headers['access-control-allow-origin'], SITE);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].copies, 2);
  assert.equal(calls[0].existed, true);
  assert.equal(existsSync(calls[0].file), false);
});

test('copies defaults to 1', async () => {
  calls.length = 0;
  await request('POST', '/print', pdfPost());
  assert.equal(calls[0].copies, 1);
});

test('accepts the agent\'s own origin (test page)', async () => {
  const r = await request('POST', '/print', pdfPost({ origin: `http://127.0.0.1:${port}` }));
  assert.equal(r.status, 200);
});

test('rejects a disallowed origin, even on a simple text/plain request', async () => {
  calls.length = 0;
  const evil = { origin: 'https://evil.example' };
  assert.equal((await request('POST', '/print', pdfPost(evil))).status, 403);
  assert.equal((await request('POST', '/print', pdfPost({ ...evil, 'content-type': 'text/plain' }))).status, 403);
  assert.equal(calls.length, 0);
});

test('rejects a foreign Host header (DNS rebinding)', async () => {
  const r = await request('GET', '/health', { headers: { host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
});

test('preflight allows the site and private network access', async () => {
  const r = await request('OPTIONS', '/print', {
    headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], SITE);
  assert.equal(r.headers['access-control-allow-private-network'], 'true');
  assert.match(r.headers['access-control-allow-headers'], /Content-Type/);
});

test('rejects bad input without printing', async () => {
  calls.length = 0;
  assert.equal((await request('POST', '/print', pdfPost({ 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await request('POST', '/print', { ...pdfPost(), body: Buffer.from('hello') })).status, 400);
  assert.equal((await request('POST', '/print?copies=0', pdfPost())).status, 400);
  assert.equal((await request('POST', '/print?copies=101', pdfPost())).status, 400);
  assert.equal((await request('POST', '/print?copies=1.5', pdfPost())).status, 400);
  assert.equal(calls.length, 0);
});

test('size limit: exactly the limit prints, one byte over is 413', async () => {
  calls.length = 0;
  const atLimit = Buffer.alloc(MAX_PDF_BYTES, 0x20);
  PDF.copy(atLimit);
  assert.equal((await request('POST', '/print', { ...pdfPost(), body: atLimit })).status, 200);

  const over = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
  PDF.copy(over);
  assert.equal((await request('POST', '/print', { ...pdfPost(), body: over })).status, 413);
  assert.equal(calls.length, 1);
});

test('size limit is enforced without a Content-Length header', async () => {
  const over = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
  PDF.copy(over);
  const r = await request('POST', '/print', {
    headers: { 'content-type': 'application/pdf', 'transfer-encoding': 'chunked' },
    body: over,
  });
  assert.equal(r.status, 413);
});

test('a printer failure is reported as 502 with the printer\'s message', async () => {
  failNext = Object.assign(new Error('Command failed'), { stderr: 'lp: The printer or class does not exist.' });
  const r = await request('POST', '/print', pdfPost());
  assert.equal(r.status, 502);
  assert.match(r.json.error, /printer or class does not exist/);
});

test('unknown route is 404', async () => {
  assert.equal((await request('GET', '/nope')).status, 404);
});
