import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForJob, PrintFailedError, jobTimeoutMs } from '../src/job-watch.js';

// Runs waitForJob against a scripted sequence of poll results on a fake clock (1 s per poll).
async function run(statuses, { timeoutMs = 10_000, graceMs = 3_000, cancel } = {}) {
  let t = 0;
  let i = 0;
  const calls = { polls: 0, cancels: 0 };
  const promise = waitForJob({
    poll: async () => {
      calls.polls += 1;
      const s = statuses[Math.min(i++, statuses.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
    cancel: cancel || (async () => { calls.cancels += 1; }),
    timeoutMs,
    graceMs,
    intervalMs: 1000,
    sleep: async (ms) => { t += ms; },
    now: () => t,
  });
  return { promise, calls };
}

const pending = (extra = {}) => ({ finished: false, problem: null, ...extra });

test('resolves once the job completes', async () => {
  const { promise, calls } = await run([pending(), pending(), { finished: true, ok: true }]);
  await promise;
  assert.equal(calls.polls, 3);
  assert.equal(calls.cancels, 0);
});

test('a job that ends in failure rejects with its detail and is not cancelled again', async () => {
  const { promise, calls } = await run([pending(), { finished: true, ok: false, detail: 'The print job failed: Filter failed' }]);
  await assert.rejects(promise, (e) => e instanceof PrintFailedError && /Filter failed/.test(e.message));
  assert.equal(calls.cancels, 0);
});

test('a problem that persists for the grace period cancels the job', async () => {
  const p = pending({ problem: 'The print queue is paused. Fix the printer, then resume the queue' });
  const { promise, calls } = await run([p]);
  await assert.rejects(promise, /queue is paused.*The job was cancelled/);
  assert.equal(calls.cancels, 1);
  assert.equal(calls.polls, 4);
});

test('a problem that clears within the grace period does not fail the job', async () => {
  const p = pending({ problem: 'The printer reports com.brother-paper-size-error' });
  const { promise, calls } = await run([p, p, pending(), { finished: true, ok: true }]);
  await promise;
  assert.equal(calls.cancels, 0);
});

test('a job that never finishes times out, is cancelled, and reports the printer message', async () => {
  const { promise, calls } = await run([pending({ message: 'Filter failed' })], { timeoutMs: 5_000 });
  await assert.rejects(promise, /did not finish within 5 s \(printer says: Filter failed\)\. The job was cancelled/);
  assert.equal(calls.cancels, 1);
});

test('says so when cancelling fails', async () => {
  const p = pending({ problem: 'The printer reports PaperOut' });
  const { promise } = await run([p], { cancel: async () => { throw new Error('no'); } });
  await assert.rejects(promise, /Cancelling it failed; check the print queue/);
});

test('a status read error is reported without cancelling', async () => {
  const { promise, calls } = await run([new Error('CUPS did not answer in time')]);
  await assert.rejects(promise, /sent, but its status could not be read: CUPS did not answer/);
  assert.equal(calls.cancels, 0);
});

test('timeout grows with copies', () => {
  assert.equal(jobTimeoutMs(1), 32_000);
  assert.equal(jobTimeoutMs(100), 230_000);
});
