// Drop this file into your website. It talks to the label print agent running on the same computer
// as the browser. The agent only accepts pages whose origin is listed in its ALLOWED_ORIGINS.

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9123';

/**
 * Send a PDF to the label printer.
 * @param {Blob|ArrayBuffer|Uint8Array} pdf - one PDF; each page prints as one label
 * @param {{copies?: number, agentUrl?: string}} [options]
 * @returns {Promise<{ok: true, copies: number, bytes: number, jobId: string|null}>}
 */
export function printLabel(pdf, { copies = 1, agentUrl = DEFAULT_AGENT_URL } = {}) {
  return callAgent(`${agentUrl}/print?copies=${encodeURIComponent(copies)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
  });
}

/** Resolves with the agent's status, or rejects if the agent is not running on this computer. */
export function agentStatus({ agentUrl = DEFAULT_AGENT_URL } = {}) {
  return callAgent(`${agentUrl}/health`);
}

/** Printer names the agent can see, and whether its configured printer is among them. */
export function listPrinters({ agentUrl = DEFAULT_AGENT_URL } = {}) {
  return callAgent(`${agentUrl}/printers`);
}

async function callAgent(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    // The browser reports a rejected origin the same way as an agent that is not running.
    throw new Error(`Label print agent is not reachable. Check that it is running on this computer, ` +
      `that ${location.origin} is in its ALLOWED_ORIGINS, and that this site may access your local network.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Label print agent returned HTTP ${res.status}`);
  return data;
}
