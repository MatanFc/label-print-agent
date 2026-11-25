// Shared by both printer adapters: after a job is handed to the OS, wait for its real outcome so the
// website hears "printed" only when the printer finished, and an error when it can't.
// Adapters supply `poll`, returning one of:
//   { finished: true, ok: true }
//   { finished: true, ok: false, detail }
//   { finished: false, problem }   problem: string describing what blocks the job, or null

export const POLL_INTERVAL_MS = 1000;
// A printer can briefly report a leftover error from an earlier job, so a problem must persist this long.
export const PROBLEM_GRACE_MS = 5000;

export class PrintFailedError extends Error {}

export function jobTimeoutMs(copies) {
  return 30_000 + 2_000 * copies;
}

export async function waitForJob({
  poll,
  cancel,
  timeoutMs,
  intervalMs = POLL_INTERVAL_MS,
  graceMs = PROBLEM_GRACE_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  let problem = null;
  let problemSince = 0;
  let lastMessage = null;

  for (;;) {
    let status;
    try {
      status = await poll();
    } catch (err) {
      throw new PrintFailedError(`The job was sent, but its status could not be read: ${err.message}`);
    }

    if (status.finished) {
      if (status.ok) return;
      throw new PrintFailedError(status.detail);
    }

    if (status.message) lastMessage = status.message;
    if (status.problem !== problem) {
      problem = status.problem || null;
      problemSince = now();
    }
    if (problem && now() - problemSince >= graceMs) {
      throw new PrintFailedError(`${problem}. ${await cancelOutcome(cancel)}`);
    }
    if (now() >= deadline) {
      const why = problem || (lastMessage ? `printer says: ${lastMessage}` : null);
      throw new PrintFailedError(
        `The printer did not finish within ${Math.round(timeoutMs / 1000)} s${why ? ` (${why})` : ''}. ` +
        await cancelOutcome(cancel),
      );
    }
    await sleep(intervalMs);
  }
}

async function cancelOutcome(cancel) {
  try {
    await cancel();
    return 'The job was cancelled, so it will not print later.';
  } catch {
    return 'Cancelling it failed; check the print queue, or it may print later.';
  }
}
