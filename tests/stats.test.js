import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChatSnapshot, getLatestMvp } from '../src/lib/stats.js';

function rating(overrides = {}) {
  return {
    pace: overrides.overall,
    dribbling: overrides.overall,
    shooting: overrides.overall,
    defense: overrides.overall,
    passing: overrides.overall,
    physical: overrides.overall,
    goals: overrides.goals ?? 0,
    assists: overrides.assists ?? 0,
    position: overrides.position ?? 'CM'
  };
}

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

  const activeSnapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-17T22:45:00.000Z'));
  const activeTarget = activeSnapshot.currentGame.participants.find((player) => player.id === 'player_2');

  assert.equal(activeSnapshot.currentGame.canViewerRate, true);
  assert.equal(activeTarget.currentGameStats.overall, 84);
  assert.equal(activeTarget.viewerHasRatedTarget, true);
  assert.equal(activeTarget.viewerRating.goals, 2);
  assert.equal(activeSnapshot.players.find((player) => player.id === 'player_2').ratedGames, 0);

  const snapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-19T00:00:00.000Z'));
  assert.equal(snapshot.players[0].id, 'player_2');
  assert.equal(snapshot.players[0].isMvp, true);
  assert.equal(snapshot.players[0].overall, 84);
  assert.equal(snapshot.players[0].games, 2);
  assert.equal(snapshot.players[0].goals, 2);
  assert.equal(snapshot.games.length, 2);
  assert.equal(snapshot.games[0].id, 'game_2');
  assert.equal(snapshot.games[0].dateLabel, '17 мая');
  assert.equal(snapshot.games[0].status, 'finished');
  assert.equal(snapshot.games[0].mvp.playerId, 'player_2');
  assert.equal(snapshot.games[0].topScorer.playerId, 'player_2');
  assert.equal(snapshot.games[0].topScorer.goals, 2);
  assert.equal(snapshot.games[0].totalGoals, 2);
  assert.equal(snapshot.games[0].playersCount, 3);
  assert.equal(snapshot.currentGame.canViewerRate, false);
  assert.equal(
    snapshot.currentGame.participants.find((player) => player.id === 'player_2').canRateTarget,
    false
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
  assert.equal(snapshot.currentGame.dateLabel, '17 мая');
  assert.equal(snapshot.viewerCanCreateGames, true);
  assert.equal(snapshot.players.find((player) => player.id === 'player_3').position, 'GK');
});

test('getLatestMvp picks the biggest positive career rating jump', () => {
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
        username: 'star',
        displayName: 'Star',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'grower',
        displayName: 'Grower',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_3: {
        id: 'player_3',
        telegramUserId: 3,
        username: 'rater',
        displayName: 'Rater',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      }
    },
    games: {
      game_1: {
        id: 'game_1',
        chatId: '-1001',
        dateLabel: '10 мая',
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
        dateLabel: '17 мая',
        location: 'Поле 2',
        time: '19:00',
        scheduledAt: '2026-05-17T19:00:00.000Z',
        playerIds: ['player_1', 'player_2', 'player_3'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {
      rating_1: {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_1',
        raterPlayerId: 'player_3',
        targetPlayerId: 'player_1',
        ...rating({ overall: 90 })
      },
      rating_2: {
        id: 'rating_2',
        chatId: '-1001',
        gameId: 'game_1',
        raterPlayerId: 'player_3',
        targetPlayerId: 'player_2',
        ...rating({ overall: 50 })
      },
      rating_3: {
        id: 'rating_3',
        chatId: '-1001',
        gameId: 'game_2',
        raterPlayerId: 'player_3',
        targetPlayerId: 'player_1',
        ...rating({ overall: 92 })
      },
      rating_4: {
        id: 'rating_4',
        chatId: '-1001',
        gameId: 'game_2',
        raterPlayerId: 'player_3',
        targetPlayerId: 'player_2',
        ...rating({ overall: 70 })
      }
    }
  };

  const mvp = getLatestMvp(state, '-1001');
  const snapshot = buildChatSnapshot(state, '-1001', 'player_3', new Date('2026-05-19T00:00:00.000Z'));

  assert.equal(mvp.playerId, 'player_2');
  assert.equal(mvp.previousOverall, 50);
  assert.equal(mvp.gameOverall, 70);
  assert.equal(mvp.overall, 60);
  assert.equal(mvp.ratingIncrease, 10);
  assert.equal(snapshot.latestMvpPlayerId, 'player_2');
  assert.equal(snapshot.players[0].id, 'player_2');
  assert.equal(snapshot.players[0].isMvp, true);
});

test('buildChatSnapshot keeps rating window open for 24 hours after kickoff', () => {
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
  const laterSnapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-11T19:00:00.000Z'));

  assert.equal(openSnapshot.currentGame.canViewerRate, true);
  assert.equal(openSnapshot.currentGame.ratingWindowEndsAt, '2026-05-11T19:00:00.000Z');
  assert.equal(laterSnapshot.currentGame.canViewerRate, false);
});

test('buildChatSnapshot merges viewer games and career ratings across football chats', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Old Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_old',
        playerIds: ['player_1', 'player_2']
      },
      '-2002': {
        id: '-2002',
        title: 'New Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_future',
        playerIds: ['player_1', 'player_3']
      },
      '777': {
        id: '777',
        title: 'Oleg private',
        type: 'private',
        username: '',
        currentGameId: null,
        playerIds: ['player_4']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'oleg',
        displayName: 'Oleg',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        privateChatId: '777',
        chatIds: ['-1001', '-2002']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'rater',
        displayName: 'Rater',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_3: {
        id: 'player_3',
        telegramUserId: 3,
        username: 'newbie',
        displayName: 'Newbie',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-2002']
      },
      player_4: {
        id: 'player_4',
        telegramUserId: 4,
        username: 'private_only',
        displayName: 'Private Only',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        privateChatId: '777',
        chatIds: ['777']
      }
    },
    games: {
      game_old: {
        id: 'game_old',
        chatId: '-1001',
        dateLabel: '1 мая',
        location: 'Старое поле',
        time: '19:00',
        scheduledAt: '2026-05-01T19:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      },
      game_future: {
        id: 'game_future',
        chatId: '-2002',
        dateLabel: '30 мая',
        location: 'Новое поле',
        time: '16:00',
        scheduledAt: '2026-05-30T16:00:00.000Z',
        playerIds: ['player_1', 'player_3'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {
      rating_1: {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_old',
        raterPlayerId: 'player_2',
        targetPlayerId: 'player_1',
        ...rating({ overall: 78, position: 'ST', goals: 3 })
      }
    }
  };

  const snapshot = buildChatSnapshot(state, '-2002', 'player_1', new Date('2026-05-27T12:00:00.000Z'));
  const player = snapshot.players.find((item) => item.id === 'player_1');

  assert.equal(snapshot.games.length, 2);
  assert.equal(snapshot.currentGame.id, 'game_future');
  assert.equal(player.overall, 78);
  assert.equal(player.position, 'ST');
  assert.equal(player.ratedGames, 1);
  assert.ok(snapshot.players.some((item) => item.id === 'player_4'));
  assert.ok(snapshot.availablePlayers.some((item) => item.id === 'player_4'));

  const privateSnapshot = buildChatSnapshot(state, '777', 'player_4', new Date('2026-05-27T12:00:00.000Z'));
  assert.equal(privateSnapshot.currentGame.id, 'game_future');
  assert.equal(privateSnapshot.players.find((item) => item.id === 'player_1').overall, 78);
  assert.ok(privateSnapshot.games.some((game) => game.id === 'game_old'));
  assert.ok(privateSnapshot.games.some((game) => game.id === 'game_future'));

  const globalSnapshot = buildChatSnapshot(state, 'global', 'player_4', new Date('2026-05-27T12:00:00.000Z'));
  assert.equal(globalSnapshot.chat.id, '-1001');
  assert.equal(globalSnapshot.currentGame.id, 'game_future');
  assert.equal(globalSnapshot.players.find((item) => item.id === 'player_1').overall, 78);
});

test('buildChatSnapshot reads games globally even when stored outside a football chat', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_old',
        playerIds: ['player_1', 'player_2']
      },
      '777': {
        id: '777',
        title: 'Private Context',
        type: 'private',
        username: '',
        currentGameId: 'game_private_future',
        playerIds: ['player_1']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'oleg',
        displayName: 'Oleg',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        privateChatId: '777',
        chatIds: ['-1001', '777']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'rater',
        displayName: 'Rater',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      }
    },
    games: {
      game_old: {
        id: 'game_old',
        chatId: '-1001',
        dateLabel: '1 мая',
        location: 'Старое поле',
        time: '19:00',
        scheduledAt: '2026-05-01T19:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      },
      game_private_future: {
        id: 'game_private_future',
        chatId: '777',
        dateLabel: '29 мая',
        location: 'Новое поле',
        time: '20:00',
        scheduledAt: '2026-05-29T20:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {
      rating_1: {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_old',
        raterPlayerId: 'player_2',
        targetPlayerId: 'player_1',
        ...rating({ overall: 77, position: 'ST', goals: 2 })
      }
    }
  };

  const snapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-27T12:00:00.000Z'));

  assert.equal(snapshot.currentGame.id, 'game_private_future');
  assert.ok(snapshot.games.some((game) => game.id === 'game_old'));
  assert.ok(snapshot.games.some((game) => game.id === 'game_private_future'));
  assert.equal(snapshot.players.find((player) => player.id === 'player_1').overall, 77);
});

test('buildChatSnapshot lets O_legacy manage any game', () => {
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
        playerIds: ['player_admin', 'player_organizer']
      }
    },
    players: {
      player_admin: {
        id: 'player_admin',
        telegramUserId: 1,
        username: 'O_legacy',
        displayName: 'Oleg',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_organizer: {
        id: 'player_organizer',
        telegramUserId: 2,
        username: 'organizer',
        displayName: 'Organizer',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      }
    },
    games: {
      game_1: {
        id: 'game_1',
        chatId: '-1001',
        organizerPlayerId: 'player_organizer',
        dateLabel: '30 мая',
        location: 'Поле 10',
        time: '16:00',
        scheduledAt: '2099-05-30T16:00:00.000Z',
        playerIds: ['player_admin', 'player_organizer'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {}
  };

  const snapshot = buildChatSnapshot(state, '-1001', 'player_admin', new Date('2099-05-29T12:00:00.000Z'));

  assert.equal(snapshot.currentGame.canViewerManage, true);
});

test('buildChatSnapshot finalizes ratings when a started game is closed by the next game', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_next',
        playerIds: ['player_1', 'player_2']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'oleg',
        displayName: 'Oleg',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'rater',
        displayName: 'Rater',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      }
    },
    games: {
      game_closed: {
        id: 'game_closed',
        chatId: '-1001',
        dateLabel: '28 мая',
        location: 'Старое поле',
        time: '10:00',
        scheduledAt: '2026-05-28T07:00:00.000Z',
        closedAt: '2026-05-28T08:30:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      },
      game_next: {
        id: 'game_next',
        chatId: '-1001',
        dateLabel: '29 мая',
        location: 'Новое поле',
        time: '16:00',
        scheduledAt: '2026-05-29T13:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {
      rating_1: {
        id: 'rating_1',
        chatId: '-1001',
        gameId: 'game_closed',
        raterPlayerId: 'player_2',
        targetPlayerId: 'player_1',
        ...rating({ overall: 82, position: 'ST', goals: 2 })
      }
    }
  };

  const snapshot = buildChatSnapshot(state, '-1001', 'player_1', new Date('2026-05-28T09:00:00.000Z'));
  const player = snapshot.players.find((item) => item.id === 'player_1');

  assert.equal(player.ratedGames, 1);
  assert.equal(player.overall, 82);
  assert.equal(snapshot.games.find((game) => game.id === 'game_closed').status, 'finished');
  assert.deepEqual(snapshot.gameDays.map((game) => game.id), ['game_next', 'game_closed']);
});

test('buildChatSnapshot includes imported career seed in global player ratings', () => {
  const state = {
    version: 1,
    meta: {},
    chats: {
      '-1001': {
        id: '-1001',
        title: 'Football Chat',
        type: 'supergroup',
        username: '',
        currentGameId: 'game_next',
        playerIds: ['player_1', 'player_2']
      }
    },
    players: {
      player_1: {
        id: 'player_1',
        telegramUserId: 1,
        username: 'oleg',
        displayName: 'Oleg',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001'],
        careerSeed: {
          ratedGames: 1,
          goals: 3,
          assists: 2,
          position: 'ST',
          stats: {
            pace: 70,
            dribbling: 72,
            shooting: 74,
            defense: 68,
            passing: 73,
            physical: 75
          }
        }
      },
      player_2: {
        id: 'player_2',
        telegramUserId: 2,
        username: 'teammate',
        displayName: 'Teammate',
        firstName: '',
        lastName: '',
        photoUrl: '',
        defaultPosition: 'N/A',
        chatIds: ['-1001']
      }
    },
    games: {
      game_next: {
        id: 'game_next',
        chatId: '-1001',
        dateLabel: '30 мая',
        location: 'Поле 10',
        time: '16:00',
        scheduledAt: '2026-05-30T13:00:00.000Z',
        playerIds: ['player_1', 'player_2'],
        paymentLines: [],
        priceLine: ''
      }
    },
    ratings: {}
  };

  const snapshot = buildChatSnapshot(state, 'global', 'player_1', new Date('2026-05-29T09:00:00.000Z'));
  const player = snapshot.players.find((item) => item.id === 'player_1');
  const gamePlayer = snapshot.currentGame.participants.find((item) => item.id === 'player_1');

  assert.equal(player.ratedGames, 1);
  assert.equal(player.overall, 72);
  assert.equal(player.goals, 3);
  assert.equal(player.assists, 2);
  assert.equal(player.position, 'ST');
  assert.equal(gamePlayer.overall, 72);
});
