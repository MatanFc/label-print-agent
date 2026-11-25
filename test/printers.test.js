import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lpArgs, parseJobId, classifyCups } from '../src/printers/cups.js';
import { sumatraArgs, classifyWindows, jobStatusArgs, cancelJobArgs } from '../src/printers/windows.js';

test('macOS/Linux: lp targets the named printer with copies and options', () => {
  assert.deepEqual(
    lpArgs('/tmp/l.pdf', { printerName: 'Brother_QL_1100', copies: 3, orientation: 'portrait', lpOptions: ['media=62mm', 'fit-to-page'] }),
    ['-d', 'Brother_QL_1100', '-n', '3', '-o', 'media=62mm', '-o', 'fit-to-page', '/tmp/l.pdf'],
  );
});

test('macOS/Linux: landscape rotates the page 90 degrees', () => {
  assert.deepEqual(
    lpArgs('/tmp/l.pdf', { printerName: 'Brother_QL_1100', copies: 1, orientation: 'landscape', lpOptions: ['media=62mm'] }),
    ['-d', 'Brother_QL_1100', '-n', '1', '-o', 'orientation-requested=4', '-o', 'media=62mm', '/tmp/l.pdf'],
  );
});

test('Windows: SumatraPDF targets the named printer silently with copies, scaling and orientation', () => {
  assert.deepEqual(
    sumatraArgs('C:\\Temp\\l.pdf', { printerName: 'Brother QL-1100', copies: 2, scale: 'noscale', orientation: 'portrait' }),
    ['-print-to', 'Brother QL-1100', '-print-settings', '2x,noscale,portrait', '-silent', 'C:\\Temp\\l.pdf'],
  );
});

test('Windows: landscape is passed to SumatraPDF', () => {
  assert.deepEqual(
    sumatraArgs('C:\\Temp\\l.pdf', { printerName: 'Brother QL-1100', copies: 1, scale: 'noscale', orientation: 'landscape' }),
    ['-print-to', 'Brother QL-1100', '-print-settings', '1x,noscale,landscape', '-silent', 'C:\\Temp\\l.pdf'],
  );
});

test('macOS/Linux: reads the job id from lp', () => {
  assert.equal(parseJobId('request id is Brother_QL_1100-28 (1 file(s))\n'), 'Brother_QL_1100-28');
  assert.equal(parseJobId('lp: error'), null);
});

const job = (state) => ({ 'job-state': [state] });
const printer = (state, reasons = ['none'], message = '') => ({
  'printer-state': [state], 'printer-state-reasons': reasons, 'printer-state-message': [message],
});

test('macOS/Linux: finished job states', () => {
  assert.deepEqual(classifyCups(job(9), printer(3, ['ERROR:'])), { finished: true, ok: true });
  assert.deepEqual(classifyCups(job(7), printer(3)), { finished: true, ok: false, detail: 'The print job was cancelled' });
  assert.deepEqual(classifyCups(job(8), printer(3, ['none'], 'Filter failed')),
    { finished: true, ok: false, detail: 'The print job failed: Filter failed' });
});

test('macOS/Linux: problems while the job waits', () => {
  assert.equal(classifyCups(job(5), printer(4)).problem, null);
  assert.equal(classifyCups(job(5), printer(4, ['ERROR:'])).problem, null, 'malformed leftover reason is ignored');
  assert.equal(classifyCups(job(5), printer(4, ['com.brother-paper-size-error'])).problem,
    'The printer reports com.brother-paper-size-error');
  assert.match(classifyCups(job(3), printer(5, ['com.brother-tape-feed-error', 'paused'])).problem, /queue is paused/);
  assert.equal(classifyCups(job(6), printer(3)).problem, 'The print job is stopped');
  assert.equal(classifyCups(job(3), printer(3, ['none'], 'Filter failed')).message, 'Filter failed');
});

test('Windows: finished job states', () => {
  assert.deepEqual(classifyWindows({ printerStatus: 'Normal', found: false, jobStatus: '' }), { finished: true, ok: true });
  assert.deepEqual(classifyWindows({ printerStatus: 'Normal', found: true, jobStatus: 'Printed' }), { finished: true, ok: true });
  assert.deepEqual(classifyWindows({ printerStatus: 'Normal', found: true, jobStatus: 'Deleting, Printing' }),
    { finished: true, ok: false, detail: 'The print job was cancelled' });
});

test('Windows: problems while the job waits', () => {
  assert.equal(classifyWindows({ printerStatus: 'Normal', found: true, jobStatus: 'Spooling, Printing' }).problem, null);
  assert.equal(classifyWindows({ printerStatus: 'PaperOut', found: true, jobStatus: 'Printing' }).problem, 'The printer reports PaperOut');
  assert.equal(classifyWindows({ printerStatus: 'Normal', found: true, jobStatus: 'Error, Printing' }).problem,
    'The print job reports Error');
});

test('Windows: PowerShell finds the job by its unique document name, quoting the printer name', () => {
  const [, , , script] = jobStatusArgs("Bob's QL-1100", 'label-a1b2c3');
  assert.match(script, /Get-Printer -Name 'Bob''s QL-1100'/);
  assert.match(script, /Get-PrintJob -PrinterName 'Bob''s QL-1100' \| Where-Object \{ \$_\.DocumentName -like '\*label-a1b2c3\*' \}/);
  assert.match(script, /ConvertTo-Json -Compress$/);
  assert.match(cancelJobArgs('QL', 'label-a1b2c3')[3], /-like '\*label-a1b2c3\*' \} \| Remove-PrintJob$/);
});
