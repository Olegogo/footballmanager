import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAnnouncementText, parseAnnouncementTextLog, parseTelegramExportGames } from '../src/lib/parser.js';

test('parseAnnouncementText extracts date, location, time and players', () => {
  const text = `
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
7. @asatur

1000р
89295991499
Альфа, Сбер, Тинь
  `;
  const parsed = parseAnnouncementText(text, new Date('2026-05-17T10:00:00+04:00'));

  assert.ok(parsed);
  assert.equal(parsed.location, 'Полежаевская');
  assert.equal(parsed.time, '19:30');
  assert.equal(parsed.date, '2026-05-17');
  assert.deepEqual(parsed.playerUsernames.slice(0, 4), ['teterko', 'dbabanin', 'dimasharovv', 'satwerz']);
  assert.equal(parsed.priceLine, '1000р');
});

test('parseTelegramExportGames finds only announcement messages', () => {
  const payload = {
    name: 'Football Chat',
    messages: [
      {
        id: 1,
        date: '2026-05-17T09:00:00',
        text: 'просто болталка'
      },
      {
        id: 2,
        date: '2026-05-17T10:00:00',
        text: [
          'Воскресенье 17 мая\nПолежаевская\n19:30\n\n1. @teterko\n2. @dbabanin\n3. @dimasharovv\n4. @Satwerz\n5. @kirriiillll\n'
        ]
      }
    ]
  };

  const games = parseTelegramExportGames(payload);

  assert.equal(games.length, 1);
  assert.equal(games[0].messageId, 2);
  assert.equal(games[0].announcement.location, 'Полежаевская');
});

test('parseAnnouncementText supports plain username list without numbering', () => {
  const text = `
18 мая
Полежаевская
19:30

@guttt
@gutoperchivyi
@O_legacy
@username1
@username2
@username3
  `;
  const parsed = parseAnnouncementText(text, new Date('2026-05-18T10:00:00+04:00'));

  assert.ok(parsed);
  assert.equal(parsed.location, 'Полежаевская');
  assert.equal(parsed.time, '19:30');
  assert.equal(parsed.playerUsernames.length, 6);
  assert.deepEqual(parsed.playerUsernames.slice(0, 3), ['guttt', 'gutoperchivyi', 'o_legacy']);
});

test('parseAnnouncementTextLog extracts multiple announcements from plain text history', () => {
  const text = `
что по игре?

18 мая
Полежаевская
19:30

@guttt
@gutoperchivyi
@O_legacy
@username1
@username2
@username3

да

25 мая
Сокол
20:00

1. @alpha
2. @beta
3. @gamma
4. @delta
5. @epsilon
6. @zeta
  `;
  const items = parseAnnouncementTextLog(text, new Date('2026-05-18T10:00:00+04:00'));

  assert.equal(items.length, 2);
  assert.equal(items[0].announcement.location, 'Полежаевская');
  assert.equal(items[1].announcement.location, 'Сокол');
  assert.equal(items[1].announcement.playerUsernames[0], 'alpha');
});

test('parseAnnouncementText respects CHAT_TIMEZONE_OFFSET for scheduledAt', () => {
  const previousOffset = process.env.CHAT_TIMEZONE_OFFSET;
  process.env.CHAT_TIMEZONE_OFFSET = '+03:00';

  const text = `
18 мая
Полежаевская
19:30

@guttt
@gutoperchivyi
@O_legacy
@username1
@username2
@username3
  `;

  const parsed = parseAnnouncementText(text, new Date('2026-05-18T10:00:00.000Z'));

  if (previousOffset === undefined) {
    delete process.env.CHAT_TIMEZONE_OFFSET;
  } else {
    process.env.CHAT_TIMEZONE_OFFSET = previousOffset;
  }

  assert.ok(parsed);
  assert.equal(parsed.scheduledAt, '2026-05-18T16:30:00.000Z');
});
