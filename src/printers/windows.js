// Windows has no built-in command that prints a PDF to a named printer, so SumatraPDF does it;
// the job is then followed in the Windows print queue with PowerShell.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { jobTimeoutMs, waitForJob } from '../job-watch.js';

const run = promisify(execFile);

// Printer and job states that need someone at the printer.
const PRINTER_PROBLEMS = new Set([
  'Paused', 'Error', 'PaperJam', 'PaperOut', 'PaperProblem', 'Offline', 'UserIntervention',
  'DoorOpen', 'NotAvailable', 'NoToner', 'OutOfMemory',
]);
const JOB_PROBLEMS = ['Error', 'Offline', 'PaperOut', 'Paused', 'Blocked', 'UserIntervention'];

export function sumatraArgs(file, { printerName, copies, scale, orientation }) {
  const settings = [`${copies}x`, scale, orientation].join(',');
  return ['-print-to', printerName, '-print-settings', settings, '-silent', file];
}

export const LIST_PRINTERS_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-Printer | Select-Object -ExpandProperty Name',
];

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function findJob(printerName, documentTag) {
  return `Get-PrintJob -PrinterName ${psQuote(printerName)} | ` +
    `Where-Object { $_.DocumentName -like ${psQuote(`*${documentTag}*`)} }`;
}

/** PowerShell that prints one JSON line: the printer's status and our job's status, if still queued. */
export function jobStatusArgs(printerName, documentTag) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-Printer -Name ${psQuote(printerName)}`,
    `$j = @(${findJob(printerName, documentTag)} | Select-Object -First 1)`,
    '[pscustomobject]@{ printerStatus = "$($p.PrinterStatus)"; found = ($j.Count -gt 0); ' +
      'jobStatus = $(if ($j.Count) { "$($j[0].JobStatus)" } else { "" }) } | ConvertTo-Json -Compress',
  ].join('; ');
  return ['-NoProfile', '-NonInteractive', '-Command', script];
}

export function cancelJobArgs(printerName, documentTag) {
  return ['-NoProfile', '-NonInteractive', '-Command', `${findJob(printerName, documentTag)} | Remove-PrintJob`];
}

/** Turns the jobStatusArgs output into the shape waitForJob expects. */
export function classifyWindows({ printerStatus, found, jobStatus }) {
  const jobFlags = String(jobStatus || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Windows removes a job from the queue once the printer has taken it.
  if (!found || jobFlags.includes('Printed')) return { finished: true, ok: true };
  if (jobFlags.includes('Deleting') || jobFlags.includes('Deleted')) {
    return { finished: true, ok: false, detail: 'The print job was cancelled' };
  }

  const jobProblems = jobFlags.filter((f) => JOB_PROBLEMS.includes(f));
  let problem = null;
  if (PRINTER_PROBLEMS.has(printerStatus)) problem = `The printer reports ${printerStatus}`;
  else if (jobProblems.length) problem = `The print job reports ${jobProblems.join(', ')}`;
  return { finished: false, problem, message: jobStatus || null };
}

export function createWindowsPrinter(config) {
  const powershell = (args) => run('powershell.exe', args, { windowsHide: true });

  return {
    async print(file, { copies }) {
      await run(config.sumatraPath, sumatraArgs(file, { ...config, copies }), { windowsHide: true });
      // The queue shows the file name as the document name; the server makes it unique per job.
      const documentTag = path.basename(file, path.extname(file));

      await waitForJob({
        poll: async () => {
          const { stdout } = await powershell(jobStatusArgs(config.printerName, documentTag));
          return classifyWindows(JSON.parse(stdout));
        },
        cancel: () => powershell(cancelJobArgs(config.printerName, documentTag)),
        timeoutMs: jobTimeoutMs(copies),
      });
      return { jobId: null };
    },
    async listPrinters() {
      const { stdout } = await powershell(LIST_PRINTERS_ARGS);
      return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    },
  };
}
