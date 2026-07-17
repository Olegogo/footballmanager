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

function withRequiredPayment(text) {
  return `${text}

1000р
89295991499
Альфа, Тинь, Сбер`;
}

test('recordGameFromAnnouncement overwrites upcoming game before kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = withRequiredPayment(`
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);
    const secondRaw = withRequiredPayment(`
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
    `);

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

test('submitQuickRating stores MVP vote and up to three stat points', async () => {
  const { directory, store } = await createStore();

  try {
    const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await store.mutate((state) => {
      state.chats['-1001'] = {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        currentGameId: 'game_1',
        playerIds: ['player_1', 'player_2', 'player_3']
      };
      state.players.player_1 = {
        id: 'player_1',
        username: 'rater',
        displayName: 'Rater',
        chatIds: ['-1001']
      };
      state.players.player_2 = {
        id: 'player_2',
        username: 'target',
        displayName: 'Target',
        chatIds: ['-1001']
      };
      state.players.player_3 = {
        id: 'player_3',
        username: 'third',
        displayName: 'Third',
        chatIds: ['-1001']
      };
      state.games.game_1 = {
        id: 'game_1',
        chatId: '-1001',
        dateLabel: '9 июня',
        location: 'Поле',
        time: '19:00',
        scheduledAt,
        playerIds: ['player_1', 'player_2', 'player_3'],
        paymentLines: [],
        priceLine: ''
      };
    });

    await store.submitQuickRating({
      chatId: '-1001',
      gameId: 'game_1',
      raterPlayerId: 'player_1',
      payload: {
        mvpPlayerId: 'player_2',
        boosts: [
          { targetPlayerId: 'player_2', statKey: 'pace', points: 2 },
          { targetPlayerId: 'player_3', statKey: 'passing', points: 1 }
        ],
        achievements: [
          { targetPlayerId: 'player_2', achievementKey: 'goleador' }
        ]
      }
    });

    assert.equal(Object.keys(store.state.statBoosts).length, 2);
    assert.equal(Object.values(store.state.mvpVotes)[0].targetPlayerId, 'player_2');
    assert.equal(Object.keys(store.state.achievementVotes).length, 1);
    assert.equal(Object.values(store.state.achievementVotes)[0].achievementKey, 'goleador');

    const snapshot = store.getSnapshot('-1001', 'player_1');
    assert.deepEqual(snapshot.currentGame.viewerQuickRating.achievements, [
      { targetPlayerId: 'player_2', achievementKey: 'goleador' }
    ]);

    await assert.rejects(
      () => store.submitQuickRating({
        chatId: '-1001',
        gameId: 'game_1',
        raterPlayerId: 'player_1',
        payload: {
          boosts: [
            { targetPlayerId: 'player_2', statKey: 'pace', points: 3 },
            { targetPlayerId: 'player_3', statKey: 'passing', points: 1 }
          ]
        }
      }),
      /максимум 3/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('recordGameFromAnnouncement does not overwrite game after kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = withRequiredPayment(`
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);
    const secondRaw = withRequiredPayment(`
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
    `);

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

test('recordGameFromAnnouncement creates a separate game for a different announcement date', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = withRequiredPayment(`
Воскресенье 17 мая
Полежаевская
22:00

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);
    const secondRaw = withRequiredPayment(`
Понедельник 18 мая
Сокол
19:00

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);

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
    assert.equal(secondResult.created, true);
    assert.equal(secondResult.updated, undefined);
    assert.equal(store.state.chats['-1001'].currentGameId, secondResult.game.id);
    assert.equal(Object.keys(store.state.games).length, 2);
    assert.equal(store.state.games[firstResult.game.id].closedAt, secondResult.game.sourceDate);

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
    const firstRaw = withRequiredPayment(`
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);
    const editedRaw = withRequiredPayment(`
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
    `);

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

test('recordGameFromAnnouncement keeps payment fields when edited announcement omits payment block', async () => {
  const { directory, store } = await createStore();

  try {
    const firstRaw = withRequiredPayment(`
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
4. @Satwerz
5. @kirriiillll
6. @Birarov
    `);
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
    const editedAnnouncement = parseAnnouncementText(editedRaw, new Date('2099-05-17T11:00:00+03:00'), {
      requirePaymentBlock: false
    });

    assert.ok(firstAnnouncement);
    assert.ok(editedAnnouncement);

    const firstResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: firstRaw,
      messageId: 10,
      announcement: firstAnnouncement,
      sourceDate: new Date('2099-05-17T10:00:00+03:00')
    });
    const secondResult = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText: editedRaw,
      messageId: 10,
      announcement: editedAnnouncement,
      sourceDate: new Date('2099-05-17T11:00:00+03:00')
    });

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.updated, true);

    const game = store.state.games[firstResult.game.id];
    assert.equal(game.time, '20:15');
    assert.equal(game.priceLine, '1000р');
    assert.deepEqual(game.paymentLines, ['89295991499', 'Альфа, Тинь, Сбер']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('recordGameFromAnnouncement creates game from compact field announcement', async () => {
  const { directory, store } = await createStore();

  try {
    const rawText = `
30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. @totArkady
7. @Birarov
8. @KudryaIvan
9. @goodkidmaadcity88
10. Alexandr 🤡
11. @dimasharovv
12. @itschiffa 🤡

1000р
89295991499
Альфа, Тинь, Сбер
    `;
    const announcement = parseAnnouncementText(rawText, new Date('2026-05-28T12:00:00+03:00'));

    assert.ok(announcement);

    const result = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText,
      messageId: 30,
      announcement,
      sourceDate: new Date('2026-05-28T12:00:00+03:00')
    });

    assert.equal(result.created, true);
    assert.equal(result.game.location, 'Поле 10');
    assert.equal(result.game.playerIds.length, 12);

    const barePlayer = Object.values(store.state.players).find((player) => player.username === 'alexandr');
    assert.ok(barePlayer);
    assert.equal(barePlayer.displayName, 'Alexandr');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('recordGameFromAnnouncement lets announcement author edit the created game', async () => {
  const { directory, store } = await createStore();

  try {
    const author = await store.upsertPlayerByUsername('-1001', 'O_legacy');
    const rawText = `
30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999
6. @totArkady

1000р
89295991499
Альфа, Тинь, Сбер
    `;
    const announcement = parseAnnouncementText(rawText, new Date('2099-05-28T12:00:00+03:00'));

    assert.ok(announcement);

    const result = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText,
      messageId: 30,
      announcement,
      organizerPlayerId: author.id,
      sourceDate: new Date('2099-05-28T12:00:00+03:00')
    });

    assert.equal(result.game.organizerPlayerId, author.id);

    const updated = await store.updateManualGame({
      chatId: '-1001',
      gameId: result.game.id,
      requesterPlayerId: author.id,
      date: '2099-05-30',
      time: '17:00',
      location: 'Поле 11',
      playerIds: result.game.playerIds,
      timezoneOffset: '+03:00'
    });

    assert.equal(updated.updated, true);
    assert.equal(updated.game.time, '17:00–18:30');
    assert.equal(updated.game.location, 'Поле 11');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('chat admin can manage announcement games in their chat', async () => {
  const { directory, store } = await createStore();

  try {
    const admin = await store.upsertPlayerByUsername('-1001', 'chat_admin');
    const rawText = `
30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999
6. @totArkady

1000р
89295991499
Альфа, Тинь, Сбер
    `;
    const announcement = parseAnnouncementText(rawText, new Date('2099-05-28T12:00:00+03:00'));

    assert.ok(announcement);

    const result = await store.recordGameFromAnnouncement({
      chatId: '-1001',
      chatTitle: 'Football Chat',
      rawText,
      messageId: 31,
      announcement,
      sourceDate: new Date('2099-05-28T12:00:00+03:00')
    });

    await store.setChatAdminStatus('-1001', admin.id, true);

    const snapshot = store.getSnapshot('global', admin.id, {
      selectedGameId: result.game.id
    });

    assert.equal(snapshot.currentGame.canViewerManage, true);

    const updated = await store.updateManualGame({
      chatId: '-1001',
      gameId: result.game.id,
      requesterPlayerId: admin.id,
      date: '2099-05-30',
      time: '17:30',
      location: 'Поле 12',
      playerIds: result.game.playerIds,
      timezoneOffset: '+03:00'
    });

    assert.equal(updated.updated, true);
    assert.equal(updated.game.time, '17:30–19:00');
    assert.equal(updated.game.location, 'Поле 12');

    await assert.rejects(
      () => store.setGameRosterLocked({
        chatId: '-1001',
        gameId: result.game.id,
        requesterPlayerId: admin.id,
        rosterLocked: true
      }),
      /Закрывать набор может только организатор/
    );
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

test('submitRating rejects ratings after 16 hours without rating activity', async () => {
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

    await assert.rejects(() => store.submitRating({
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
    }), /Окно оценки уже закрыто/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('listGamesRequiringSummary waits for 16 hours of rating inactivity', async () => {
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
        sourceDate: '2026-05-10T19:00:00.000Z',
        dateLabel: '10 мая',
        location: 'Поле',
        time: '19:00',
        scheduledAt: '2026-05-10T19:00:00.000Z',
        date: '2026-05-10',
        priceLine: '',
        paymentLines: [],
        playerUsernames: ['teterko', 'dbabanin'],
        playerIds: ['player_1', 'player_2'],
        ratingsOpenedAt: '2026-05-10T19:00:00.000Z',
        ratingsPromptMessageId: 10,
        ratingsClosedByGameId: null,
        ratingSummarySentAt: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.mvpVotes.mvp_vote_1 = {
        id: 'mvp_vote_1',
        chatId: '-1001',
        gameId: 'game_1',
        raterPlayerId: 'player_1',
        targetPlayerId: 'player_2',
        createdAt: '2026-05-11T03:00:00.000Z',
        updatedAt: '2026-05-11T03:00:00.000Z'
      };
    });

    assert.deepEqual(
      store.listGamesRequiringSummary(new Date('2026-05-11T18:59:00.000Z')).map((game) => game.id),
      []
    );
    assert.deepEqual(
      store.listGamesRequiringSummary(new Date('2026-05-11T19:00:00.000Z')).map((game) => game.id),
      ['game_1']
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('updateSelfProfile stores unrated player card data without creating rating', async () => {
  const { directory, store } = await createStore();

  try {
    const player = await store.upsertPlayerByUsername('-1001', 'O_legacy');

    await store.updateSelfProfile({
      chatId: '-1001',
      playerId: player.id,
      payload: {
        position: 'ST',
        pace: 77,
        dribbling: 72,
        shooting: 80,
        defense: 41,
        passing: 68,
        physical: 74
      }
    });

    const snapshot = store.getSnapshot('-1001', player.id);
    const card = snapshot.players.find((item) => item.id === player.id);

    assert.equal(card.ratedGames, 0);
    assert.equal(card.hasSelfProfile, true);
    assert.equal(card.position, 'ST');
    assert.equal(card.stats.pace, 77);
    assert.equal(card.overall, 50);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('updateSelfProfile lets a session player save profile outside the current chat roster', async () => {
  const { directory, store } = await createStore();

  try {
    await store.mutate((state) => {
      state.chats['-1001'] = {
        id: '-1001',
        title: 'Other Chat',
        type: 'supergroup',
        playerIds: []
      };
      state.players.player_1 = {
        id: 'player_1',
        username: 'newbie',
        displayName: 'Newbie',
        chatIds: []
      };
    });

    await store.updateSelfProfile({
      chatId: '-1001',
      playerId: 'player_1',
      payload: {
        position: 'LB',
        pace: 58,
        dribbling: 57,
        shooting: 56,
        defense: 61,
        passing: 55,
        physical: 60
      }
    });

    const snapshot = store.getSnapshot('-1001', 'player_1');
    const card = snapshot.players.find((item) => item.id === 'player_1');

    assert.equal(card.hasSelfProfile, true);
    assert.equal(card.position, 'LB');
    assert.equal(card.stats.defense, 61);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('updateSelfProfile lets rated player change position without resetting ratings', async () => {
  const { directory, store } = await createStore();

  try {
    await store.mutate((state) => {
      state.chats['-1001'] = {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        playerIds: ['player_1', 'player_2']
      };
      state.players.player_1 = {
        id: 'player_1',
        username: 'rater',
        displayName: 'Rater',
        chatIds: ['-1001']
      };
      state.players.player_2 = {
        id: 'player_2',
        username: 'target',
        displayName: 'Target',
        chatIds: ['-1001']
      };
      state.games.game_1 = {
        id: 'game_1',
        chatId: '-1001',
        dateLabel: '1 июня',
        location: 'Поле',
        time: '19:00',
        scheduledAt: '2026-06-01T16:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      };
      state.ratings.rating_1 = {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_1',
        raterPlayerId: 'player_1',
        targetPlayerId: 'player_2',
        position: 'CM',
        pace: 80,
        dribbling: 80,
        shooting: 80,
        defense: 80,
        passing: 80,
        physical: 80,
        goals: 1,
        assists: 1
      };
    });

    await store.updateSelfProfile({
      chatId: '-1001',
      playerId: 'player_2',
      payload: {
        position: 'LW',
        pace: 1,
        dribbling: 1,
        shooting: 1,
        defense: 1,
        passing: 1,
        physical: 1
      }
    });

    const snapshot = store.getSnapshot('-1001', 'player_2');
    const card = snapshot.players.find((item) => item.id === 'player_2');

    assert.equal(card.ratedGames, 1);
    assert.equal(card.position, 'LW');
    assert.equal(card.stats.pace, 80);
    assert.equal(card.overall, 80);
    assert.equal(card.hasSelfProfile, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('createManualGame creates current game from selected players', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    await store.rememberTelegramUser('-1001', {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatTitle: 'Football Chat',
      chatType: 'supergroup'
    });
    const first = await store.upsertPlayerByUsername('-1001', 'O_legacy');
    const second = await store.upsertPlayerByUsername('-1001', 'dbabanin');

    const result = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники, поле 10',
      playerIds: [organizer.id, first.id, second.id],
      timezoneOffset: '+03:00'
    });

    assert.equal(result.created, true);
    assert.equal(result.game.source, 'manual');
    assert.equal(result.game.location, 'Сокольники, поле 10');
    assert.equal(result.game.time, '16:00–17:30');
    assert.equal(result.game.scheduledAt, '2099-05-30T13:00:00.000Z');
    assert.deepEqual(result.game.playerIds, [organizer.id]);
    assert.deepEqual(result.game.invitedPlayerIds, [first.id, second.id]);

    const snapshot = store.getSnapshot('-1001', organizer.id);
    assert.equal(snapshot.chat.currentGameId, result.game.id);
    assert.equal(snapshot.currentGame.id, result.game.id);
    assert.equal(snapshot.currentGame.participants.length, 1);
    assert.equal(snapshot.currentGame.invitedPlayers.length, 2);
    assert.equal(snapshot.viewerCanCreateGames, true);
    assert.ok(snapshot.availablePlayers.some((player) => player.id === first.id));

    const firstSnapshot = store.getSnapshot('global', first.id, { selectedGameId: result.game.id });
    assert.equal(firstSnapshot.currentGame.viewerJoinStatus, 'invited');
    assert.equal(firstSnapshot.currentGame.invitedPlayers[0].canViewerAcceptInvite, true);

    const accepted = await store.acceptGameInvite({
      gameId: result.game.id,
      playerId: first.id
    });

    assert.equal(accepted.accepted, true);
    assert.deepEqual(accepted.game.playerIds, [organizer.id, first.id]);
    assert.deepEqual(accepted.game.invitedPlayerIds, [second.id]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('removePlayerFromGame removes declined player and returns organizer', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    const invited = await store.rememberTelegramUser(888, {
      id: 888,
      username: 'invited',
      first_name: 'Invited'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    await store.rememberTelegramUser('-1001', {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatTitle: 'Football Chat',
      chatType: 'supergroup'
    });
    await store.rememberTelegramUser('-1001', {
      id: 888,
      username: 'invited',
      first_name: 'Invited'
    }, {
      chatTitle: 'Football Chat',
      chatType: 'supergroup'
    });

    const result = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники, поле 10',
      playerIds: [organizer.id, invited.id],
      timezoneOffset: '+03:00'
    });

    const decline = await store.removePlayerFromGame({
      gameId: result.game.id,
      playerId: invited.id
    });

    assert.equal(decline.removed, true);
    assert.equal(decline.organizer.id, organizer.id);
    assert.equal(decline.player.id, invited.id);
    assert.deepEqual(decline.game.playerIds, [organizer.id]);
    assert.deepEqual(decline.game.invitedPlayerIds, []);
    assert.deepEqual(decline.game.declinedPlayerIds, [invited.id]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('join requests can be requested, shown and approved before kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    const joiner = await store.rememberTelegramUser(888, {
      id: 888,
      username: 'joiner',
      first_name: 'Joiner'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    const first = await store.upsertPlayerByUsername('-1001', 'O_legacy');

    const result = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники, поле 10',
      playerIds: [organizer.id, first.id],
      timezoneOffset: '+03:00'
    });

    const request = await store.requestJoinGame({
      gameId: result.game.id,
      playerId: joiner.id
    });

    assert.equal(request.requested, true);
    assert.equal(request.organizer.id, organizer.id);

    const joinerSnapshot = store.getSnapshot('global', joiner.id, { selectedGameId: result.game.id });
    assert.equal(joinerSnapshot.currentGame.viewerJoinStatus, 'pending');
    assert.equal(joinerSnapshot.currentGame.pendingJoinPlayers[0].canViewerCancelJoin, true);

    const organizerSnapshot = store.getSnapshot('global', organizer.id, { selectedGameId: result.game.id });
    assert.equal(organizerSnapshot.currentGame.pendingJoinPlayers[0].canViewerApproveJoin, true);
    assert.equal(organizerSnapshot.currentGame.pendingJoinPlayers[0].canViewerCancelJoin, true);

    const approved = await store.approveJoinRequest({
      gameId: result.game.id,
      requesterPlayerId: organizer.id,
      playerId: joiner.id
    });

    assert.equal(approved.approved, true);
    assert.ok(approved.game.playerIds.includes(joiner.id));
    assert.deepEqual(approved.game.pendingJoinPlayerIds, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('roster lock hides and rejects join requests before kickoff', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    const joiner = await store.rememberTelegramUser(888, {
      id: 888,
      username: 'joiner',
      first_name: 'Joiner'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    const teammate = await store.upsertPlayerByUsername('-1001', 'teammate');

    const result = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники, поле 10',
      playerIds: [organizer.id, teammate.id],
      timezoneOffset: '+03:00'
    });

    await store.setGameRosterLocked({
      gameId: result.game.id,
      requesterPlayerId: organizer.id,
      rosterLocked: true
    });

    const snapshot = store.getSnapshot('global', joiner.id, { selectedGameId: result.game.id });
    assert.equal(snapshot.currentGame.rosterLocked, true);
    assert.equal(snapshot.currentGame.canViewerRequestJoin, false);

    await assert.rejects(
      () => store.requestJoinGame({
        gameId: result.game.id,
        playerId: joiner.id
      }),
      /Набор уже закрыт|Заявки на эту игру уже закрыты/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('manual games keep previous ratings on the next game roster', async () => {
  const { directory, store } = await createStore();

  try {
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    const rater = await store.upsertPlayerByUsername('-1001', 'rater');
    const target = await store.upsertPlayerByUsername('-1001', 'target');

    await store.mutate((state) => {
      state.games.game_old = {
        id: 'game_old',
        chatId: '-1001',
        messageId: null,
        rawText: '',
        key: 'old',
        source: 'test',
        sourceDate: '2026-05-01T10:00:00.000Z',
        dateLabel: '1 мая',
        location: 'Сокольники',
        time: '19:30',
        scheduledAt: '2026-05-01T16:30:00.000Z',
        date: '2026-05-01',
        priceLine: '',
        paymentLines: [],
        playerUsernames: ['rater', 'target'],
        playerIds: [rater.id, target.id],
        ratingsOpenedAt: '2026-05-01T16:30:00.000Z',
        ratingsPromptMessageId: null,
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-05-01T10:00:00.000Z'
      };
      state.ratings.rating_old = {
        id: 'rating_old',
        chatId: '-1001',
        gameId: 'game_old',
        raterPlayerId: rater.id,
        targetPlayerId: target.id,
        position: 'ST',
        pace: 80,
        dribbling: 80,
        shooting: 80,
        defense: 80,
        passing: 80,
        physical: 80,
        goals: 2,
        assists: 1,
        createdAt: '2026-05-01T17:00:00.000Z',
        updatedAt: '2026-05-01T17:00:00.000Z'
      };
      state.chats['-1001'].currentGameId = 'game_old';
      return null;
    });

    const nextGame = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: rater.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники, поле 10',
      playerIds: [rater.id, target.id],
      timezoneOffset: '+03:00'
    });

    await store.acceptGameInvite({
      gameId: nextGame.game.id,
      playerId: target.id
    });

    const snapshot = store.getSnapshot('-1001', rater.id);
    const targetInNextGame = snapshot.currentGame.participants.find((player) => player.id === target.id);

    assert.equal(snapshot.currentGame.id, nextGame.game.id);
    assert.equal(targetInNextGame.ratedGames, 1);
    assert.equal(targetInNextGame.overall, 80);
    assert.equal(targetInNextGame.position, 'ST');
    assert.equal(targetInNextGame.goals, 2);
    assert.equal(targetInNextGame.assists, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('updateManualGame and deleteGame manage organizer games', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    const first = await store.upsertPlayerByUsername('-1001', 'first');
    const second = await store.upsertPlayerByUsername('-1001', 'second');
    const third = await store.upsertPlayerByUsername('-1001', 'third');
    const created = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники',
      playerIds: [first.id, second.id],
      timezoneOffset: '+03:00'
    });

    const updated = await store.updateManualGame({
      chatId: '-1001',
      gameId: created.game.id,
      requesterPlayerId: organizer.id,
      date: '2099-05-31',
      time: '18:15',
      location: 'Полежаевская',
      playerIds: [first.id, third.id],
      timezoneOffset: '+03:00'
    });

    assert.equal(updated.game.dateLabel, '31 мая');
    assert.equal(updated.game.time, '18:15–19:45');
    assert.equal(updated.game.location, 'Полежаевская');
    assert.deepEqual(updated.game.playerIds, [organizer.id]);
    assert.deepEqual(updated.game.invitedPlayerIds, [first.id, third.id]);

    const deleted = await store.deleteGame({
      chatId: '-1001',
      gameId: created.game.id,
      requesterPlayerId: organizer.id
    });

    assert.equal(deleted.deleted, true);
    assert.equal(store.state.games[created.game.id], undefined);
    assert.equal(store.state.chats['-1001'].currentGameId, null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('super admin can update and delete any manual game', async () => {
  const { directory, store } = await createStore();

  try {
    const organizer = await store.rememberTelegramUser(777, {
      id: 777,
      username: 'organizer',
      first_name: 'Org'
    }, {
      chatType: 'private'
    });
    const admin = await store.rememberTelegramUser(888, {
      id: 888,
      username: 'O_legacy',
      first_name: 'Oleg'
    }, {
      chatType: 'private'
    });
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    const first = await store.upsertPlayerByUsername('-1001', 'first');
    const second = await store.upsertPlayerByUsername('-1001', 'second');
    const third = await store.upsertPlayerByUsername('-1001', 'third');
    const created = await store.createManualGame({
      chatId: '-1001',
      organizerPlayerId: organizer.id,
      date: '2099-05-30',
      time: '16:00',
      location: 'Сокольники',
      playerIds: [first.id, second.id],
      timezoneOffset: '+03:00'
    });

    const updated = await store.updateManualGame({
      chatId: '-1001',
      gameId: created.game.id,
      requesterPlayerId: admin.id,
      date: '2099-05-31',
      time: '18:15',
      location: 'Полежаевская',
      playerIds: [first.id, third.id],
      timezoneOffset: '+03:00'
    });

    assert.equal(updated.game.organizerPlayerId, organizer.id);
    assert.equal(updated.game.time, '18:15–19:45');
    assert.equal(updated.game.location, 'Полежаевская');

    const locked = await store.setGameRosterLocked({
      chatId: '-1001',
      gameId: created.game.id,
      requesterPlayerId: admin.id,
      rosterLocked: true
    });

    assert.equal(locked.updated, true);
    assert.equal(locked.game.rosterLocked, true);

    const deleted = await store.deleteGame({
      chatId: '-1001',
      gameId: created.game.id,
      requesterPlayerId: admin.id
    });

    assert.equal(deleted.deleted, true);
    assert.equal(store.state.games[created.game.id], undefined);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('sessions survive store restart', async () => {
  const { directory, store } = await createStore();

  try {
    const player = await store.upsertPlayerByUsername('-1001', 'O_legacy');
    const token = await store.createSession(player.id, '-1001');
    const restarted = new AppStore(path.join(directory, 'db.json'));

    await restarted.init();

    const session = restarted.getSession(token);
    assert.equal(session.playerId, player.id);
    assert.equal(session.chatId, '-1001');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('importCareerSeed stores old volume ratings by username', async () => {
  const { directory, store } = await createStore();

  try {
    await store.ensureChat({
      id: '-1001',
      title: 'Football Chat',
      type: 'supergroup'
    });
    await store.upsertPlayerByUsername('-1001', 'O_legacy');

    const result = await store.importCareerSeed({
      players: [
        {
          username: 'O_legacy',
          displayName: 'Oleg Koreshkov',
          ratedGames: 1,
          goals: 2,
          assists: 1,
          position: 'ST',
          overall: 70,
          stats: {
            pace: 70,
            dribbling: 70,
            shooting: 70,
            defense: 70,
            passing: 70,
            physical: 70
          }
        }
      ]
    });

    const snapshot = store.getSnapshot('global', null);
    const player = snapshot.players.find((item) => item.username === 'o_legacy');

    assert.equal(result.importedPlayers, 1);
    assert.equal(player.ratedGames, 1);
    assert.equal(player.overall, 70);
    assert.equal(player.goals, 2);
    assert.equal(player.assists, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
