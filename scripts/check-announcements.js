import fs from 'node:fs/promises';
import { flattenTelegramExportText, parseAnnouncementText } from '../src/lib/parser.js';

// Read-only diagnostic: never imports, merges or updates games.
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/check-announcements.js <db.json|telegram-export.json|announcement.txt>');
  process.exitCode = 1;
} else {
  const text = await fs.readFile(file, 'utf8');
  const payload = file.endsWith('.json') ? JSON.parse(text) : null;
  const entries = payload?.messages ? payload.messages.filter((message) => message.type !== 'service').map((message) => ({
    id: message.id, rawText: flattenTelegramExportText(message.text), referenceDate: message.date
  })) : payload?.games ? Object.values(payload.games).map((game) => ({
    id: game.id, rawText: game.rawText, referenceDate: game.sourceDate || game.scheduledAt,
    stored: game
  })) : [{ id: 'text', rawText: text }];
  const report = { checked: entries.length, parsed: 0, skipped: 0, rejected: [], changes: [], possibleDuplicates: [] };
  const schedules = new Map();
  for (const entry of entries) {
    if (!entry.rawText) { report.skipped++; continue; }
    const parsed = parseAnnouncementText(entry.rawText, entry.referenceDate || new Date(), { requirePaymentBlock: false });
    if (!parsed) {
      if (entry.stored || /(?:^|\n)\s*(?:\d+[.)]\s*)?@[A-Za-z0-9_]+/m.test(entry.rawText)) report.rejected.push(entry.id);
      else report.skipped++;
      continue;
    }
    report.parsed++;
    if (entry.stored) {
      const changed = Object.fromEntries(['location', 'date', 'time', 'scheduledAt'].filter((key) => entry.stored[key] !== parsed[key])
        .map((key) => [key, { stored: entry.stored[key], parsed: parsed[key] }]));
      if (Object.keys(changed).length) report.changes.push({ id: entry.id, fields: changed });
    }
    const key = `${entry.stored?.chatId || ''}|${parsed.scheduledAt}|${parsed.location.toLowerCase()}`;
    const ids = schedules.get(key) || [];
    ids.push(entry.id);
    schedules.set(key, ids);
  }
  report.possibleDuplicates = [...schedules.values()].filter((ids) => ids.length > 1);
  console.log(JSON.stringify(report, null, 2));
}
