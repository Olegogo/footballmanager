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

test('recordGameFromAnnouncement switches current game to the latest announcement message', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = `
Воскресенье 17 мая
Полежаевская
22:00

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `;
    const secondRaw = `
Понедельник 18 мая
Сокол
19:00

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
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
    assert.equal(store.state.chats['-1001'].currentGameId, firstResult.game.id);
    assert.equal(Object.keys(store.state.games).length, 1);

    const game = store.state.games[store.state.chats['-1001'].currentGameId];
    assert.equal(game.location, 'Сокол');
    assert.equal(game.time, '19:00');
    assert.equal(game.messageId, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('recordGameFromAnnouncement updates edited announcement with same message id before kickoff', async () => {
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
    const editedRaw = `
Воскресенье 17 мая
Полежаевская
20:15

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
7. @O_legacy
    `;

    const firstAnnouncement = parseAnnouncementText(firstRaw, new Date('2099-05-17T10:00:00+03:00'));
    const editedAnnouncement = parseAnnouncementText(editedRaw, new Date('2099-05-17T11:00:00+03:00'));

    assert.ok(firstAnnouncement);
    assert.ok(editedAnnouncement);

    const firstResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: firstRaw,
      messageId: 9,
      announcement: firstAnnouncement,
      sourceDate: new Date('2099-05-17T10:00:00+03:00')
    });
    const secondResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: editedRaw,
      messageId: 9,
      announcement: editedAnnouncement,
      sourceDate: new Date('2099-05-17T11:00:00+03:00')
    });

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.equal(secondResult.updated, true);
    assert.equal(Object.keys(store.state.games).length, 1);

    const game = store.state.games[store.state.chats['-1001'].currentGameId];
    assert.equal(game.messageId, 9);
    assert.equal(game.time, '20:15');
    assert.equal(game.playerIds.length, 7);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('submitRating stores goalkeeper goals and assists as zero', async () => {
  const { directory, store } = await createStore();
  const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  try {
    await store.mutate((state) => {
      state.chats['-1001'] = {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_1',
        playerIds: ['player_1', 'player_2'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.players.player_1 = {
        id: 'player_1',
        telegramUserId: 1,
        username: 'teterko',
        displayName: 'Teterko',
        firstName: '',
        lastName: '',
        photoUrl: '',
        chatIds: ['-1001'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.players.player_2 = {
        id: 'player_2',
        telegramUserId: 2,
        username: 'dbabanin',
        displayName: 'Babanin',
        firstName: '',
        lastName: '',
        photoUrl: '',
        chatIds: ['-1001'],
        defaultPosition: 'GK',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.games.game_1 = {
        id: 'game_1',
        chatId: '-1001',
        messageId: 1,
        rawText: '',
        key: 'game_1',
        source: 'test',
        sourceDate: startedAt,
        dateLabel: '1 мая',
        location: 'Поле',
        time: '10:00',
        scheduledAt: startedAt,
        date: startedAt.slice(0, 10),
        priceLine: '',
        paymentLines: [],
        playerUsernames: ['teterko', 'dbabanin'],
        playerIds: ['player_1', 'player_2'],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    const rating = await store.submitRating({
      chatId: '-1001',
      gameId: 'game_1',
      raterPlayerId: 'player_1',
      targetPlayerId: 'player_2',
      payload: {
        position: 'GK',
        pace: 75,
        dribbling: 76,
        shooting: 77,
        defense: 78,
        passing: 79,
        physical: 80,
        goals: 4,
        assists: 3
      }
    });

    assert.equal(rating.position, 'GK');
    assert.equal(rating.goals, 0);
    assert.equal(rating.assists, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('submitRating accepts ratings after 24 hours when no newer game closed the window', async () => {
  const { directory, store } = await createStore();

  try {
    await store.mutate((state) => {
      state.chats['-1001'] = {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_1',
        playerIds: ['player_1', 'player_2'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.players.player_1 = {
        id: 'player_1',
        telegramUserId: 1,
        username: 'teterko',
        displayName: 'Teterko',
        firstName: '',
        lastName: '',
        photoUrl: '',
        chatIds: ['-1001'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.players.player_2 = {
        id: 'player_2',
        telegramUserId: 2,
        username: 'dbabanin',
        displayName: 'Babanin',
        firstName: '',
        lastName: '',
        photoUrl: '',
        chatIds: ['-1001'],
        defaultPosition: 'GK',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.games.game_1 = {
        id: 'game_1',
        chatId: '-1001',
        messageId: 1,
        rawText: '',
        key: 'game_1',
        source: 'test',
        sourceDate: '2000-05-01T10:00:00.000Z',
        dateLabel: '1 мая',
        location: 'Поле',
        time: '10:00',
        scheduledAt: '2000-05-01T10:00:00.000Z',
        date: '2000-05-01',
        priceLine: '',
        paymentLines: [],
        playerUsernames: ['teterko', 'dbabanin'],
        playerIds: ['player_1', 'player_2'],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    const rating = await store.submitRating({
      chatId: '-1001',
      gameId: 'game_1',
      raterPlayerId: 'player_1',
      targetPlayerId: 'player_2',
      payload: {
        position: 'GK',
        pace: 75,
        dribbling: 76,
        shooting: 77,
        defense: 78,
        passing: 79,
        physical: 80
      }
    });

    assert.equal(rating.position, 'GK');
    assert.equal(rating.targetPlayerId, 'player_2');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
