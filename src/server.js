import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createPrinter } from './printers/index.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_COPIES = 100;

const CLIENT_DIR = fileURLToPath(new URL('../client/', import.meta.url));
const STATIC_FILES = {
  '/': ['test-page.html', 'text/html; charset=utf-8'],
  '/client/label-printer.js': ['label-printer.js', 'text/javascript; charset=utf-8'],
  '/client/test-label.js': ['test-label.js', 'text/javascript; charset=utf-8'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createServer({ config, printer, log = console.log }) {
  return http.createServer((req, res) => {
    handle(req, res, { config, printer, log }).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log(`ERROR ${req.method} ${req.url}: ${err.stack || err}`);
      if (!res.headersSent) sendJson(res, status, { error: err.message });
      else res.end();
    });
  });
}

async function handle(req, res, { config, printer, log }) {
  const port = req.socket.localPort;
  const selfOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

  // A page on another domain that resolves to 127.0.0.1 (DNS rebinding) arrives with its own Host.
  if (!selfOrigins.some((o) => o.slice('http://'.length) === req.headers.host)) {
    throw new HttpError(403, 'Host not allowed');
  }

  // Browsers send Origin on every cross-site POST, so it is checked here and not only on preflight.
  // Requests without Origin come from local tools (curl, scripts), not from web pages.
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.includes(origin) && !selfOrigins.includes(origin)) {
      throw new HttpError(403, `Origin ${origin} is not in ALLOWED_ORIGINS`);
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
    const [file, type] = STATIC_FILES[url.pathname];
    const body = await readFile(path.join(CLIENT_DIR, file));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      platform: config.platform,
      printer: config.printerName,
      dryRun: Boolean(config.dryRunDir),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/printers') {
    const printers = await printer.listPrinters();
    sendJson(res, 200, {
      configured: config.printerName,
      configuredFound: printers.includes(config.printerName),
      printers,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/print') {
    const result = await handlePrint(req, url, { config, printer });
    log(`PRINT origin=${origin || '-'} bytes=${result.bytes} copies=${result.copies} ` +
      `printer=${config.printerName}${result.savedTo ? ` savedTo=${result.savedTo}` : ''}`);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
}

async function handlePrint(req, url, { config, printer }) {
  // Requiring application/pdf also forces browsers to send a CORS preflight first.
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
  if (contentType !== 'application/pdf') {
    throw new HttpError(415, 'Content-Type must be application/pdf');
  }

  const copies = parseCopies(url.searchParams.get('copies'));
  const pdf = await readBody(req, MAX_PDF_BYTES);
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'Body is not a PDF');
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'label-print-'));
  // A unique name lets the Windows adapter find this job in the print queue.
  const file = path.join(dir, `label-${randomBytes(6).toString('hex')}.pdf`);
  try {
    await writeFile(file, pdf);
    let result;
    try {
      result = await printer.print(file, { copies });
    } catch (err) {
      const detail = (err.stderr || err.message || String(err)).toString().trim();
      throw new HttpError(502, `Printing failed: ${detail}`);
    }
    return { ...result, copies, bytes: pdf.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseCopies(raw) {
  if (raw === null) return 1;
  const copies = Number(raw);
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    throw new HttpError(400, `copies must be an integer 1-${MAX_COPIES}`);
  }
  return copies;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, `PDF is larger than ${limit} bytes`);
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.off('data', onData);
        req.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
  }
  const server = createServer({ config, printer: createPrinter(config) });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Label print agent on http://127.0.0.1:${config.port} (${config.platform})`);
    console.log(`Printer: ${config.printerName}${config.dryRunDir ? ` [DRY RUN -> ${path.resolve(config.dryRunDir)}]` : ''}`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(', ')}`);
  });
}
