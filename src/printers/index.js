import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createCupsPrinter } from './cups.js';
import { createWindowsPrinter } from './windows.js';

export function createPrinter(config) {
  const real = config.platform === 'win32' ? createWindowsPrinter(config) : createCupsPrinter(config);
  if (!config.dryRunDir) return real;

  return {
    async print(file, { copies }) {
      await mkdir(config.dryRunDir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-x${copies}.pdf`;
      const target = path.resolve(config.dryRunDir, name);
      await copyFile(file, target);
      return { jobId: null, savedTo: target };
    },
    listPrinters: real.listPrinters,
  };
}
