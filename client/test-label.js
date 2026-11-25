// Builds a one-page PDF of an exact label size with no dependencies, for testing the printer setup.
// Shared by the agent's test page (browser) and scripts/make-test-label.js (Node).

const MM_TO_PT = 72 / 25.4;
// Label printers can't print right up to the edge; QL rolls lose about 1.5 mm at the sides and 3 mm at the cut ends.
const BORDER_INSET_MM = 3;
const TEXT_INSET_MM = 5;
// Average Helvetica glyph width is well under 0.6 em, so this keeps lines inside the label.
const MAX_CHAR_WIDTH_EM = 0.6;

/**
 * @param {{widthMm?: number, heightMm?: number, lines?: string[]}} [options]
 * @returns {Uint8Array}
 */
export function makeTestLabelPdf({ widthMm = 62, heightMm = 29, lines = ['Test label'] } = {}) {
  if (!(widthMm > 0 && heightMm > 0)) throw new Error('widthMm and heightMm must be positive');
  const w = widthMm * MM_TO_PT;
  const h = heightMm * MM_TO_PT;
  const border = Math.min(BORDER_INSET_MM * MM_TO_PT, Math.min(w, h) / 4);
  const inset = Math.min(TEXT_INSET_MM * MM_TO_PT, Math.min(w, h) / 3);
  const text = lines.length ? lines : [' '];
  const longest = Math.max(1, ...text.map((l) => l.length));
  const fontSize = Math.max(4, Math.min(
    36,
    (h - 2 * inset) / (text.length * 1.2),
    (w - 2 * inset) / (longest * MAX_CHAR_WIDTH_EM),
  ));

  const ops = [`0.75 w ${fmt(border)} ${fmt(border)} ${fmt(w - 2 * border)} ${fmt(h - 2 * border)} re S`];
  text.forEach((line, i) => {
    const y = h - inset - fontSize * (i + 1) * 1.1;
    ops.push(`BT /F1 ${fmt(fontSize)} Tf ${fmt(inset)} ${fmt(y)} Td (${pdfString(line)}) Tj ET`);
  });
  const content = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(w)} ${fmt(h)}] ` +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  // Everything is ASCII, so string length equals byte offset.
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function fmt(n) {
  return Number(n.toFixed(2)).toString();
}

function pdfString(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
}
