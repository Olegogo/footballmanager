import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChatSnapshot } from '../src/lib/stats.js';

test('buildChatSnapshot aggregates ratings, games and MVP', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_2',
        playerIds: ['player_1', 'player_2', 'player_3']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'teterko',
        displayName: 'Teterko',
        firstName: 'Teterko',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'dbabanin',
        displayName: 'Babanin',
        firstName: 'Babanin',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'GK',
        chatIds: ['-1001']
      },
      player_3: {
        id: 'player_3',
        telegramUserId: 3,
        username: 'satwerz',
        displayName: 'Satwerz',
        firstName: 'Satwerz',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'GK',
        chatIds: ['-1001']
      }
    },
    games: {
      game_1: {
        id: 'game_1',
        chatId: '-1001',
        dateLabel: 'Суббота 10 мая',
        location: 'Поле 1',
        time: '19:00',
        scheduledAt: '2026-05-10T19:00:00.000Z',
        playerIds: ['player_1', 'player_2', 'player_3'],
        paymentLines: [],
        priceLine: ''
      },
      game_2: {
        id: 'game_2',
        chatId: '-1001',
        dateLabel: 'Воскресенье 17 мая',
        location: 'Поле 2',
        time: '19:30',
        scheduledAt: '2026-05-17T19:30:00.000Z',
        playerIds: ['player_1', 'player_2', 'player_3'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {
      rating_1: {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_2',
        raterPlayerId: 'player_1',
        targetPlayerId: 'player_2',
        position: 'CM',
        pace: 88,
        dribbling: 86,
        shooting: 83,
        defense: 74,
        passing: 91,
        physical: 82,
        goals: 2,
        assists: 1
      },
      rating_2: {
        id: 'rating_2',
        chatId: '-1001',
        gameId: 'game_2',
        raterPlayerId: 'player_3',
        targetPlayerId: 'player_2',
        position: 'CM',
        pace: 90,
        dribbling: 84,
        shooting: 85,
        defense: 76,
        passing: 88,
        physical: 84,
        goals: 1,
        assists: 2
      }
    }
  };

  const snapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-17T22:45:00.000Z'));

  assert.equal(snapshot.players[0].id, 'player_2');
  assert.equal(snapshot.players[0].isMvp, true);
  assert.equal(snapshot.players[0].overall, 84);
  assert.equal(snapshot.players[0].games, 2);
  assert.equal(snapshot.players[0].goals, 2);
  assert.equal(snapshot.currentGame.canViewerRate, true);
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_2').canRateTarget,
    true
  );
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_2').viewerHasRatedTarget,
    true
  );
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_2').viewerRating.goals,
    2
  );
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_3').viewerHasRatedTarget,
    false
  );
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_1').canRateTarget,
    false
  );
  assert.equal(snapshot.currentGame.isFinished, true);
  assert.equal(snapshot.players.find((player) => player.id === 'player_3').position, 'GK');
});

test('buildChatSnapshot keeps rating window open until the next announcement', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_1',
        playerIds: ['player_1', 'player_2']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'teterko',
        displayName: 'Teterko',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'dbabanin',
        displayName: 'Babanin',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'GK',
        chatIds: ['-1001']
      }
    },
    games: {
      game_1: {
        id: 'game_1',
        chatId: '-1001',
        dateLabel: 'Суббота 10 мая',
        location: 'Поле 1',
        time: '19:00',
        scheduledAt: '2026-05-10T19:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {}
  };

  const openSnapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-11T18:59:00.000Z'));
  const laterSnapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-12T19:00:00.000Z'));

  assert.equal(openSnapshot.currentGame.canViewerRate, true);
  assert.equal(laterSnapshot.currentGame.canViewerRate, true);
});
