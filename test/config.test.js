import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const base = { PORT: '9123', PRINTER_NAME: 'QL', ALLOWED_ORIGINS: 'https://a.example, http://localhost:3000' };

test('parses a valid macOS config', () => {
  const c = loadConfig(base, 'darwin');
  assert.equal(c.port, 9123);
  assert.deepEqual(c.allowedOrigins, ['https://a.example', 'http://localhost:3000']);
  assert.equal(c.scale, 'noscale');
  assert.equal(c.orientation, 'portrait');
  assert.equal(loadConfig({ ...base, ORIENTATION: 'landscape' }, 'darwin').orientation, 'landscape');
  assert.deepEqual(c.lpOptions, []);
});

test('names every missing setting', () => {
  assert.throws(() => loadConfig({}, 'darwin'), /PORT, PRINTER_NAME, ALLOWED_ORIGINS/);
});

test('Windows requires an existing SUMATRA_PATH unless dry run', () => {
  assert.throws(() => loadConfig(base, 'win32'), /SUMATRA_PATH/);
  assert.throws(() => loadConfig({ ...base, SUMATRA_PATH: 'C:\\missing\\s.exe' }, 'win32'), /does not point to a file/);
  const existing = fileURLToPath(import.meta.url);
  assert.equal(loadConfig({ ...base, SUMATRA_PATH: existing }, 'win32').sumatraPath, existing);
  assert.equal(loadConfig({ ...base, DRY_RUN_DIR: 'out' }, 'win32').dryRunDir, 'out');
});

test('rejects bad values', () => {
  assert.throws(() => loadConfig({ ...base, PORT: '70000' }, 'darwin'), /PORT/);
  assert.throws(() => loadConfig({ ...base, PRINT_SCALE: 'zoom' }, 'darwin'), /PRINT_SCALE/);
  assert.throws(() => loadConfig({ ...base, ORIENTATION: 'sideways' }, 'darwin'), /ORIENTATION/);
  assert.throws(() => loadConfig({ ...base, ALLOWED_ORIGINS: 'https://a.example/' }, 'darwin'), /ALLOWED_ORIGINS/);
  assert.throws(() => loadConfig(base, 'aix'), /Unsupported platform/);
});
