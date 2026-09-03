import test from 'node:test';
import assert from 'node:assert/strict';

import { TelegramBot } from '../src/bot/telegram.js';

const RATING_PROMPT_TEXT = [
  '⚽ <b>Игра стартовала</b>',
  '26 июля · 19:30',
  'Сокольники, поле 2',
  '',
  'Игроков: <b>15</b>',
  '',
  'Не забудьте раздать баллы самым заметным игрокам и выбрать MVP'
].join('\n');

function createRatingGame(overrides = {}) {
  return {
    id: 'game_1',
    chatId: '-1001',
    dateLabel: '26 июля',
    time: '19:30',
    location: 'Сокольники, поле 2',
    playerIds: Array.from({ length: 15 }, (_, index) => `player_${index + 1}`),
    scheduledAt: '2099-05-19T16:30:00.000Z',
    ...overrides
  };
}

function createBotStore(games) {
  const marked = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    listGamesRequiringPrompt() {
      return games;
    },
    async markRatingsPromptSent(gameId, messageId) {
      marked.push({ gameId, messageId });
    }
  };

  return { store, marked };
}

test('processPendingRatingPrompts sends a rating prompt with miniapp link', async () => {
  const games = [
    createRatingGame()
  ];
  const { store, marked } = createBotStore(games);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 77 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '-1001');
  assert.equal(sent[0].text, RATING_PROMPT_TEXT);
  assert.equal(sent[0].options.parseMode, 'HTML');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Оценить игроков');
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=gameid_game_1'
  );
  assert.deepEqual(marked, [{ gameId: 'game_1', messageId: 77 }]);
});

test('processPendingRatingPrompts sends one lineup message with level when majority is ready', async () => {
  const games = [
    createRatingGame({
      playerIds: ['player_1', 'player_2', 'player_3']
    })
  ];
  const { store, marked } = createBotStore(games);
  const participants = [
    {
      id: 'player_1',
      overall: 60,
      position: 'LW',
      ratedGames: 2
    },
    {
      id: 'player_2',
      overall: 56,
      position: 'GK',
      ratedGames: 1
    },
    {
      id: 'player_3',
      overall: 0,
      position: null,
      ratedGames: 0
    }
  ];
  const sent = [];

  store.state.chats['-1001'] = { type: 'supergroup' };
  store.getSnapshot = () => ({
    currentGame: {
      ...games[0],
      participants
    },
    gameDays: [],
    players: participants
  });

  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.buildGameLineupImage = async () => Buffer.from('lineup');
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    sent.push({ chatId, photo, options });
    return { message_id: 120 };
  };
  bot.sendText = async () => {
    throw new Error('A second chat message must not be sent');
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '-1001');
  assert.equal(
    sent[0].options.caption,
    [
      '⚽ <b>Игра стартовала</b>',
      '26 июля · 19:30',
      'Сокольники, поле 2',
      '',
      'Игроков: <b>3</b>',
      'Уровень игры: <b>58</b>',
      '',
      'Не забудьте раздать баллы самым заметным игрокам и выбрать MVP'
    ].join('\n')
  );
  assert.equal(sent[0].options.parseMode, 'HTML');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Оценить игроков');
  assert.deepEqual(marked, [{ gameId: 'game_1', messageId: 120 }]);
});

test('shouldShowGameLineup requires a strict majority with rating and position', () => {
  const game = createRatingGame({
    playerIds: ['player_1', 'player_2', 'player_3', 'player_4']
  });
  const players = [
    { id: 'player_1', overall: 60, position: 'LW', ratedGames: 1 },
    { id: 'player_2', overall: 58, position: 'GK', ratedGames: 1 },
    { id: 'player_3', overall: 55, position: null, ratedGames: 1 },
    { id: 'player_4', overall: 0, position: 'CB', ratedGames: 0 }
  ];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getSnapshot() {
      return {
        currentGame: {
          ...game,
          participants: players
        },
        gameDays: [],
        players
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  assert.equal(bot.shouldShowGameLineup(game), false);

  players[2].position = 'CM';
  assert.equal(bot.shouldShowGameLineup(game), true);
});

test('publishOrSyncGameAnnouncement skips lineup without a ready majority', async () => {
  const game = createRatingGame({
    playerIds: ['player_1', 'player_2', 'player_3']
  });
  const players = [
    { id: 'player_1', overall: 60, position: 'LW', ratedGames: 1 },
    { id: 'player_2', overall: 58, position: null, ratedGames: 1 },
    { id: 'player_3', overall: 0, position: 'GK', ratedGames: 0 }
  ];
  const sent = [];
  let lineupBuilds = 0;
  const store = {
    state: {
      chats: {
        '-1001': { type: 'supergroup' }
      },
      games: {}
    },
    getGameById() {
      return game;
    },
    getSnapshot() {
      return {
        currentGame: {
          ...game,
          participants: players
        },
        gameDays: [],
        players
      };
    },
    async setGameBotAnnouncement(gameId, announcement) {
      sent.push({ gameId, announcement });
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.buildGameLineupImage = async () => {
    lineupBuilds += 1;
    return Buffer.from('lineup');
  };
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 140 };
  };
  bot.sendPhoto = async () => {
    throw new Error('A lineup snapshot must not be sent without a ready majority');
  };

  await bot.publishOrSyncGameAnnouncement(game.id);

  assert.equal(lineupBuilds, 0);
  assert.equal(sent[0].chatId, '-1001');
  assert.equal(sent[0].options.parseMode, 'HTML');
  assert.deepEqual(sent[1], {
    gameId: 'game_1',
    announcement: {
      chatId: '-1001',
      messageId: 140
    }
  });
});

test('publishOrSyncGameAnnouncement replaces text with one lineup message when majority becomes ready', async () => {
  const game = createRatingGame({
    botAnnouncementMessageId: 140,
    playerIds: ['player_1', 'player_2', 'player_3']
  });
  const players = [
    { id: 'player_1', overall: 60, position: 'LW', ratedGames: 1 },
    { id: 'player_2', overall: 56, position: 'GK', ratedGames: 1 },
    { id: 'player_3', overall: 0, position: null, ratedGames: 0 }
  ];
  const saved = [];
  const deleted = [];
  const store = {
    state: {
      chats: {
        '-1001': { type: 'supergroup' }
      },
      games: {}
    },
    getGameById() {
      return game;
    },
    getSnapshot() {
      return {
        currentGame: {
          ...game,
          participants: players
        },
        gameDays: [],
        players
      };
    },
    async setGameBotAnnouncement(gameId, announcement) {
      saved.push({ gameId, announcement });
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.buildGameLineupImage = async () => Buffer.from('lineup');
  bot.editPhotoMessage = async () => {
    throw new Error('message cannot be edited');
  };
  bot.sendPhoto = async () => ({ message_id: 141 });
  bot.deleteMessage = async (chatId, messageId) => {
    deleted.push({ chatId, messageId });
  };

  const message = await bot.publishOrSyncGameAnnouncement(game.id);

  assert.equal(message.message_id, 141);
  assert.deepEqual(saved, [{
    gameId: 'game_1',
    announcement: {
      chatId: '-1001',
      messageId: 141
    }
  }]);
  assert.deepEqual(deleted, [{ chatId: '-1001', messageId: 140 }]);
});

test('processPendingRatingPrompts falls back to plain link when keyboard send fails', async () => {
  const games = [
    createRatingGame({
      id: 'game_2',
      chatId: '-1002'
    })
  ];
  const { store, marked } = createBotStore(games);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });

    const button = options.replyMarkup?.inline_keyboard?.[0]?.[0];
    if (button?.url || button?.login_url) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 88 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 3);
  assert.equal(
    sent[2].text,
    `${RATING_PROMPT_TEXT}\n\nhttps://t.me/football_test_bot?startapp=gameid_game_2`
  );
  assert.deepEqual(marked, [{ gameId: 'game_2', messageId: 88 }]);
});

test('processPendingRatingPrompts sends private prompts when chat prompt fails', async () => {
  const games = [
    createRatingGame({
      id: 'game_3',
      chatId: '-1003',
      playerIds: ['player_1'],
    })
  ];
  const { store, marked } = createBotStore(games);
  const sent = [];

  store.state.chats['-1003'] = { type: 'supergroup' };
  store.getPlayerById = (playerId) => (
    playerId === 'player_1'
      ? { id: 'player_1', privateChatId: '777001', locale: 'ru' }
      : null
  );

  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.sendMiniAppEntry = async (chatId, chatType, targetChatId, options = {}) => {
    sent.push({ chatId, chatType, targetChatId, options });

    if (chatId === '-1003') {
      throw new Error('Telegram rejected chat prompt');
    }

    return { message_id: 91 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, '-1003');
  assert.equal(sent[1].chatId, '777001');
  assert.equal(sent[1].options.buttonText, 'Оценить');
  assert.deepEqual(marked, [{ gameId: 'game_3', messageId: null }]);
});

test('processPendingGameSummaries sends MVP result to the group and private participants', async () => {
  const game = createRatingGame({
    id: 'game_summary',
    playerIds: ['player_1', 'player_2', 'player_3']
  });
  const marked = [];
  const players = {
    player_1: {
      id: 'player_1',
      privateChatId: '777001',
      locale: 'ru'
    },
    player_2: {
      id: 'player_2',
      privateChatId: '777002',
      locale: 'ru'
    },
    player_3: {
      id: 'player_3'
    }
  };
  const store = {
    state: {
      chats: {
        '-1001': {
          type: 'supergroup'
        }
      },
      games: {}
    },
    listGamesRequiringSummary() {
      return [game];
    },
    getPlayerById(playerId) {
      return players[playerId] ?? null;
    },
    getSnapshot() {
      return {
        games: [
          {
            ...game,
            averageOverall: 61,
            mvp: {
              displayName: 'Лучший игрок',
              achievements: []
            },
            cards: {
              yellow: 0,
              red: 0
            }
          }
        ]
      };
    },
    async markRatingSummarySent(gameId, delivery) {
      marked.push({ gameId, delivery });
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendMiniAppEntry = async (chatId, chatType, targetChatId, options = {}) => {
    sent.push({ chatId, chatType, targetChatId, options });
    return { message_id: sent.length === 1 ? 501 : 600 + sent.length };
  };

  await bot.processPendingGameSummaries();

  assert.deepEqual(sent.map((message) => message.chatId), ['-1001', '777001', '777002']);
  assert.equal(sent[0].chatType, 'supergroup');
  assert.equal(sent[1].chatType, 'private');
  assert.equal(sent[2].chatType, 'private');

  for (const message of sent) {
    assert.match(message.options.primaryText, /MVP: Лучший игрок/);
    assert.equal(message.options.gameId, 'game_summary');
    assert.equal(message.options.initialView, 'game');
  }

  assert.deepEqual(marked, [
    {
      gameId: 'game_summary',
      delivery: {
        chatMessageId: 501,
        privatePlayerIds: ['player_1', 'player_2']
      }
    }
  ]);
});

test('/open falls back to plain link when Telegram rejects keyboard', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });

    const button = options.replyMarkup?.inline_keyboard?.[0]?.[0];
    if (button?.url || button?.login_url) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 99 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1003,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 3);
  assert.equal(sent[0].chatId, -1003);
  assert.equal(sent[2].chatId, -1003);
  assert.equal(
    sent[2].text,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('/open sends only button text with custom label when keyboard works', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 102 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1006,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '\u2060');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть футбольчик');
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('/open in private chats opens the games list by default', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example',
    defaultChatId: '-1001'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 103 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('/start sends onboarding copy with app button', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 100 };
  };

  await bot.handleCommand({
    text: '/start',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 3);
  assert.equal(sent[0].text, '⚽ Создавай игры, собирай команды и находи новых игроков рядом с собой.');
  assert.equal(sent[1].text, '🎯 Мы уже создали тебе карточку игрока. Заполни её и получай оценки после матчей.');
  assert.equal(sent[2].text, '🤖 Добавь бота в чат с игроками. Он поможет собирать составы, балансировать команды и вести статистику.');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть приложение');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[1][0].text, 'О проекте');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[1][0].url, 'https://app.example/about');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[2][0].text, 'Команды');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[2][0].callback_data, 'show_commands');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[3][0].text, 'Поддержка');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[3][0].url, 'https://t.me/olejooo');
});

test('/help sends support contact', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({ telegramBotToken: 'token' }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 100 };
  };

  await bot.handleCommand({
    text: '/help',
    chat: {
      id: 123,
      type: 'private'
    },
    from: {
      language_code: 'ru'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'По вопросам поддержки и обратной связи напишите @olejooo');
});

test('commands button explains /game and other bot commands', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];
  const answered = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 101 };
  };
  bot.answerCallbackQuery = async (callbackQueryId) => {
    answered.push(callbackQueryId);
  };

  await bot.handleCallbackQuery({
    id: 'callback_1',
    data: 'show_commands',
    from: {
      id: 123,
      language_code: 'ru'
    },
    message: {
      chat: {
        id: 123,
        type: 'private'
      }
    }
  });

  assert.deepEqual(answered, ['callback_1']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\/game — создать игру из готового анонса/);
  assert.match(sent[0].text, /\/open — открыть приложение/);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть приложение');
});

test('/start uses the deployed web app URL in private chats', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example',
    defaultChatId: '-1001'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 100 };
  };

  await bot.handleCommand({
    text: '/start',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 3);
  assert.equal(
    sent[2].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('buildManualInviteKeyboard uses the deployed web app URL in private chats', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  const keyboard = bot.buildManualInviteKeyboard('-1009', 'game_9');

  assert.equal(keyboard.inline_keyboard[0][0].text, 'К игре');
  assert.equal(
    keyboard.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=gameid_game_9'
  );
  assert.equal(keyboard.inline_keyboard[1][0].callback_data, 'decline_game:game_9');
});

test('buildMainMiniAppLink can deep link to a shared player card', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';

  assert.equal(
    bot.buildMainMiniAppLink('', { initialView: 'players', playerId: 'player_42' }),
    'https://t.me/football_test_bot?startapp=playerid_player_42'
  );
});

test('buildMainMiniAppLink uses configured bot username before getMe resolves', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    telegramBotUsername: '@football_test_bot',
    publicBaseUrl: 'https://app.example'
  }, store);

  assert.equal(
    bot.buildMainMiniAppLink('', { gameId: 'game_42' }),
    'https://t.me/football_test_bot?startapp=gameid_game_42'
  );
});

test('buildBotStartLink opens the bot chat without launching the mini app', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    telegramBotUsername: '@football_test_bot'
  }, store);

  assert.equal(
    bot.buildBotStartLink('landing'),
    'https://t.me/football_test_bot?start=landing'
  );
});

test('/open uses the active deployment login URL in group chats', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'footballmanager-production.up.railway.app'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 101 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1004,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('buildMiniAppUrl normalizes PUBLIC_BASE_URL without scheme for private chat usage', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'footballmanager-production.up.railway.app'
  }, store);

  assert.equal(
    bot.buildMiniAppUrl('-1005'),
    'https://footballmanager-production.up.railway.app/?chatId=-1005'
  );
});

test('syncDefaultMenuButton points Open at the active deployment', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const calls = [];

  bot.callApi = async (method, payload) => {
    calls.push({ method, payload });
    return true;
  };

  await bot.syncDefaultMenuButton();

  assert.deepEqual(calls, [
    {
      method: 'setChatMenuButton',
      payload: {
        menu_button: {
          type: 'web_app',
          text: 'Open',
          web_app: {
            url: 'https://app.example/'
          }
        }
      }
    }
  ]);
});

test('handleAnnouncement creates one editable confirmation draft', async () => {
  let draft = null;
  const store = {
    state: {
      chats: {},
      games: {}
    },
    findAnnouncementDraftByMessage(chatId, messageId) {
      return draft
        && String(draft.chatId) === String(chatId)
        && draft.sourceMessageId === messageId
        ? draft
        : null;
    },
    async saveAnnouncementDraft(payload) {
      draft = {
        id: 'announcement_1',
        chatId: String(payload.chatId),
        sourceMessageId: payload.sourceMessageId,
        announcement: payload.announcement,
        rawText: payload.rawText,
        confirmationChatId: draft?.confirmationChatId ?? '',
        confirmationMessageId: draft?.confirmationMessageId ?? null
      };
      return { draft };
    },
    async setAnnouncementDraftConfirmation(id, confirmation) {
      assert.equal(id, 'announcement_1');
      draft.confirmationChatId = String(confirmation.chatId);
      draft.confirmationMessageId = confirmation.messageId;
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];
  const edited = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 103 };
  };
  bot.editTextMessage = async (chatId, messageId, text, options = {}) => {
    edited.push({ chatId, messageId, text, options });
    return { message_id: messageId };
  };

  const message = {
    text: `24 мая 2099
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-20T12:00:00Z').getTime() / 1000),
    message_id: 77
  };

  await bot.handleAnnouncement(message, { isEdited: false });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Анонс игры/);
  assert.match(sent[0].text, /Создать и опубликовать игру\?/);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Создать игру');

  await bot.handleAnnouncement(message, { isEdited: true });
  assert.equal(sent.length, 1);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].messageId, 103);
});

test('handleAnnouncement creates confirmation draft without payment block', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async saveAnnouncementDraft(payload) {
      calls.push(payload);
      return {
        draft: {
          id: 'announcement_no_payment',
          chatId: String(payload.chatId),
          sourceMessageId: payload.sourceMessageId,
          announcement: payload.announcement
        }
      };
    },
    async setAnnouncementDraftConfirmation() {
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.sendText = async () => ({ message_id: 104 });

  await bot.handleAnnouncement({
    text: `30 мая
Сокольники, поле 10
16:00

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov`,
    chat: {
      id: -1008,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00+03:00').getTime() / 1000),
    message_id: 88
  }, { isEdited: false });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].announcement.location, 'Сокольники, поле 10');
  assert.equal(calls[0].announcement.time, '16:00');
});

test('handleAnnouncement updates known edited message without payment block', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    findGameByMessage(chatId, messageId) {
      assert.equal(String(chatId), '-1007');
      assert.equal(messageId, 77);
      return {
        id: 'game_7',
        chatId: '-1007',
        messageId: 77,
        scheduledAt: '2099-05-24T16:30:00.000Z'
      };
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: false,
        updated: true,
        game: {
          id: 'game_7',
          chatId: '-1007',
          scheduledAt: payload.announcement.scheduledAt
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 104 };
  };

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
20:15

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov
6. @dimasharovv`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-24T10:00:00Z').getTime() / 1000),
    edit_date: Math.floor(new Date('2099-05-24T12:00:00Z').getTime() / 1000),
    message_id: 77
  }, { isEdited: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceDate.toISOString(), '2099-05-24T12:00:00.000Z');
  assert.equal(calls[0].announcement.hasPaymentBlock, false);
  assert.equal(calls[0].announcement.time, '20:15');
  assert.equal(calls[0].announcement.playerUsernames.length, 6);
  assert.equal(sent.length, 0);
});

test('handleAnnouncement stores telegram announcement author on draft', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getPlayerByTelegramUserId(telegramUserId) {
      assert.equal(telegramUserId, 12345);
      return { id: 'player_author' };
    },
    async saveAnnouncementDraft(payload) {
      calls.push(payload);
      return {
        draft: {
          id: 'announcement_author',
          chatId: String(payload.chatId),
          sourceMessageId: payload.sourceMessageId,
          announcement: payload.announcement
        }
      };
    },
    async setAnnouncementDraftConfirmation() {
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  bot.sendText = async () => ({ message_id: 105 });

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
    from: {
      id: 12345,
      username: 'organizer'
    },
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-24T12:00:00Z').getTime() / 1000),
    message_id: 77
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizerPlayerId, 'player_author');
});

test('handleAnnouncement parses confirmation draft from message captions', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async saveAnnouncementDraft(payload) {
      calls.push(payload);
      return {
        draft: {
          id: 'announcement_caption',
          chatId: String(payload.chatId),
          sourceMessageId: payload.sourceMessageId,
          announcement: payload.announcement
        }
      };
    },
    async setAnnouncementDraftConfirmation() {
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  bot.sendText = async () => ({ message_id: 106 });

  await bot.handleAnnouncement({
    caption: `30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. Alexandr 🤡

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1008,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
    message_id: 88
  }, { isEdited: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].rawText, calls[0].announcement.rawText);
  assert.equal(calls[0].announcement.location, 'Поле 10');
  assert.equal(calls[0].announcement.playerUsernames.length, 6);
  assert.equal(calls[0].announcement.playerUsernames[5], 'alexandr');
});

test('handleCommand creates confirmation draft from replied announcement with /game fallback', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async saveAnnouncementDraft(payload) {
      calls.push(payload);
      return {
        draft: {
          id: 'announcement_command',
          chatId: String(payload.chatId),
          chatTitle: payload.chatTitle,
          chatType: payload.chatType,
          sourceMessageId: payload.sourceMessageId,
          rawText: payload.rawText,
          announcement: payload.announcement,
          organizerPlayerId: payload.organizerPlayerId,
          authorTelegramUserId: payload.authorTelegramUserId,
          sourceDate: payload.sourceDate
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const published = [];

  bot.botUsername = 'football_test_bot';
  bot.publishOrSyncAnnouncementDraft = async (draft) => {
    published.push(draft);
  };

  await bot.handleCommand({
    text: '/game',
    chat: {
      id: -1010,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
    message_id: 101,
    reply_to_message: {
      message_id: 100,
      date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
      text: `30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. Alexandr 🤡

1000р
89295991499
Альфа, Тинь, Сбер`
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, -1010);
  assert.equal(calls[0].sourceMessageId, 100);
  assert.equal(calls[0].announcement.location, 'Поле 10');
  assert.equal(calls[0].announcement.playerUsernames[5], 'alexandr');
  assert.equal(published.length, 1);
  assert.equal(published[0].id, 'announcement_command');
  assert.equal(published[0].chatId, '-1010');
});

test('handleCommand keeps /game confirmation drafts isolated between chats', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async saveAnnouncementDraft(payload) {
      calls.push(payload);
      return {
        draft: {
          id: `announcement_${payload.chatId}`,
          chatId: String(payload.chatId),
          sourceMessageId: payload.sourceMessageId,
          announcement: payload.announcement
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const published = [];
  bot.publishOrSyncAnnouncementDraft = async (draft) => published.push(draft);

  const announcementText = `30 мая
Поле 10
16:00

1. @teterko
2. @O_legacy
3. @dbabanin
4. @satwerz
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`;

  for (const chatId of [-1010, -2020]) {
    await bot.handleCommand({
      text: '/game',
      chat: {
        id: chatId,
        type: 'supergroup',
        title: `Football ${chatId}`
      },
      date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
      message_id: Math.abs(chatId),
      reply_to_message: {
        message_id: Math.abs(chatId) + 1,
        date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
        text: announcementText
      }
    });
  }

  assert.deepEqual(calls.map((item) => item.chatId), [-1010, -2020]);
  assert.deepEqual(published.map((item) => item.chatId), ['-1010', '-2020']);
});

test('handleCommand supports /editgame as phone-friendly announcement update', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: false,
        updated: true,
        game: {
          id: 'game_updated',
          chatId: String(payload.chatId),
          scheduledAt: payload.announcement.scheduledAt
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.sendText = async () => ({ message_id: 601 });

  await bot.handleCommand({
    text: `/editgame 30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. Alexandr 🤡

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1010,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
    message_id: 103
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, -1010);
  assert.equal(calls[0].messageId, 103);
  assert.equal(calls[0].source, 'telegram-command');
  assert.equal(calls[0].announcement.location, 'Поле 10');
  assert.equal(calls[0].announcement.playerUsernames.length, 6);
});

test('handleCommand offers manual creation for bare /game in groups', async () => {
  let recordCalled = false;
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement() {
      recordCalled = true;
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const entries = [];
  bot.sendMiniAppEntry = async (chatId, chatType, targetChatId, options = {}) => {
    entries.push({ chatId, chatType, targetChatId, options });
  };

  await bot.handleCommand({
    text: '/game',
    chat: {
      id: -1011,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00Z').getTime() / 1000),
    message_id: 102
  });

  assert.equal(recordCalled, false);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].chatId, -1011);
  assert.equal(entries[0].chatType, 'supergroup');
  assert.equal(entries[0].targetChatId, -1011);
  assert.equal(entries[0].options.initialView, 'create-game');
  assert.equal(entries[0].options.buttonText, 'Создать игру');
});

test('handleAnnouncement asks for confirmation before publishing lineup image', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async saveAnnouncementDraft(payload) {
      return {
        draft: {
          id: 'announcement_lineup',
          chatId: String(payload.chatId),
          sourceMessageId: payload.sourceMessageId,
          announcement: payload.announcement
        }
      };
    },
    async setAnnouncementDraftConfirmation() {
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_7',
          dateLabel: '24 мая',
          location: 'Сокольники, поле 10',
          time: '19:30',
          participants: [
            {
              id: 'player_1',
              username: 'teterko',
              displayName: 'Teterko',
              photoUrl: '',
              overall: 81,
              position: 'CM',
              ratedGames: 2
            },
            {
              id: 'player_2',
              username: 'dbabanin',
              displayName: 'Babanin',
              photoUrl: '',
              overall: 74,
              position: 'GK',
              ratedGames: 1
            },
            {
              id: 'player_3',
              username: 'satwerz',
              displayName: 'Satwerz',
              photoUrl: '',
              overall: 76,
              position: 'GK',
              ratedGames: 1
            },
            {
              id: 'player_4',
              username: 'olegogo',
              displayName: 'Oleg',
              photoUrl: '',
              overall: 70,
              position: 'ST',
              ratedGames: 1
            },
            {
              id: 'player_5',
              username: 'birarov',
              displayName: 'Birarov',
              photoUrl: '',
              overall: 68,
              position: 'CB',
              ratedGames: 1
            }
          ]
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const texts = [];
  const photos = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    texts.push({ chatId, text, options });
    return { message_id: 103 };
  };
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });
    return { message_id: 104 };
  };

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-20T12:00:00Z').getTime() / 1000),
    message_id: 77
  }, { isEdited: false });

  assert.equal(texts.length, 1);
  assert.match(texts[0].text, /Анонс игры/);
  assert.match(texts[0].text, /Создать и опубликовать игру\?/);
  assert.equal(texts[0].options.replyMarkup.inline_keyboard[0][0].text, 'Создать игру');
  assert.equal(photos.length, 0);
});

test('sendGameDetailsEntry renders lineup image for selected game outside currentGame', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_current',
          participants: []
        },
        gameDays: [],
        players: [
          {
            id: 'player_1',
            username: 'oleg',
            displayName: 'Oleg',
            photoUrl: '',
            overall: 59,
            position: 'LW',
            ratedGames: 1
          },
          {
            id: 'player_2',
            username: 'teammate',
            displayName: 'Teammate',
            photoUrl: '',
            overall: 55,
            position: 'GK',
            ratedGames: 1
          }
        ]
      };
    },
    getGameById(gameId) {
      assert.equal(gameId, 'game_selected');
      return {
        id: 'game_selected',
        chatId: '-1007',
        dateLabel: '7 июня',
        location: 'Сокольники, поле 10',
        time: '19:00',
        scheduledAt: '2099-06-07T16:00:00.000Z',
        playerIds: ['player_1', 'player_2']
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const photos = [];

  bot.botUsername = 'football_test_bot';
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });
    return { message_id: 105 };
  };
  bot.sendText = async () => {
    throw new Error('Expected photo instead of text fallback');
  };

  await bot.sendGameDetailsEntry(-1007, 'supergroup', -1007, {
    id: 'game_selected'
  });

  assert.equal(photos.length, 1);
  assert.equal(photos[0].chatId, -1007);
  assert.ok(Buffer.isBuffer(photos[0].photo));
  assert.equal(photos[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
});

test('sendGameDetailsEntry sends bare lineup image when photo keyboard is rejected', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_selected',
          participants: [
            {
              id: 'player_1',
              username: 'oleg',
              displayName: 'Oleg',
              photoUrl: '',
              overall: 59,
              position: 'LW',
              ratedGames: 1
            },
            {
              id: 'player_2',
              username: 'teammate',
              displayName: 'Teammate',
              photoUrl: '',
              overall: 55,
              position: 'GK',
              ratedGames: 1
            }
          ]
        },
        gameDays: [],
        players: []
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const photos = [];
  const texts = [];

  bot.botUsername = 'football_test_bot';
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });

    if (options.replyMarkup) {
      throw new Error('Telegram rejected photo keyboard');
    }

    return { message_id: 106 };
  };
  bot.sendText = async (chatId, text, options = {}) => {
    texts.push({ chatId, text, options });
    return { message_id: 107 };
  };

  await bot.sendGameDetailsEntry(-1007, 'supergroup', -1007, {
    id: 'game_selected'
  });

  assert.equal(photos.length, 2);
  assert.ok(photos[0].options.replyMarkup);
  assert.equal(photos[1].options.replyMarkup, undefined);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
  assert.equal(
    texts[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=gameid_game_selected'
  );
});

test('notifyPlayersAboutManualGame sends private invites with decline button', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getGameById() {
      return {
        id: 'game_9',
        chatId: '-1009',
        organizerPlayerId: 'player_1',
        dateLabel: '30 мая',
        time: '16:00',
        location: 'Сокольники, поле 10',
        playerIds: ['player_1', 'player_2', 'player_3']
      };
    },
    getPlayerById(playerId) {
      return {
        player_1: {
          id: 'player_1',
          displayName: 'Organizer',
          privateChatId: '111'
        },
        player_2: {
          id: 'player_2',
          displayName: 'Invited',
          privateChatId: '222'
        },
        player_3: {
          id: 'player_3',
          displayName: 'No private'
        }
      }[playerId];
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 300 };
  };

  await bot.notifyPlayersAboutManualGame('game_9');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '222');
  assert.match(sent[0].text, /Тебя пригласили на игру/);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'К игре');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[1][0].text, 'Не смогу');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[1][0].callback_data, 'decline_game:game_9');
});

test('handleCallbackQuery removes declined player and notifies organizer', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getPlayerByTelegramUserId(telegramUserId) {
      assert.equal(telegramUserId, 888);
      return {
        id: 'player_2',
        displayName: 'Invited',
        username: 'invited'
      };
    },
    async removePlayerFromGame(payload) {
      assert.deepEqual(payload, {
        gameId: 'game_9',
        playerId: 'player_2'
      });

      return {
        removed: true,
        player: {
          displayName: 'Invited',
          username: 'invited'
        },
        organizer: {
          privateChatId: '111'
        },
        game: {
          dateLabel: '30 мая',
          time: '16:00'
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.answerCallbackQuery = async (id, text) => {
    calls.push({ type: 'answer', id, text });
  };
  bot.sendText = async (chatId, text) => {
    calls.push({ type: 'text', chatId, text });
    return { message_id: 301 };
  };

  await bot.handleCallbackQuery({
    id: 'callback_1',
    data: 'decline_game:game_9',
    from: {
      id: 888
    }
  });

  assert.deepEqual(calls[0], {
    type: 'answer',
    id: 'callback_1',
    text: 'Ок, убрал тебя из игры'
  });
  assert.equal(calls[1].type, 'text');
  assert.equal(calls[1].chatId, '111');
  assert.match(calls[1].text, /Invited не сможет сыграть/);
});

test('super admin can cancel another author announcement without being a chat admin', async () => {
  const calls = [];
  const draft = {
    id: 'announcement_draft_1',
    chatId: '-1001',
    authorTelegramUserId: 111,
    confirmationMessageId: 55
  };
  const store = {
    getAnnouncementDraftById(id) {
      assert.equal(id, draft.id);
      return draft;
    },
    async deleteAnnouncementDraft(id) {
      calls.push({ type: 'delete', id });
    }
  };
  const bot = new TelegramBot({ telegramBotToken: 'token' }, store);

  bot.isUserAdminOfChat = async () => {
    assert.fail('Super admin should not require Telegram chat admin lookup');
  };
  bot.editTextMessage = async (chatId, messageId, text) => {
    calls.push({ type: 'edit', chatId, messageId, text });
  };
  bot.answerCallbackQuery = async (id, text) => {
    calls.push({ type: 'answer', id, text });
  };

  await bot.handleCallbackQuery({
    id: 'callback_cancel',
    data: `cancel_announcement:${draft.id}`,
    from: { id: 999, username: 'O_Legacy' }
  });

  assert.deepEqual(calls[0], { type: 'delete', id: draft.id });
  assert.equal(calls[1].type, 'edit');
  assert.deepEqual(calls[2], { type: 'answer', id: 'callback_cancel', text: 'Анонс отменён' });
});

test('super admin can create a game from another author announcement without being a chat admin', async () => {
  const calls = [];
  const draft = {
    id: 'announcement_draft_2',
    chatId: '-1001',
    chatTitle: 'Football',
    chatType: 'supergroup',
    authorTelegramUserId: 111,
    confirmationMessageId: 56,
    sourceMessageId: 44,
    rawText: 'Анонс',
    sourceDate: '2099-05-01T12:00:00.000Z',
    announcement: { scheduledAt: '2099-05-30T13:00:00.000Z' }
  };
  const game = {
    id: 'game_99',
    chatId: draft.chatId,
    scheduledAt: draft.announcement.scheduledAt
  };
  const store = {
    getAnnouncementDraftById() {
      return draft;
    },
    async recordGameFromAnnouncement(payload) {
      calls.push({ type: 'record', payload });
      return { game };
    },
    async deleteAnnouncementDraft(id) {
      calls.push({ type: 'delete', id });
    }
  };
  const bot = new TelegramBot({ telegramBotToken: 'token' }, store);

  bot.isUserAdminOfChat = async () => {
    assert.fail('Super admin should not require Telegram chat admin lookup');
  };
  bot.schedulePromptForGame = () => {};
  bot.publishOrSyncGameAnnouncement = async (gameId, options) => {
    calls.push({ type: 'publish', gameId, options });
  };
  bot.editTextMessage = async () => {};
  bot.answerCallbackQuery = async (id, text) => {
    calls.push({ type: 'answer', id, text });
  };

  await bot.handleCallbackQuery({
    id: 'callback_confirm',
    data: `confirm_announcement:${draft.id}`,
    from: { id: 999, username: '@o_legacy' }
  });

  assert.equal(calls[0].type, 'record');
  assert.equal(calls[0].payload.chatId, draft.chatId);
  assert.deepEqual(calls[1], { type: 'publish', gameId: game.id, options: { chatId: draft.chatId } });
  assert.deepEqual(calls[2], { type: 'delete', id: draft.id });
  assert.deepEqual(calls[3], { type: 'answer', id: 'callback_confirm', text: 'Игра создана' });
});
