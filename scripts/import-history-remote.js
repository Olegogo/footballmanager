import fs from 'node:fs/promises';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

const filePath = process.argv[2];

if (!filePath || filePath.startsWith('--')) {
  console.error(
    'Usage: node scripts/import-history-remote.js /path/to/result.json --backend https://your-backend.example --chat-id -1001234567890 --token your_secret'
  );
  process.exit(1);
}

const backend = String(getArg('--backend') || '').replace(/\/+$/, '');
const chatId = getArg('--chat-id');
const title = getArg('--title') || 'Football Chat';
const token = getArg('--token') || process.env.ADMIN_IMPORT_TOKEN || '';

if (!backend || !chatId || !token) {
  console.error('backend, chat-id and token are required');
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(filePath, 'utf-8'));
const response = await fetch(`${backend}/api/admin/import-history`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': token
  },
  body: JSON.stringify({
    chatId,
    chatTitle: title,
    payload
  })
});
const data = await response.json();

if (!response.ok) {
  console.error(data.error || 'Remote import failed');
  process.exit(1);
}

console.log(
  `Imported ${data.importedGames} new games from ${data.totalFound} found announcements into chat ${chatId}.`
);
