import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

export function normalizeUsername(value) {
  if (!value) {
    return '';
  }

  return String(value).trim().replace(/^@+/, '').toLowerCase();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function safeParseInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatDisplayName(user) {
  const parts = [user?.first_name, user?.last_name].filter(Boolean);
  return parts.join(' ').trim() || (user?.username ? `@${normalizeUsername(user.username)}` : 'Игрок');
}

export function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf-8');
  return text ? JSON.parse(text) : {};
}

export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

export function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

export function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

export function getBearerToken(req) {
  const header = req.headers.authorization ?? '';

  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice('Bearer '.length).trim();
}

export function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    notFound(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': getContentType(filePath)
  });

  fs.createReadStream(filePath).pipe(res);
}

export function setCorsHeaders(req, res, allowedOrigins = []) {
  const requestOrigin = String(req.headers.origin ?? '').replace(/\/+$/, '');

  if (!requestOrigin) {
    return false;
  }

  const allowAny = allowedOrigins.includes('*');
  const isAllowed = allowAny || allowedOrigins.includes(requestOrigin);

  if (!isAllowed) {
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : requestOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  return true;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
