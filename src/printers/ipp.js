// Minimal IPP/1.1 client for the local CUPS server: just enough to read job and printer state.
import { existsSync } from 'node:fs';
import http from 'node:http';

export const TAG = {
  operation: 0x01,
  end: 0x03,
  integer: 0x21,
  enum: 0x23,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  language: 0x48,
};
const OP = { getJobAttributes: 0x0009, getPrinterAttributes: 0x000b };
const DELIMITER_MAX = 0x0f;

/** @param {Array<[number, string, string|number|Array<string|number>]>} attrs */
export function encodeRequest(operationId, requestId, attrs) {
  const parts = [Buffer.from([0x01, 0x01]), u16(operationId), u32(requestId), Buffer.from([TAG.operation])];
  for (const [tag, name, value] of attrs) {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((v, i) => {
      // Additional values of a multi-valued attribute are sent with an empty name.
      const n = Buffer.from(i === 0 ? name : '');
      const val = tag === TAG.integer || tag === TAG.enum ? u32(v) : Buffer.from(String(v));
      parts.push(Buffer.from([tag]), u16(n.length), n, u16(val.length), val);
    });
  }
  parts.push(Buffer.from([TAG.end]));
  return Buffer.concat(parts);
}

/** Every attribute comes back as an array of values; groups are merged. */
export function decodeResponse(buf) {
  if (buf.length < 8) throw new Error('IPP response is too short');
  const statusCode = buf.readUInt16BE(2);
  const attributes = {};
  let i = 8;
  let last = null;
  while (i < buf.length) {
    const tag = buf[i++];
    if (tag === TAG.end) break;
    if (tag <= DELIMITER_MAX) continue;
    const nameLen = buf.readUInt16BE(i);
    i += 2;
    const name = buf.toString('utf8', i, i + nameLen);
    i += nameLen;
    const valueLen = buf.readUInt16BE(i);
    i += 2;
    const raw = buf.subarray(i, i + valueLen);
    i += valueLen;
    const value = (tag === TAG.integer || tag === TAG.enum) && valueLen === 4 ? raw.readInt32BE(0) : raw.toString('utf8');
    if (nameLen) {
      last = name;
      attributes[name] = [value];
    } else if (last) {
      attributes[last].push(value);
    }
  }
  return { statusCode, attributes };
}

// The local CUPS server's own socket, as lp/lpstat use it; CUPS may not listen on 127.0.0.1 at all.
const CUPS_SOCKETS = ['/private/var/run/cupsd', '/run/cups/cups.sock', '/var/run/cups/cups.sock'];

export function createIppClient({
  socketPath = CUPS_SOCKETS.find((p) => existsSync(p)),
  host = 'localhost',
  port = 631,
  timeoutMs = 5000,
} = {}) {
  async function call(printerName, operationId, extra) {
    const body = encodeRequest(operationId, 1, [
      [TAG.charset, 'attributes-charset', 'utf-8'],
      [TAG.language, 'attributes-natural-language', 'en'],
      [TAG.uri, 'printer-uri', `ipp://localhost/printers/${encodeURIComponent(printerName)}`],
      ...extra,
    ]);
    const response = await post(`/printers/${encodeURIComponent(printerName)}`, body);
    const { statusCode, attributes } = decodeResponse(response);
    if (statusCode >= 0x0100) throw new Error(`CUPS returned IPP status 0x${statusCode.toString(16).padStart(4, '0')}`);
    return attributes;
  }

  function post(path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        ...(socketPath ? { socketPath } : { host, port }),
        path,
        method: 'POST',
        // CUPS only answers requests addressed to a name it serves.
        headers: { Host: 'localhost', 'Content-Type': 'application/ipp', 'Content-Length': body.length },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error(`CUPS returned HTTP ${res.statusCode}`));
          else resolve(Buffer.concat(chunks));
        });
      });
      req.on('timeout', () => req.destroy(new Error('CUPS did not answer in time')));
      req.on('error', reject);
      req.end(body);
    });
  }

  return {
    getJob: (printerName, jobNumber) => call(printerName, OP.getJobAttributes, [
      [TAG.integer, 'job-id', jobNumber],
      [TAG.keyword, 'requested-attributes', ['job-state', 'job-state-reasons', 'job-printer-state-message']],
    ]),
    getPrinter: (printerName) => call(printerName, OP.getPrinterAttributes, [
      [TAG.keyword, 'requested-attributes', ['printer-state', 'printer-state-reasons', 'printer-state-message']],
    ]),
  };
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}
