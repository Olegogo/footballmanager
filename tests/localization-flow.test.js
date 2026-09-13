import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dictionaries } from '../packages/i18n/index.js';
import { formatMatchDate } from '../packages/i18n/dates.js';
import { AppError, localizedError } from '../src/lib/errors.js';
import { renderLanding } from '../src/lib/landing.js';
import { parseAnnouncementText } from '../src/lib/parser.js';
import { scheduleInTimeZone } from '../src/lib/timezone.js';
import { AppStore } from '../src/lib/store.js';
import { TelegramBot } from '../src/bot/telegram.js';

function flatten(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, name, result); else result[name] = child;
  }
  return result;
}

test('RU/EN dictionaries have matching keys and interpolation parameters', () => {
  const ru = flatten(dictionaries.ru), en = flatten(dictionaries.en);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  const params = text => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(ru)) assert.deepEqual(params(en[key]), params(ru[key]), key);
});

test('landing renders English copy, local exported assets, localized SEO and entry links', () => {
  for (const locale of ['ru', 'en']) {
    const html = renderLanding(locale, 'https://matchup.example');
    assert.ok(html.includes(`<html lang="${locale}">`));
    assert.ok(html.includes(`href="https://matchup.example/${locale}"`));
    assert.ok(html.includes(`locale=${locale}`));
    assert.ok(!html.includes('{{'));
    assert.ok(!html.includes('figma.com/api/mcp/asset'));
    const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(schema).name, 'Matchup');
  }
  assert.match(renderLanding('en'), /Find your next game nearby/);
  assert.match(renderLanding('en'), /en-hero-game\.png/);
  assert.match(renderLanding('ru'), /Найди свою/);
});

test('English month-first, day-first and ISO announcements preserve price and venue', () => {
  for (const date of ['Sunday 13 September 2026', 'Sunday September 13, 2026', '2026-09-13']) {
    const text = `${date}\nVenue: Regent’s Park\nTime: 19:30\n1. @alpha\n2. @bravo\n3. @charlie\n4. @delta\n5. @echoo\n£10`;
    const game = parseAnnouncementText(text, '2026-09-10T12:00:00Z', { requirePaymentBlock: false, timeZone: 'Europe/London' });
    assert.ok(game, date);
    assert.equal(game.date, '2026-09-13');
    assert.equal(game.scheduledAt, '2026-09-13T18:30:00.000Z');
    assert.equal(game.location, 'Regent’s Park');
    assert.equal(game.priceLine, '£10');
  }
});

test('venue time zones handle midnight and DST without changing the calendar date', () => {
  assert.equal(scheduleInTimeZone('2027-01-01', '00:30', 'Europe/Moscow').toISOString(), '2026-12-31T21:30:00.000Z');
  assert.equal(scheduleInTimeZone('2026-07-01', '19:30', 'Europe/London').toISOString(), '2026-07-01T18:30:00.000Z');
  assert.equal(scheduleInTimeZone('2026-12-01', '19:30', 'Europe/London').toISOString(), '2026-12-01T19:30:00.000Z');
  assert.throws(() => scheduleInTimeZone('2026-03-29', '01:30', 'Europe/London'), /./);
  assert.throws(() => scheduleInTimeZone('2026-10-25', '01:30', 'Europe/London'), /./);
  assert.throws(() => scheduleInTimeZone('2026-02-30', '19:30', 'Europe/London'), /./);
  assert.throws(() => scheduleInTimeZone('2026-09-13', '19:30', 'Invalid/Zone'), /./);
  const game = { date: '2027-01-01', scheduledAt: '2026-12-31T21:30:00Z' };
  assert.equal(formatMatchDate(game, 'en'), '1 January');
  assert.equal(formatMatchDate(game, 'ru'), '1 января');
});

test('domain errors carry stable codes and translate without exposing raw failures', () => {
  const error = new AppError('players_required');
  assert.equal(localizedError(error, 'en').error, 'Add at least two players');
  assert.equal(localizedError(error, 'ru').error, 'Добавьте минимум двух игроков');
  assert.equal(localizedError(new Error('private internals'), 'en').errorKey, 'errors.request_failed');
});

test('manual locale survives Telegram refresh and group language differs from personal messages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'matchup-locale-'));
  try {
    const store = new AppStore(path.join(directory, 'db.json')); await store.init();
    await store.ensureChat({ id: '-1', type: 'supergroup' });
    const player = await store.rememberTelegramUser('-1', { id: 100, first_name: 'Alex', language_code: 'de' });
    assert.equal(player.locale, 'en');
    await store.setPlayerLocale(player.id, 'en', 'manual');
    await store.setChatLocale('-1', 'ru', 'manual');
    await store.rememberTelegramUser('-1', { id: 100, language_code: 'ru' });
    const bot = new TelegramBot({}, store);
    const game = { id: '1', chatId: '-1', date: '2026-09-13', time: '19:30', playerIds: [] };
    assert.match(bot.formatGameAnnouncementCaption(game), /Игра/);
    assert.match(bot.formatGameInvite(game, bot.getPlayerLocale(player)), /September/);
    assert.equal(bot.getCallbackLocale({ from: { id: 100, language_code: 'ru' } }), 'en');
    const restarted = new AppStore(path.join(directory, 'db.json')); await restarted.init();
    assert.equal(restarted.getPlayerLocale(player.id), 'en');
    assert.equal(restarted.getChatLocale('-1'), 'ru');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bot profile config registers Russian, English and English fallback', async () => {
  const bot = new TelegramBot({}, {}), calls = [];
  bot.callApi = async (method, args) => { calls.push({ method, ...args }); };
  await bot.syncLocalizedBotProfile();
  assert.equal(calls.length, 9);
  const commands = calls.filter(call => call.method === 'setMyCommands');
  assert.deepEqual(commands.map(call => call.language_code), ['', 'en', 'ru']);
  assert.equal(commands[0].commands[0].description, 'Get started');
  assert.equal(commands[2].commands[0].description, 'Начать');
});
