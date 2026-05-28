import test from 'node:test';
import assert from 'node:assert/strict';

import { TelegramBot } from '../src/bot/telegram.js';

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
    {
      id: 'game_1',
      chatId: '-1001',
      scheduledAt: '2099-05-19T16:30:00.000Z'
    }
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
  assert.equal(sent[0].text, 'Не забудьте оценить игру тиммейтов');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Оценить');
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=chat_-1001'
  );
  assert.deepEqual(marked, [{ gameId: 'game_1', messageId: 77 }]);
});

test('processPendingRatingPrompts falls back to plain link when keyboard send fails', async () => {
  const games = [
    {
      id: 'game_2',
      chatId: '-1002',
      scheduledAt: '2099-05-19T16:30:00.000Z'
    }
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

    if (options.replyMarkup) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 88 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /https:\/\/t\.me\/football_test_bot\?startapp=chat_-1002/);
  assert.deepEqual(marked, [{ gameId: 'game_2', messageId: 88 }]);
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

    if (options.replyMarkup) {
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

  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, -1003);
  assert.equal(sent[1].chatId, -1003);
  assert.match(sent[1].text, /https:\/\/t\.me\/football_test_bot\?startapp=chat_-1003/);
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

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Привет👋/);
  assert.match(sent[0].text, /Надеюсь это поможет тебе рости/);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть приложение');
});

test('/start uses the main miniapp link when bot username is known', async () => {
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

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=chat_-1001'
  );
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].web_app, undefined);
});

test('buildManualInviteKeyboard uses the same main miniapp entry when possible', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  const keyboard = bot.buildManualInviteKeyboard('-1009', 'game_9');

  assert.equal(keyboard.inline_keyboard[0][0].text, 'К игре');
  assert.equal(keyboard.inline_keyboard[0][0].url, 'https://t.me/football_test_bot?startapp=chat_-1009');
  assert.equal(keyboard.inline_keyboard[1][0].callback_data, 'decline_game:game_9');
});

test('/open tolerates PUBLIC_BASE_URL without scheme in group chats', async () => {
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
    'https://t.me/football_test_bot?startapp=chat_-1004'
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

test('handleAnnouncement sends details button only for fresh messages', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement() {
      return {
        created: true,
        updated: false,
        game: {
          id: 'game_7',
          chatId: '-1007',
          scheduledAt: '2099-05-24T16:30:00.000Z'
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
    return { message_id: 103 };
  };

  const message = {
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
    date: Math.floor(Date.now() / 1000),
    message_id: 77
  };

  await bot.handleAnnouncement(message, { isEdited: false });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '\u2060');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');

  sent.length = 0;
  await bot.handleAnnouncement(message, { isEdited: true });
  assert.equal(sent.length, 0);
});

test('handleAnnouncement sends lineup image with details button when snapshot is available', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement() {
      return {
        created: true,
        updated: false,
        game: {
          id: 'game_7',
          chatId: '-1007',
          scheduledAt: '2099-05-24T16:30:00.000Z'
        }
      };
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
    date: Math.floor(Date.now() / 1000),
    message_id: 77
  }, { isEdited: false });

  assert.equal(texts.length, 0);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].chatId, -1007);
  assert.ok(Buffer.isBuffer(photos[0].photo));
  assert.equal(photos[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
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
