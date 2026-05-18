import fs from 'node:fs/promises';

import { config } from '../src/config.js';
import { AppStore } from '../src/lib/store.js';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

const filePath = process.argv[2];

if (!filePath || filePath.startsWith('--')) {
  console.error('Usage: node scripts/import-history-text.js /path/to/history.txt --chat-id -1001234567890');
  process.exit(1);
}

const text = await fs.readFile(filePath, 'utf-8');
const chatId = getArg('--chat-id') || config.defaultChatId || '';
const chatTitle = getArg('--title') || 'Football Chat';

if (!chatId) {
  console.error('Chat ID is required. Use /chatid in Telegram and pass --chat-id.');
  process.exit(1);
}

const store = new AppStore(config.dataFile);
await store.init();
const result = await store.importAnnouncementTextLog({
  chatId,
  chatTitle,
  chatType: 'supergroup',
  text
});

console.log(`Imported ${result.importedGames} new games from ${result.totalFound} detected announcements into chat ${chatId}.`);
