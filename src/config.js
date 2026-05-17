import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key] !== undefined) {
      continue;
    }

    const value = rawValue.replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

loadEnvFile(path.join(rootDir, '.env'));

export const config = {
  rootDir,
  webDir: path.join(rootDir, 'web'),
  dataFile: path.join(rootDir, 'data', 'db.json'),
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '3000')),
  publicBaseUrl: env('PUBLIC_BASE_URL', '').replace(/\/+$/, ''),
  corsAllowedOrigins: env('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  telegramBotToken: env('TELEGRAM_BOT_TOKEN', ''),
  defaultChatId: env('DEFAULT_CHAT_ID', ''),
  allowDevLogin: ['1', 'true', 'yes'].includes(env('ALLOW_DEV_LOGIN', 'false').toLowerCase()),
  adminImportToken: env('ADMIN_IMPORT_TOKEN', ''),
  schedulerIntervalMs: Number(env('SCHEDULER_INTERVAL_MS', '60000')),
  authMaxAgeSeconds: Number(env('AUTH_MAX_AGE_SECONDS', '86400'))
};
