import fs from 'node:fs/promises';

import { config } from '../src/config.js';
import { AppStore } from '../src/lib/store.js';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

const filePath = process.argv[2];

if (!filePath || filePath.startsWith('--')) {
  console.error('Usage: node scripts/import-history.js /path/to/result.json --chat-id -1001234567890');
  process.exit(1);
}

const raw = await fs.readFile(filePath, 'utf-8');
const payload = JSON.parse(raw);
const chatId = getArg('--chat-id') || config.defaultChatId || payload.id;
const chatTitle = getArg('--title') || payload.name || 'Football Chat';

if (!chatId) {
  console.error('Chat ID is required. Use /chatid in Telegram and pass --chat-id.');
  process.exit(1);
}

const games = parseTelegramExportGames(payload);

if (!games.length) {
  console.error('No game announcements were found in the export.');
  process.exit(1);
}

const store = new AppStore(config.dataFile);
await store.init();
const result = await store.importTelegramExport({
  chatId,
  chatTitle,
  chatType: 'supergroup',
  payload
});

console.log(`Imported ${result.importedGames} new games into chat ${chatId}.`);
