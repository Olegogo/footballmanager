#!/usr/bin/env node

const sourceUrl = process.env.SOURCE_BOOTSTRAP_URL || process.argv[2];
const targetBaseUrl = (process.env.TARGET_BASE_URL || process.argv[3] || '').replace(/\/+$/, '');
const adminToken = process.env.ADMIN_IMPORT_TOKEN || process.argv[4];

function usage() {
  console.error([
    'Usage:',
    '  SOURCE_BOOTSTRAP_URL=https://old.example.com/api/bootstrap \\',
    '  TARGET_BASE_URL=https://new.example.com \\',
    '  ADMIN_IMPORT_TOKEN=... \\',
    '  node scripts/import-career-seed-from-bootstrap.js'
  ].join('\n'));
}

if (!sourceUrl || !targetBaseUrl || !adminToken) {
  usage();
  process.exit(1);
}

const sourceResponse = await fetch(sourceUrl);

if (!sourceResponse.ok) {
  throw new Error(`Unable to fetch source bootstrap: ${sourceResponse.status} ${sourceResponse.statusText}`);
}

const sourceData = await sourceResponse.json();
const players = (sourceData.snapshot?.players ?? [])
  .filter((player) => player.username && Number(player.ratedGames) > 0)
  .map((player) => ({
    username: player.username,
    displayName: player.displayName,
    firstName: player.firstName,
    lastName: player.lastName,
    photoUrl: player.photoUrl,
    ratedGames: player.ratedGames,
    goals: player.goals,
    assists: player.assists,
    position: player.position,
    overall: player.overall,
    stats: player.stats,
    source: sourceUrl
  }));

if (!players.length) {
  console.log('No rated players found in source bootstrap.');
  process.exit(0);
}

const targetResponse = await fetch(`${targetBaseUrl}/api/admin/import-career-seed`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-token': adminToken
  },
  body: JSON.stringify({ players })
});

const result = await targetResponse.json().catch(() => ({}));

if (!targetResponse.ok) {
  throw new Error(`Unable to import career seed: ${targetResponse.status} ${result.error || targetResponse.statusText}`);
}

console.log(`Imported career seed for ${result.importedPlayers ?? players.length} players.`);
