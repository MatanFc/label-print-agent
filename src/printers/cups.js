// macOS and Linux: print through CUPS with the `lp` command, then follow the job over IPP.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { jobTimeoutMs, waitForJob } from '../job-watch.js';
import { createIppClient } from './ipp.js';

const run = promisify(execFile);

const JOB = { processingStopped: 6, canceled: 7, aborted: 8, completed: 9 };
const PRINTER_STOPPED = 5;

export function lpArgs(file, { printerName, copies, orientation, lpOptions }) {
  const args = ['-d', printerName, '-n', String(copies)];
  // CUPS does not auto-rotate a landscape PDF onto portrait label media; 4 turns it 90 degrees.
  if (orientation === 'landscape') args.push('-o', 'orientation-requested=4');
  for (const option of lpOptions) args.push('-o', option);
  args.push(file);
  return args;
}

export function parseJobId(lpStdout) {
  const match = lpStdout.match(/request id is (\S+)/);
  return match ? match[1] : null;
}

/** Turns CUPS job + printer attributes into the shape waitForJob expects. */
export function classifyCups(job, printer) {
  const state = job['job-state']?.[0];
  const printerState = printer['printer-state']?.[0];
  const reasons = printer['printer-state-reasons'] ?? [];
  const message = printer['printer-state-message']?.[0] || null;

  if (state === JOB.completed) return { finished: true, ok: true };
  if (state === JOB.canceled) return { finished: true, ok: false, detail: 'The print job was cancelled' };
  if (state === JOB.aborted) {
    return { finished: true, ok: false, detail: `The print job failed${message ? `: ${message}` : ''}` };
  }

  // Drivers can leave a non-standard reason such as "ERROR:" behind after a later job succeeds,
  // so only well-formed "-error" reasons and a stopped queue count as problems.
  const errors = reasons.filter((r) => /^[a-z0-9.-]+-error$/.test(r));
  let problem = null;
  if (printerState === PRINTER_STOPPED || reasons.includes('paused')) {
    problem = 'The print queue is paused. Fix the printer, then resume the queue';
  } else if (errors.length) {
    problem = `The printer reports ${errors.join(', ')}`;
  } else if (state === JOB.processingStopped) {
    problem = 'The print job is stopped';
  }
  return { finished: false, problem, message };
}

export function createCupsPrinter(config, { ipp = createIppClient() } = {}) {
  return {
    async print(file, { copies }) {
      const { stdout } = await run('lp', lpArgs(file, { ...config, copies }));
      const jobId = parseJobId(stdout);
      if (!jobId) throw new Error(`lp did not report a job id: ${stdout.trim()}`);
      const jobNumber = Number(jobId.slice(jobId.lastIndexOf('-') + 1));

      await waitForJob({
        poll: async () => {
          const [job, printer] = await Promise.all([
            ipp.getJob(config.printerName, jobNumber),
            ipp.getPrinter(config.printerName),
          ]);
          return classifyCups(job, printer);
        },
        cancel: () => run('cancel', [jobId]),
        timeoutMs: jobTimeoutMs(copies),
      });
      return { jobId };
    },
    async listPrinters() {
      const { stdout } = await run('lpstat', ['-e']);
      return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    },
  };
}
