import { statSync } from 'node:fs';

const SCALES = ['noscale', 'fit', 'shrink'];
const ORIENTATIONS = ['portrait', 'landscape'];
const SUPPORTED_PLATFORMS = ['darwin', 'linux', 'win32'];

export function loadConfig(env = process.env, platform = process.platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform "${platform}"; expected one of ${SUPPORTED_PLATFORMS.join(', ')}`);
  }

  const dryRunDir = env.DRY_RUN_DIR || null;
  const required = ['PORT', 'PRINTER_NAME', 'ALLOWED_ORIGINS'];
  if (platform === 'win32' && !dryRunDir) required.push('SUMATRA_PATH');
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required settings: ${missing.join(', ')} (see .env.example)`);
  }

  if (platform === 'win32' && !dryRunDir && !fileExists(env.SUMATRA_PATH)) {
    throw new Error(`SUMATRA_PATH does not point to a file: "${env.SUMATRA_PATH}"`);
  }

  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1-65535, got "${env.PORT}"`);
  }

  const scale = env.PRINT_SCALE || 'noscale';
  if (!SCALES.includes(scale)) {
    throw new Error(`PRINT_SCALE must be one of ${SCALES.join(', ')}, got "${scale}"`);
  }

  const orientation = env.ORIENTATION || 'portrait';
  if (!ORIENTATIONS.includes(orientation)) {
    throw new Error(`ORIENTATION must be one of ${ORIENTATIONS.join(', ')}, got "${orientation}"`);
  }

  const allowedOrigins = splitList(env.ALLOWED_ORIGINS);
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/]+$/.test(origin)) {
      throw new Error(`ALLOWED_ORIGINS entry "${origin}" must look like https://host[:port] with no path`);
    }
  }

  return {
    platform,
    port,
    printerName: env.PRINTER_NAME,
    allowedOrigins,
    sumatraPath: env.SUMATRA_PATH || null,
    scale,
    orientation,
    lpOptions: splitList(env.LP_OPTIONS),
    dryRunDir,
  };
}

function fileExists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function splitList(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}
