// Usage: node scripts/make-test-label.js [widthMm] [heightMm] [out.pdf] [text...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeTestLabelPdf } from '../client/test-label.js';

const [widthMm = '100', heightMm = '62', out = 'samples/test-label.pdf', ...text] = process.argv.slice(2);
const pdf = makeTestLabelPdf({
  widthMm: Number(widthMm),
  heightMm: Number(heightMm),
  lines: text.length ? text : [`Test label ${widthMm}x${heightMm}mm`, new Date().toISOString().slice(0, 16)],
});
await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(out, pdf);
console.log(`Wrote ${out} (${pdf.length} bytes)`);
