import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseAnnouncementText } from '../src/lib/parser.js';
import { AppStore } from '../src/lib/store.js';

async function createStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fifa-store-'));
  const store = new AppStore(path.join(directory, 'db.json'));
  await store.init();
  return {
    directory,
    store
  };
}

test('recordGameFromAnnouncement overwrites upcoming game before kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = `
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `;
    const secondRaw = `
Воскресенье 17 мая
Полежаевская
20:00

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
7. @O_legacy
8. @KudryaIvan
    `;

    const firstAnnouncement = parseAnnouncementText(firstRaw, new Date('2099-05-17T10:00:00+03:00'));
    const secondAnnouncement = parseAnnouncementText(secondRaw, new Date('2099-05-17T12:00:00+03:00'));

    assert.ok(firstAnnouncement);
    assert.ok(secondAnnouncement);

    const firstResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: firstRaw,
      messageId: 1,
      announcement: firstAnnouncement,
      sourceDate: new Date('2099-05-17T10:00:00+03:00')
    });
    const secondResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: secondRaw,
      messageId: 2,
      announcement: secondAnnouncement,
      sourceDate: new Date('2099-05-17T12:00:00+03:00')
    });

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.updated, true);
    assert.equal(Object.keys(store.state.games).length, 1);

    const game = Object.values(store.state.games)[0];
    assert.equal(game.id, firstResult.game.id);
    assert.equal(game.messageId, 2);
    assert.equal(game.time, '20:00');
    assert.equal(game.playerIds.length, 8);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('recordGameFromAnnouncement does not overwrite game after kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = `
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `;
    const secondRaw = `
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
7. @O_legacy
8. @KudryaIvan
    `;

    const firstAnnouncement = parseAnnouncementText(firstRaw, new Date('2099-05-17T10:00:00+03:00'));
    const secondAnnouncement = parseAnnouncementText(secondRaw, new Date('2099-05-17T22:00:00+03:00'));

    assert.ok(firstAnnouncement);
    assert.ok(secondAnnouncement);

    const firstResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: firstRaw,
      messageId: 1,
      announcement: firstAnnouncement,
      sourceDate: new Date('2099-05-17T10:00:00+03:00')
    });
    const secondResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: secondRaw,
      messageId: 2,
      announcement: secondAnnouncement,
      sourceDate: new Date('2099-05-17T22:00:00+03:00')
    });

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.updated, false);
    assert.equal(Object.keys(store.state.games).length, 1);

    const game = Object.values(store.state.games)[0];
    assert.equal(game.messageId, 1);
    assert.equal(game.time, '19:30');
    assert.equal(game.playerIds.length, 6);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
