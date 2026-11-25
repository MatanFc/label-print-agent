import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestLabelPdf } from '../client/test-label.js';

test('produces a PDF whose xref offsets point at each object', () => {
  const pdf = Buffer.from(makeTestLabelPdf({ widthMm: 62, heightMm: 29, lines: ['A (b) \\ c', 'שלום'] })).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.ok(pdf.endsWith('%%EOF\n'));

  const startxref = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
  assert.ok(pdf.slice(startxref).startsWith('xref\n'));
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1}`));

  assert.match(pdf, /\/MediaBox \[0 0 175\.75 82\.2\]/);
  assert.match(pdf, /\(A \\\(b\\\) \\\\ c\) Tj/);
  assert.match(pdf, /\(\?\?\?\?\) Tj/);
});
