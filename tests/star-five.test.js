import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppStore } from '../src/lib/store.js';
import { TelegramBot } from '../src/bot/telegram.js';
import { advanceStarFive } from '../src/lib/star-five.js';
import { renderStarFivePng } from '../src/lib/star-five-image.js';
import { buildStarFiveFieldAssignments } from '../src/lib/lineup.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'star-five-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new AppStore(path.join(dir, 'db.json'));
  await store.init();
  for (const id of ['-1001', '-1002']) {
    store.state.chats[id] = { id, title: `Football ${id}`, type: 'supergroup', playerIds: [], locale: 'ru' };
  }
  for (let i = 1; i <= 7; i++) {
    store.state.players[`p${i}`] = { id: `p${i}`, displayName: `Игрок ${i}`, username: `player${i}`, chatIds: ['-1001', '-1002'], privateChatId: i === 7 ? '' : `${i}`, locale: 'ru' };
  }
  return store;
}

function addGame(store, n, winner, chatId = '-1001', extra = {}) {
  const id = `g${n}`;
  store.state.games[id] = { id, chatId, scheduledAt: `2020-01-${String(n).padStart(2, '0')}T10:00:00.000Z`, playerIds: Object.keys(store.state.players), ...extra };
  if (winner) store.state.mvpVotes[`v${n}`] = { id: `v${n}`, gameId: id, targetPlayerId: winner, raterPlayerId: winner === 'p1' ? 'p2' : 'p1' };
}

test('repeat MVP preserves order; sixth distinct MVP removes oldest; evicted player can return', () => {
  let entries = [];
  for (let i = 1; i <= 5; i++) entries = advanceStarFive(entries, { playerId: `p${i}`, gameId: `g${i}` });
  assert.strictEqual(advanceStarFive(entries, { playerId: 'p1', gameId: 'repeat' }), entries);
  entries = advanceStarFive(entries, { playerId: 'p6', gameId: 'g6' });
  assert.deepEqual(entries.map((e) => e.playerId), ['p2', 'p3', 'p4', 'p5', 'p6']);
  entries = advanceStarFive(entries, { playerId: 'p1', gameId: 'g7' });
  assert.deepEqual(entries.map((e) => e.playerId), ['p3', 'p4', 'p5', 'p6', 'p1']);
});

test('keeper replaces only the keeper; outfield MVP preserves the keeper', () => {
  let entries = [{ playerId: 'gk1', position: 'GK' }, ...['LB', 'CM', 'RW', 'ST'].map((position) => ({ playerId: position, position }))];
  const repeat = advanceStarFive(entries, { playerId: 'gk1', position: 'GK' });
  assert.strictEqual(repeat, entries);
  entries = advanceStarFive(entries, { playerId: 'newCM', position: 'CM' });
  assert.deepEqual(entries.map((entry) => entry.playerId), ['gk1', 'CM', 'RW', 'ST', 'newCM']);
  entries = advanceStarFive(entries, { playerId: 'gk2', position: 'GK' });
  assert.deepEqual(entries.map((entry) => entry.playerId), ['CM', 'RW', 'ST', 'newCM', 'gk2']);
  assert.equal(entries.filter((entry) => entry.position === 'GK').length, 1);
});

test('first keeper enters a full outfield lineup and takes only one place', () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ playerId: `p${index}`, position: 'CM' }));
  const next = advanceStarFive(entries, { playerId: 'gk', position: 'GK' });
  assert.equal(next.length, 5);
  assert.equal(next[0].playerId, 'p1');
  assert.equal(next[4].playerId, 'gk');
});

test('formation fixes keeper in goal, respects wings and separates repeated positions', () => {
  const players = ['GK', 'LB', 'RB', 'ST', 'ST'].map((position, i) => ({ id: String(i), position, displayName: String(i) }));
  const result = buildStarFiveFieldAssignments(players);
  assert.deepEqual(result.find((entry) => entry.position === 'GK').slot, { x: 8, y: 50 });
  assert.ok(result.find((entry) => entry.position === 'LB').slot.y < 50);
  assert.ok(result.find((entry) => entry.position === 'RB').slot.y > 50);
  assert.ok(result.filter((entry) => entry.position === 'ST').every((entry) => entry.slot.x === 68));
  assert.equal(new Set(result.map(({ slot }) => `${slot.x},${slot.y}`)).size, 5);
  assert.deepEqual(result.filter(({ position }) => position !== 'GK').map(({ slot }) => `${slot.x},${slot.y}`).sort(), ['34,24', '34,76', '68,24', '68,76']);
  const mids = buildStarFiveFieldAssignments(players.map((player) => ({ ...player, position: 'CM' })));
  assert.equal(new Set(mids.map(({ slot }) => `${slot.x},${slot.y}`)).size, 5);
  assert.ok(mids.every(({ slot }) => slot.x > 12));
});

test('legacy membership is rebuilt with one goalkeeper without new notifications', async (t) => {
  const store = await fixture(t);
  store.state.players.p1.defaultPosition = 'GK';
  store.state.players.p2.selfProfile = { position: 'GK' };
  addGame(store, 1, 'p1');
  addGame(store, 2, 'p3');
  addGame(store, 3, 'p2');
  await store.syncStarFives({ notify: false });
  delete store.state.starFive.version;
  store.state.starFive.entries = ['p1', 'p3', 'p2'].map((playerId, index) => ({ playerId, gameId: `g${index + 1}` }));
  await store.syncStarFives();
  assert.deepEqual(store.getStarFive().players.map((player) => player.id), ['p2', 'p3']);
  assert.equal(store.getStarFive().players[0].position, 'GK');
  assert.equal(store.listPendingStarFiveEvents().length, 0);
  store.state.players.p3.selfProfile = { position: 'GK' };
  await store.syncStarFives();
  assert.equal(store.getStarFive().players.filter((player) => player.position === 'GK').length, 1);
  assert.equal(store.listPendingStarFiveEvents().length, 0);
});

test('global lineup across chats, final MVP only, and duplicate/concurrent syncs are persisted once', async (t) => {
  const store = await fixture(t);
  addGame(store, 1, 'p1');
  addGame(store, 2, 'p1');
  addGame(store, 3, 'p2', '-1002');
  addGame(store, 4, null);
  addGame(store, 5, 'p3', '-1001', { scheduledAt: new Date().toISOString() });
  addGame(store, 6, 'p4', '-1001', { excludeFromCareer: true });
  await Promise.all([store.syncStarFives(), store.syncStarFives()]);
  assert.deepEqual(store.getStarFive().players.map((p) => p.id), ['p2', 'p1']);
  assert.equal(store.listPendingStarFiveEvents().length, 2);
  const reloaded = new AppStore(store.filePath);
  await reloaded.init();
  assert.equal(reloaded.listPendingStarFiveEvents().length, 2);
  assert.equal(reloaded.getSnapshot('global').starFive.players.length, 2);
});

test('migration builds historical lineups silently', async (t) => {
  const store = await fixture(t);
  addGame(store, 1, 'p1');
  delete store.state.starFive;
  await store.persist();
  const reloaded = new AppStore(store.filePath);
  await reloaded.init();
  assert.equal(reloaded.getStarFive().players[0].id, 'p1');
  assert.equal(reloaded.listPendingStarFiveEvents().length, 0);
});

test('manual global games join the same five and repeated winners from other chats stay put', async (t) => {
  const store = await fixture(t);
  store.state.chats.global = { id: 'global', type: 'global', title: 'All games', playerIds: [] };
  addGame(store, 1, 'p1');
  addGame(store, 2, 'p2', 'global');
  addGame(store, 3, 'p1', '-1002');
  await store.syncStarFives();
  assert.deepEqual(store.getStarFive().players.map((player) => player.id), ['p2', 'p1']);
  assert.equal(store.listPendingStarFiveEvents().length, 2);
  assert.deepEqual(store.getSnapshot('-1001').starFive, store.getSnapshot('-1002').starFive);
});

test('notifications retry private delivery without posting to the group', async (t) => {
  const store = await fixture(t);
  addGame(store, 1, 'p1');
  const bot = new TelegramBot({ telegramBotToken: 'test', publicBaseUrl: 'https://app.example', telegramBotUsername: 'test_bot' }, store);
  let photos = 0, privateAttempts = 0;
  bot.sendPhoto = async (chatId, png) => { assert.equal(chatId, '-1001'); assert.equal(png[0], 137); photos++; };
  bot.sendMiniAppEntry = async (chatId, type, target, options) => {
    assert.equal(chatId, '1'); assert.equal(target, '-1001'); assert.equal(options.initialView, 'star-five');
    if (++privateAttempts === 1) throw new Error('temporary failure');
  };
  await Promise.all([bot.processPendingStarFives(), bot.processPendingStarFives()]);
  await bot.processPendingStarFives();
  await bot.processPendingStarFives();
  assert.equal(photos, 0); assert.equal(privateAttempts, 2);
  assert.equal(store.listPendingStarFiveEvents().length, 0);
  addGame(store, 2, 'p1');
  await bot.processPendingStarFives();
  assert.equal(photos, 0); assert.equal(privateAttempts, 2);
  assert.match(bot.buildMainMiniAppLink('-1001', { initialView: 'star-five' }), /startapp=star-five/);
});

test('no private destination means no notification; blocked bot is not retried', async (t) => {
  const store = await fixture(t);
  addGame(store, 1, 'p7');
  addGame(store, 2, 'p1');
  const bot = new TelegramBot({ telegramBotToken: 'test' }, store);
  let photos = 0, privates = 0;
  bot.sendPhoto = async () => { photos++; };
  bot.sendMiniAppEntry = async () => { privates++; throw new Error('403: bot was blocked by the user'); };
  await bot.processPendingStarFives();
  await bot.processPendingStarFives();
  assert.equal(photos, 0); assert.equal(privates, 1);
  assert.equal(store.listPendingStarFiveEvents().length, 0);
});

test('share image is a 1200 × 642 PNG and handles XML-sensitive names', async () => {
  const png = await renderStarFivePng({ players: [{ id: 'p1', displayName: '<A&B>', overall: 75, ratedGames: 1 }] });
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 642);
});
